import {describe,it,expect} from 'vitest';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,capacity,phaseEnergy,totalEnthalpy,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {validSnapshot} from '../src/sim/storage';
import {writeFloat32ThermalEnergy,thermalEnergy} from '../src/sim/thermodynamics';
import {impactMeteor} from '../src/sim/meteor';
import {climateTransferBuffers} from '../src/sim/solverWorkerProtocol';

const grid=createSphere(0),environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true,body:sandboxDefinition('rock')};
function world(layered=true){
 const state=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++){state[i*STRIDE+F.rock]=8;state[i*STRIDE+F.water]=.5;state[i*STRIDE+F.nitrogen]=.3;state[i*STRIDE+F.temperature]=20;}
 const solver=new CpuSolver(grid,state);solver.climate.prepareSurface(state,{...environment,climate:layered});if(layered)solver.climate.air.attach(state);return solver;
}
function saved(s:CpuSolver,layered=true):Snapshot{return {version:11,preset:'coast',state:[...s.state],climate:s.climate.snapshot(),environment:{...environment,climate:layered},time:0,supplied:0,removed:0,discoveries:[]};}

describe('physical heat below Float32 temperature resolution',()=>{
 it('accumulates small positive and negative heat without manufacturing numerical energy',()=>{
  const target=new Float32Array([20]),c=32.18,phase=4500,start=thermalEnergy(c,target[0],phase);let residual=0,expected=start;
  for(let n=0;n<100000;n++){const heat=n<60000?1e-7:-1e-7;expected+=heat;residual=writeFloat32ThermalEnergy(target,0,thermalEnergy(c,target[0],phase)+residual+heat,c,phase);}
  expect(target[0]).toBeGreaterThan(20);expect(thermalEnergy(c,target[0],phase)+residual).toBe(expected);
  expect(Math.abs(residual)).toBeLessThan(c*20*2**-23);
 });
 it.each([true,false])('saves and rolls back retained heat exactly (layered=%s)',layered=>{
  const a=world(layered),air=a.climate.air,start=totalEnthalpy(a.state,a.climate);
  air.addSurfaceHeat(a.state,0,-1e-6);expect(air.surfaceHeatCarry[0]).not.toBe(0);expect(totalEnthalpy(a.state,a.climate)-start).toBeCloseTo(-1e-6,10);
  const checkpoint=a.climate.checkpoint(),before=a.state.slice(),snapshot=JSON.parse(JSON.stringify(saved(a,layered)));
  expect(validSnapshot(snapshot,grid.count)).toBe(true);expect(totalEnthalpy(a.state,a.climate)).toBeCloseTo(totalEnthalpy(a.state,snapshot.climate),10);
  const buffers=climateTransferBuffers(checkpoint);expect(buffers).toContain(checkpoint.air.surfaceHeatCarry.buffer);
  air.addSurfaceHeat(a.state,0,1);a.state.set(before);a.climate.restoreCheckpoint(checkpoint);expect(a.climate.checkpoint()).toEqual(checkpoint);
  const b=new CpuSolver(grid,new Float32Array(snapshot.state));b.climate.restore(snapshot.climate);const empty=new Float32Array(grid.count*COMMAND_STRIDE),env={...environment,climate:layered};
  for(let n=0;n<10;n++){a.advance(1/30,empty,env);b.advance(1/30,empty,env);}
  expect(b.state).toEqual(a.state);expect(b.climate.snapshot()).toEqual(a.climate.snapshot());
 });
 it('keeps saved simple heat when activating the layered atmosphere',()=>{
  const a=world(false);a.climate.air.addSurfaceHeat(a.state,0,1e-6);const h=totalEnthalpy(a.state,a.climate),copy=JSON.parse(JSON.stringify(saved(a,false)));
  const b=new CpuSolver(grid,new Float32Array(copy.state));b.climate.restore(copy.climate);b.climate.prepareSurface(b.state,environment);b.climate.air.attach(b.state);
  expect(totalEnthalpy(b.state,b.climate)).toBeCloseTo(h,9);expect(b.climate.air.ready).toBe(true);
 });
 it('rejects a layered-to-simple downgrade atomically instead of mixing duplicate inventories',()=>{
  const a=world(),before=a.state.slice(),checkpoint=a.climate.checkpoint(),commands=new Float32Array(grid.count*COMMAND_STRIDE);commands[0]=1;
  expect(()=>a.advance(1/30,commands,{...environment,climate:false})).toThrow('단일 저장고');
  expect(a.state).toEqual(before);expect(a.climate.checkpoint()).toEqual(checkpoint);expect(a.energyChanges.every(v=>v===0)).toBe(true);
 });
 it.each([true,false])('transfers retained sensible heat during meteor redistribution (layered=%s)',layered=>{
  const a=world(layered);a.climate.air.addSurfaceHeat(a.state,0,-1e-5);const h=totalEnthalpy(a.state,a.climate),ledger=new Float64Array(4);
  const result=impactMeteor(a.state,grid,[...grid.directions.slice(0,3)],36,ledger,a.climate);
  expect(totalEnthalpy(result,a.climate)-h-ledger.reduce((x,y)=>x+y)).toBeCloseTo(0,8);expect(a.climate.air.surfaceTemperature(result,0)).toBeGreaterThan(20);
 });
 it.each([true,false])('rejects heat remainders inconsistent with stored temperature (layered=%s)',layered=>{
  const a=world(layered),snapshot=saved(a,layered),heat=layered?snapshot.climate!.atmosphere!.surfaceHeatCarry!:snapshot.climate!.surfaceHeatCarry!;
  expect(validSnapshot(snapshot,grid.count)).toBe(true);for(const value of [-1e10,1e10]){heat[0]=value;expect(validSnapshot(snapshot,grid.count)).toBe(false);}
 });
 it.each([true,false])('exports removed material at the effective temperature (layered=%s)',layered=>{
  const a=world(layered),air=a.climate.air;air.addSurfaceHeat(a.state,0,1e-5);const t=air.surfaceTemperature(a.state,0),h=totalEnthalpy(a.state,a.climate),commands=new Float32Array(grid.count*COMMAND_STRIDE);commands[5]=1;
  a.advance(0,commands,{...environment,climate:layered});
  expect(air.surfaceTemperature(a.state,0)).toBeCloseTo(t,12);expect(totalEnthalpy(a.state,a.climate)-h-a.energyChanges.reduce((x,y)=>x+y)).toBeCloseTo(0,3);
  expect(Math.abs(air.surfaceHeatCarry[0])).toBeLessThan(capacity(a.state,0)*Math.abs(a.state[F.temperature])*2**-23+Math.abs(phaseEnergy(a.state,0))*1e-14);
 });
});
