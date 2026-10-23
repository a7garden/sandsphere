import {describe,it,expect} from 'vitest';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,ICE_LATENT,equilibrateWater,totalMass,totalEnthalpy,totals,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {reactInventory,stoichiometricReaction} from '../src/sim/materialReaction';
import {validSnapshot} from '../src/sim/storage';
import {snapshotSurface} from '../src/sim/session';
import {impactMeteor} from '../src/sim/meteor';
import {AIR_FIELDS,AIR_LAYERS,AIR_SPECIES} from '../src/sim/layeredAtmosphere';
import {climateTransferBuffers} from '../src/sim/solverWorkerProtocol';
const grid=createSphere(0),empty=new Float32Array(grid.count*COMMAND_STRIDE);
function world(layered=false){
 const state=new Float32Array(grid.count*STRIDE),environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:layered,body:sandboxDefinition('rock')};
 for(let i=0;i<grid.count;i++){state[i*STRIDE+F.rock]=8;state[i*STRIDE+F.water]=1000;state[i*STRIDE+F.nitrogen]=.3;state[i*STRIDE+F.temperature]=20;}
 const solver=new CpuSolver(grid,state);solver.advance(1/30,empty,environment);
 return {solver,environment};
}
function saved(s:CpuSolver,environment:ReturnType<typeof world>['environment']):Snapshot{return {version:11,preset:'coast',time:1,state:[...s.state],climate:s.climate.snapshot(),environment,discoveries:[],supplied:0,removed:0};}

