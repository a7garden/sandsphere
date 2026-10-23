import {snapshotSurface} from '../src/sim/session';
import {describe,it,expect} from 'vitest';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,totalEnthalpy,totalMass,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {AIR_LAYERS} from '../src/sim/layeredAtmosphere';
import {validClimate} from '../src/sim/weatherClimate';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {oceanScenario} from './helpers/oceanScenario';
const grid=createSphere(0),empty=new Float32Array(grid.count*COMMAND_STRIDE);
function fixture(){const p=oceanScenario(grid),s=new CpuSolver(grid,p.state);s.climate.restore(p.climate);return {s,e:p.environment,ledger:new Float32Array(grid.count*4)};}
function numerical(l:Float32Array){return l.reduce((a,b,i)=>a+(i%4===3?b:0),0);}
function momentum(s:CpuSolver){return [0,1,2].map(k=>s.climate.ocean.boundaryImpulse[k]+Array.from({length:grid.count},(_,i)=>s.climate.ocean.momentum[i*3+k]+s.climate.air.layerMass(i*AIR_LAYERS)*s.climate.air.velocity[i*AIR_LAYERS*3+k]).reduce((a,b)=>a+b,0));}
describe('finite ocean mechanical inventories',()=>{
 it.each([.01,60,1e8])('transfers equal opposite wind impulse and dissipates relative motion (%s seconds)',seconds=>{
  const {s,ledger}=fixture(),h=totalEnthalpy(s.state,s.climate),m=totalMass(s.state,s.climate),before=momentum(s),old=s.climate.air.velocity.slice();
  s.climate.ocean.stress(s.state,s.climate.air,seconds,ledger);
  expect(s.climate.ocean.kineticEnergy()).toBeGreaterThan(0);expect(totalMass(s.state,s.climate)).toBe(m);expect(Math.abs(totalEnthalpy(s.state,s.climate)-h-numerical(ledger))).toBeLessThan(1e-9);
  for(let k=0;k<3;k++)expect(momentum(s)[k]).toBeCloseTo(before[k],12);
  for(let i=0;i<grid.count;i++){const q=i*AIR_LAYERS;for(let k=0;k<3;k++){const air=s.climate.air.velocity[q*3+k],water=s.climate.ocean.momentum[i*3+k]/s.climate.ocean.mass[i];expect(Math.abs(air-water)).toBeLessThanOrEqual(Math.abs(old[q*3+k])+1e-12);}}
 });
 it('returns bed drag to heat and records the bed reaction without velocity clipping',()=>{
  const {s,ledger}=fixture();s.climate.ocean.stress(s.state,s.climate.air,100,ledger);ledger.fill(0);const h=totalEnthalpy(s.state,s.climate),k=s.climate.ocean.kineticEnergy(),before=momentum(s);
  s.climate.ocean.drag(s.state,600,ledger);expect(s.climate.ocean.kineticEnergy()).toBeCloseTo(k*Math.exp(-2),12);expect(totalEnthalpy(s.state,s.climate)-h-numerical(ledger)).toBeCloseTo(0,9);for(let k=0;k<3;k++)expect(momentum(s)[k]).toBeCloseTo(before[k],12);
 });
 it('settles disappearing liquid and mixes added water at rest with accounted heat',()=>{
  for(const factor of [0,.5,2]){const {s,ledger}=fixture();s.climate.ocean.stress(s.state,s.climate.air,100,ledger);for(let i=0;i<grid.count;i++)s.state[i*STRIDE+F.water]*=factor;ledger.fill(0);const h=totalEnthalpy(s.state,s.climate),before=momentum(s);s.climate.ocean.reconcile(s.state,ledger);expect(totalEnthalpy(s.state,s.climate)-h-numerical(ledger)).toBeCloseTo(0,9);for(let k=0;k<3;k++)expect(momentum(s)[k]).toBeCloseTo(before[k],12);if(factor===0)expect(s.climate.ocean.kineticEnergy()).toBe(0);}
 });
 it('advects salt, water, tangent momentum and energy on the sphere, with mixing heat',()=>{
  const {s,ledger}=fixture();s.climate.ocean.stress(s.state,s.climate.air,1e5,ledger);ledger.fill(0);const h=totalEnthalpy(s.state,s.climate),m=totalMass(s.state,s.climate),before=momentum(s),state=s.state.slice();s.climate.ocean.transport(s.state,100,1000,ledger);
  expect(s.state).not.toEqual(state);expect(totalMass(s.state,s.climate)).toBeCloseTo(m,5);expect(totalEnthalpy(s.state,s.climate)-h-numerical(ledger)).toBeCloseTo(0,8);for(let k=0;k<3;k++)expect(momentum(s)[k]).toBeCloseTo(before[k],10);
 });
 it('migrates unfunded legacy currents without minting or debiting energy',()=>{
  const {s,e}=fixture(),old=s.climate.snapshot();old.version=2;delete old.surfaceMassCarry;delete old.ocean;old.currents.fill(.01);const original=JSON.stringify(old);s.climate.restore(old);const h=totalEnthalpy(s.state,s.climate);s.climate.step(s.state,0,e,new Float32Array(grid.count*4));expect(s.climate.ocean.kineticEnergy()).toBe(0);expect(s.climate.currents.every(v=>v===0)).toBe(true);expect(totalEnthalpy(s.state,s.climate)-h).toBeCloseTo(0,8);expect(JSON.stringify(old)).toBe(original);
 });
 it('saves queued erasure and falling water with the same mechanical state as paused execution',()=>{
  const {s,e,ledger}=fixture();s.climate.ocean.stress(s.state,s.climate.air,100,ledger);const command=empty.slice();command[5]=.25;const shadow=snapshotSurface(s.state,command,[{index:0,material:'water',amount:1}],null,s.climate,e);s.advance(0,command,e);command.fill(0);command[0]=1;s.advance(0,command,e);expect(shadow.state).toEqual(s.state);expect(shadow.climate).toEqual(s.climate.snapshot());
 });
 it('exports erased kinetic energy and rolls back a failed transaction',()=>{
  const {s,e,ledger}=fixture();s.climate.ocean.stress(s.state,s.climate.air,100,ledger);const h=totalEnthalpy(s.state,s.climate),before=s.climate.ocean.kineticEnergy(),command=empty.slice();for(let i=0;i<grid.count;i++)command[i*COMMAND_STRIDE+5]=1;
  s.advance(0,command,e);expect(s.climate.ocean.kineticEnergy()).toBe(0);expect(before).toBeGreaterThan(0);expect(totalEnthalpy(s.state,s.climate)-h-s.energyChanges.reduce((a,b)=>a+b)).toBeCloseTo(0,3);
  const saved=s.climate.snapshot(),state=s.state.slice();command.fill(0);command[4]=-1e10;expect(()=>s.advance(.03,command,e)).toThrow();expect(s.state).toEqual(state);expect(s.climate.snapshot()).toEqual(saved);
 });
 it('approaches the same wind driven solution under timestep refinement',()=>{
  const runs=[1,2,4].map(parts=>{const {s,ledger}=fixture();for(let n=0;n<100*parts;n++){s.climate.ocean.stress(s.state,s.climate.air,1/parts,ledger);s.climate.ocean.drag(s.state,1/parts,ledger);}return s.climate.ocean.kineticEnergy();});expect(Math.abs(runs[2]-runs[1])).toBeLessThan(Math.abs(runs[1]-runs[0]));
 });
 it('validates mechanical saves and preserves their energy',()=>{
  const {s}=fixture();s.climate.ocean.stress(s.state,s.climate.air,100,new Float32Array(grid.count*4));const saved=s.climate.snapshot();expect(validClimate(saved,grid.count)).toBe(true);expect(totalEnthalpy(s.state,saved)).toBeCloseTo(totalEnthalpy(s.state,s.climate),8);
  for(const value of [-1,NaN,Infinity]){const corrupt=structuredClone(saved);corrupt.ocean!.mass[0]=value;expect(validClimate(corrupt,grid.count)).toBe(false);}
  const corrupt=structuredClone(saved);corrupt.ocean!.mass[0]=0;corrupt.ocean!.momentum[0]=1;expect(validClimate(corrupt,grid.count)).toBe(false);
 });
 it('runs 10,000 coupled steps and exactly resumes mechanical state',()=>{
  const {s,e}=fixture(),h=totalEnthalpy(s.state,s.climate),m=totalMass(s.state,s.climate);let external=0,roundoff=0,resumed:CpuSolver|undefined,maxK=0;
  for(let n=0;n<10000;n++){s.advance(1/30,empty,e);maxK=Math.max(maxK,s.climate.ocean.kineticEnergy());for(let k=0;k<s.energyChanges.length;k++)if(k%4===3)roundoff+=s.energyChanges[k];else external+=s.energyChanges[k];if(resumed&&n<5100){resumed.advance(1/30,empty,e);expect(resumed.state).toEqual(s.state);expect(resumed.climate.snapshot()).toEqual(s.climate.snapshot());}
   if(n===4999){const snapshot:Snapshot={version:11,preset:'coast',time:0,state:[...s.state],climate:s.climate.snapshot(),environment:e,planet:{primary:'rock'},supplied:0,removed:0,discoveries:[]};expect(validSnapshot(snapshot,grid.count)).toBe(true);const loaded=upgradeSnapshot(JSON.parse(JSON.stringify(snapshot)),grid.count);resumed=new CpuSolver(grid,new Float32Array(loaded.state));resumed.climate.restore(loaded.climate);}
  }
  const residual=totalEnthalpy(s.state,s.climate)-h-external-roundoff;expect(maxK).toBeGreaterThan(0);expect(s.state.every(Number.isFinite)).toBe(true);expect(validClimate(s.climate.snapshot(),grid.count)).toBe(true);expect(Math.abs(totalMass(s.state,s.climate)-m)/m).toBeLessThan(2e-5);expect(Math.abs(residual)/Math.abs(h)).toBeLessThan(2e-7);console.log('ocean soak',{maxK,massResidual:totalMass(s.state,s.climate)-m,residual,external,roundoff});
 },120000);
});
