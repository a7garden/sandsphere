import {describe,it,expect} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,MASS_FIELDS,react,enthalpy,totalEnthalpy,totalMass,type Snapshot,type Environment} from '../src/sim/model';
import {MIN_THERMODYNAMIC_TEMPERATURE,thermalTransferLimit,specificEnthalpy} from '../src/sim/thermodynamics';
import {waterEquilibrium} from '../src/sim/phaseEquilibrium';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {radiativeHeat} from '../src/sim/weatherClimate';
import {GASES} from '../src/sim/gases';
import {ATOMIC_MASS,elementalMass,type Element} from '../src/sim/chemistry';
import {surfaceThermalScenario} from './helpers/surfaceThermalScenario';
import {airInventory} from './helpers/airInventory';
const grid=createSphere(0),empty=new Float32Array(grid.count*COMMAND_STRIDE);
function save(s:CpuSolver,e:Environment):Snapshot{return {version:11,preset:'coast',time:0,state:[...s.state],climate:s.climate.snapshot(),environment:e,planet:{primary:'rock'},supplied:0,removed:0,discoveries:[]};}
function inventory(s:CpuSolver){if(s.climate.air.ready)return airInventory(s);const stock=new Float64Array(STRIDE);for(let p=0;p<s.state.length;p+=STRIDE)for(const f of MASS_FIELDS)stock[f]+=s.state[p+f];return stock;}
describe('surface temperature follows finite energy',()=>{
 it.each([-270,-201,-101,2501,4000])('does not change a closed inert surface at %s C',temperature=>{
  const s=new Float32Array(grid.count*STRIDE);s[F.temperature]=temperature;s[F.rock]=8;
  const before=s.slice(),h=enthalpy(s,0),ledger=new Float32Array(grid.count*4);
  react(s,0,1/30,{ambient:18,sunlight:0,sun:[1,0,0],climate:true},grid,undefined,undefined,undefined,ledger);
  expect(s).toEqual(before);expect(enthalpy(s,0)).toBe(h);expect([...ledger].every(v=>v===0)).toBe(true);
 });
 it('pays the exact departing enthalpy and capacity, leaving the cold reservoir inside the Kelvin domain',()=>{
  const t=-270,c=30,carried=specificEnthalpy(F.vapor,t)+4.905;
  const amount=thermalTransferLimit(10,c,t,F.ice,carried);
  const final=(c*t-amount*(carried-specificEnthalpy(F.ice,0)))/(c-amount*2.1);
  expect(amount).toBeGreaterThan(0);expect(amount).toBeLessThan(10);expect(final).toBeCloseTo(MIN_THERMODYNAMIC_TEMPERATURE,10);
 });
 it('solves hot water enthalpy and implicit radiative cooling beyond the former bounds',()=>{
  const h=3*4000+.01*2475,r=waterEquilibrium(2.98,10,.01,h,1e5,0);expect(r.temperature).toBeCloseTo(4000,8);expect(r.energy).toBeCloseTo(h,8);
  for(const t of [-260,4000]){const next=t+radiativeHeat(30,t,0,0,10)/30;expect(next).toBeLessThanOrEqual(t);expect(next).toBeGreaterThan(-273.15);}
 });
 it.each([-260,4000])('crosses the old boundaries only by the supplied energy (%s C)',target=>{
  const s=new CpuSolver(grid,new Float32Array(grid.count*STRIDE)),commands=empty.slice(),h=totalEnthalpy(s.state);
  commands[4]=28*target;s.advance(0,commands,{ambient:18,sunlight:0,sun:[1,0,0]});
  expect(s.state[F.temperature]).toBe(target);expect(totalEnthalpy(s.state)-h).toBe(commands[4]);expect(s.energyChanges[1]).toBe(commands[4]);expect(s.energyChanges[3]).toBe(0);
 });
 it.each([-260,4000])('keeps the coupled transient consistent when the timestep is halved (%s C)',t=>{
  const p=surfaceThermalScenario(grid,t,true),solvers=[1,2,4].map(()=>{const s=new CpuSolver(grid,p.state.slice());s.climate.restore(p.climate);s.climate.air.temperature.fill(t<0?-270:1000);return s;});
  for(let k=0;k<3;k++)for(let n=0;n<60*2**k;n++)solvers[k].advance(1/(30*2**k),empty,p.environment);
  const difference=(a:CpuSolver,b:CpuSolver)=>Math.max(...a.state.filter((_,i)=>i%STRIDE===F.temperature).map((v,i)=>Math.abs(v-b.state[i*STRIDE+F.temperature])));
  const coarse=difference(solvers[0],solvers[1]),fine=difference(solvers[1],solvers[2]);
  expect(coarse).toBeLessThan(.003);expect(fine).toBeLessThan(.003);
  console.log('surface timestep refinement',{t,coarse,fine,finalT:solvers[0].state[F.temperature]});
 });
 it.each([false,true])('rejects impossible cooling atomically, including paused commands (layered=%s)',layered=>{
  const p=surfaceThermalScenario(grid,-260,layered),s=new CpuSolver(grid,p.state);s.climate.restore(p.climate);
  const before=s.state.slice(),climate=s.climate.snapshot(),commands=empty.slice();commands[4]=-1e9;
  for(const dt of [0,.1]){expect(()=>s.advance(dt,commands,p.environment)).toThrow();expect(s.state).toEqual(before);expect(s.climate.snapshot()).toEqual(climate);expect(s.energyChanges.every(v=>v===0)).toBe(true);}
 });
 it('reads legacy cold/hot v1 stocks and current out-of-profile saves without changing their energy',()=>{
  for(const t of [-100,2500,-260,4000]){
   const p=surfaceThermalScenario(grid,t,false),s=new CpuSolver(grid,p.state),current=save(s,p.environment),original=JSON.stringify(current);
   expect(validSnapshot(current,grid.count)).toBe(true);expect(upgradeSnapshot(current,grid.count).state).toEqual(current.state);expect(JSON.stringify(current)).toBe(original);
   if(t===-100||t===2500){const old={...current,version:1,climate:undefined,environment:{...current.environment,body:undefined},state:current.state.filter((_,i)=>i%STRIDE<16)};expect(validSnapshot(old,grid.count)).toBe(true);const upgraded=upgradeSnapshot(old as Snapshot,grid.count);expect(upgraded.state).toEqual(current.state);}
   for(const bad of [-273.15,NaN,Infinity,1e100]){const corrupt=structuredClone(current);corrupt.state[F.temperature]=bad;expect(validSnapshot(corrupt,grid.count)).toBe(false);}
  }
 });
 it.each([{t:-260,layered:false},{t:4000,layered:false},{t:-260,layered:true},{t:4000,layered:true}])('runs 10,000 steps and resumes without hidden heat: $t C, layered=$layered',({t,layered})=>{
  const p=surfaceThermalScenario(grid,t,layered),s=new CpuSolver(grid,p.state);s.climate.restore(p.climate);
  const initialH=totalEnthalpy(s.state,s.climate),initialM=totalMass(s.state,s.climate),start=elementalMass(inventory(s)),lost=new Float64Array(STRIDE);let external=0,numerical=0,min=t,max=t,resumed:CpuSolver|undefined;
  for(let n=0;n<10000;n++){
   s.advance(1/30,empty,p.environment);
   if(resumed&&n<5100){resumed.advance(1/30,empty,p.environment);expect(resumed.state).toEqual(s.state);expect(resumed.climate.snapshot()).toEqual(s.climate.snapshot());}
   for(let k=0;k<s.energyChanges.length;k++)if(k%4===3)numerical+=s.energyChanges[k];else external+=s.energyChanges[k];
   for(let i=0;i<grid.count;i++){const value=s.state[i*STRIDE+F.temperature];min=Math.min(min,value);max=Math.max(max,value);for(let k=0;k<GASES.length;k++)lost[GASES[k].field]+=s.escapeCells[i*GASES.length+k];}
   if(n===4999){const snapshot=JSON.parse(JSON.stringify(save(s,p.environment)));expect(validSnapshot(snapshot,grid.count)).toBe(true);const upgraded=upgradeSnapshot(snapshot,grid.count);resumed=new CpuSolver(grid,new Float32Array(upgraded.state));resumed.climate.restore(upgraded.climate);}
  }
  const stock=inventory(s);for(let f=0;f<STRIDE;f++)stock[f]+=lost[f];const end=elementalMass(stock),massResidual=stock.reduce((a,b)=>a+b)-initialM,energyResidual=totalEnthalpy(s.state,s.climate)-initialH-external-numerical;
  const elementResidual=Math.max(...Object.keys(ATOMIC_MASS).map(k=>Math.abs(end[k as Element]-start[k as Element])/Math.max(1,start[k as Element])));
  expect(s.state.every(Number.isFinite)).toBe(true);expect(inventory(s).every(v=>v>=0)).toBe(true);expect(min).toBeGreaterThan(MIN_THERMODYNAMIC_TEMPERATURE);
  expect(Math.abs(massResidual)/initialM).toBeLessThan(2e-5);expect(elementResidual).toBeLessThan(2e-5);expect(Math.abs(energyResidual)/Math.abs(initialH)).toBeLessThan(2e-7);expect(Math.abs(numerical)/Math.abs(initialH)).toBeLessThan(5e-4);
  expect(t<0?min<-200:max>2500).toBe(true);
  console.log('surface thermal soak',{t,layered,steps:10000,min,max,finalT:s.state[F.temperature],initialH,external,numerical,massResidual,elementResidual,energyResidual});
 },120000);
});