describe('canonical surface material below Float32 resolution',()=>{
 it('moves fine low bits through a balanced phase plateau without freezing phase evolution',()=>{
  const {solver}=world(),actual=solver.climate.physicalSurface(solver.state),p=0;
  actual[F.water]=1000;actual[F.ice]=Math.fround(.1);const before=actual[F.water]+actual[F.ice];
  solver.climate.air.setSurfaceEnergy(actual,p,-500*ICE_LATENT);
  equilibrateWater(actual,p,undefined,solver.climate.air);
  expect(actual[F.ice]).toBeGreaterThan(499);expect(actual[F.water]).toBeGreaterThan(499);
  expect(actual[F.water]+actual[F.ice]).toBe(before);
  const projection=solver.climate.publishSurface(actual),read=solver.climate.physicalSurface(projection);
  expect(read[F.water]+read[F.ice]).toBe(before);
  expect(totals(read,solver.climate.snapshot())).toEqual(totals(projection,solver.climate));
  expect(totalEnthalpy(read,solver.climate.snapshot())).toBeCloseTo(totalEnthalpy(projection,solver.climate),8);
 });
 it('keeps slow finite phase rates in canonical inventory',()=>{
  const stock=new Float64Array(STRIDE);stock[F.water]=1000;stock[F.vapor]=Math.fround(.0001);const mass=stock[F.water]+stock[F.vapor],evaporation=stoichiometricReaction([[F.water,1]],[[F.vapor,1]]);
  for(let n=0;n<10000;n++)expect(reactInventory(stock,0,evaporation,1e-7)).toBe(1e-7);
  expect(stock[F.vapor]).toBeGreaterThan(.00109);expect(Math.abs(stock[F.water]+stock[F.vapor]-mass)).toBeLessThan(1e-9);
 });
 it.each([false,true])('erases the complete physical stock and persists pending commands (layered=%s)',layered=>{
  const {solver,environment}=world(layered),before=solver.climate.checkpoint(),original=solver.state.slice(),erase=empty.slice();erase[5]=1;
  const shadow=snapshotSurface(solver.state,erase,[],null,solver.climate,environment);
  expect(solver.state).toEqual(original);expect(solver.climate.checkpoint()).toEqual(before);
  const all=solver.climate.physicalSurface(solver.state);let removed=0;for(const f of [F.rock,F.water,F.nitrogen,F.vapor,F.cloud,F.cloudIce,F.ice])removed+=all[f];
  if(layered){removed-=AIR_FIELDS.reduce((m,f)=>m+all[f],0);for(let k=0;k<AIR_LAYERS;k++)removed+=solver.climate.air.layerMass(k);}
  expect(shadow.pendingRemoved).toBeCloseTo(removed,9);
  solver.advance(0,erase,environment);expect(shadow.state).toEqual(solver.state);expect(shadow.climate).toEqual(solver.climate.snapshot());
  expect(solver.climate.air.surfaceMassCarry.slice(0,STRIDE).every(v=>v===0)).toBe(true);
  expect(validSnapshot(saved(solver,environment),grid.count)).toBe(true);
 });
 it.each([false,true])('redistributes physical low bits through an impact and replace (layered=%s)',layered=>{
  const {solver,environment}=world(layered),actual=solver.climate.physicalSurface(solver.state);actual[F.sand]=1000+1e-6;solver.replace(solver.climate.publishSurface(actual));
  const mass=totalMass(solver.state,solver.climate),h=totalEnthalpy(solver.state,solver.climate),ledger=new Float64Array(4);
  solver.replace(impactMeteor(solver.state,grid,[...grid.directions.slice(0,3)],36,ledger,solver.climate));
  expect(totalMass(solver.state,solver.climate)-mass).toBeCloseTo(36,9);
  expect(totalEnthalpy(solver.state,solver.climate)-h-ledger.reduce((a,b)=>a+b)).toBeCloseTo(0,7);
  expect(validSnapshot(saved(solver,environment),grid.count)).toBe(true);
 });
 it('imports canonical vapor and cloud once when activating air',()=>{
  const {solver,environment}=world(),actual=solver.climate.physicalSurface(solver.state);actual[F.vapor]=.00010000000001;actual[F.cloud]=.00020000000001;solver.replace(solver.climate.publishSurface(actual));
  const before=totals(solver.state,solver.climate),h=totalEnthalpy(solver.state,solver.climate);environment.climate=true;
  solver.climate.prepareSurface(solver.state,environment);solver.climate.air.attach(solver.state);
  const after=totals(solver.state,solver.climate);for(const f of [F.water,F.vapor,F.cloud,F.nitrogen])expect(after[f]).toBeCloseTo(before[f],12);
  expect(totalEnthalpy(solver.state,solver.climate)).toBeCloseTo(h,8);
  for(let i=0;i<grid.count;i++)for(const f of AIR_FIELDS)expect(solver.climate.air.surfaceMassCarry[i*STRIDE+f]).toBe(0);
 });
 it('treats a changed public projection as a replacement and keeps rollback exact',()=>{
  const {solver,environment}=world(),actual=solver.climate.physicalSurface(solver.state);actual[F.water]=1000+1e-6;solver.replace(solver.climate.publishSurface(actual));
  expect(solver.climate.air.surfaceMassCarry[F.water]).not.toBe(0);solver.state[F.water]=999;
  expect(solver.climate.physicalSurface(solver.state)[F.water]).toBe(999);
  const pending=snapshotSurface(solver.state,empty,[],null,solver.climate,environment);expect(pending.climate!.surfaceMassCarry![F.water]).toBe(0);
  const original=solver.climate.step.bind(solver.climate);solver.climate.step=()=>{throw new Error('injected');};
  expect(()=>solver.advance(1/30,empty,environment)).toThrow('injected');solver.climate.step=original;
  expect(solver.state[F.water]).toBe(999);expect(solver.climate.physicalSurface(solver.state)[F.water]).toBe(999);
  expect(climateTransferBuffers(solver.climate.checkpoint())).toContainEqual(solver.climate.checkpoint().surfaceMassCarry.buffer);
 });
 it.each([false,true])('rejects forged or misplaced material low bits (layered=%s)',layered=>{
  const {solver,environment}=world(layered),record=saved(solver,environment);expect(validSnapshot(record,grid.count)).toBe(true);
  for(const [index,value] of [[F.water,1],[F.temperature,1e-8],[F.ice,-1e-10],[37,1e-8]]){
   const corrupt=structuredClone(record);corrupt.climate!.surfaceMassCarry![index]=value;expect(validSnapshot(corrupt,grid.count)).toBe(false);
  }
  if(layered){const corrupt=structuredClone(record);corrupt.climate!.surfaceMassCarry![F.vapor]=1e-10;expect(validSnapshot(corrupt,grid.count)).toBe(false);}
 });
});
