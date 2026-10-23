import {describe,it,expect} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {CpuSolver,COMMAND_STRIDE,STRIDE,F,totalEnthalpy,type Snapshot,type Environment} from '../src/sim/model';
import {validLayered} from '../src/sim/layeredAtmosphere';
import {waterEquilibrium} from '../src/sim/phaseEquilibrium';
import {MIN_THERMODYNAMIC_TEMPERATURE,SPECIFIC_HEAT,MATERIAL_ENERGY} from '../src/sim/thermodynamics';
import {GASES} from '../src/sim/gases';
import {ATOMIC_MASS,elementalMass,type Element} from '../src/sim/chemistry';
import {upgradeSnapshot,validSnapshot} from '../src/sim/storage';
import {coldMethaneScenario} from './helpers/coldMethaneScenario';
import {airInventory} from './helpers/airInventory';
const grid=createSphere(0),empty=new Float32Array(grid.count*COMMAND_STRIDE);
function world(){const p=coldMethaneScenario(grid),solver=new CpuSolver(grid,p.state);solver.climate.restore(p.climate);return {solver,environment:p.environment};}
function save(s:CpuSolver,e:Environment):Snapshot{return {version:11,preset:'coast',time:30849.43333305271,state:[...s.state],environment:e,climate:s.climate.snapshot(),planet:{primary:'rock'},supplied:0,removed:0,discoveries:[]};}
describe('energy-defined cold atmosphere',()=>{
 it('solves the existing water enthalpy law below the old climate cutoff without heat correction',()=>{
  const dryCapacity=.15,water=.00045,t=-170,potential=6,h=(dryCapacity+water*SPECIFIC_HEAT[F.cloudIce])*t+water*MATERIAL_ENERGY[F.cloudIce]+potential;
  expect(()=>waterEquilibrium(dryCapacity,4,water,h,57510,potential,-150)).toThrow('상평형');
  const result=waterEquilibrium(dryCapacity,4,water,h,57510,potential);
  expect(result.temperature).toBeCloseTo(t,8);expect(result.energy).toBeCloseTo(h,9);expect(result.vapor+result.liquid+result.ice).toBeCloseTo(water,15);
  expect(()=>waterEquilibrium(dryCapacity,4,0,dryCapacity*-274,57510,0)).toThrow('상평형');
 });
 it('pays pressure acceleration from sensible energy and returns drag/mixing energy as heat',()=>{
  const {solver,environment}=world(),air=solver.climate.air,internal=air as unknown as {dynamics(dt:number,e:Environment):void;commit():void},commit=internal.commit.bind(air);
  const components=()=>{let sensible=0,kinetic=0;for(let q=0;q<air.temperature.length;q++){sensible+=air.layerCapacity(q)*air.temperature[q];kinetic+=air.layerMass(q)*(air.velocity[q*3]**2+air.velocity[q*3+1]**2+air.velocity[q*3+2]**2)/2000;}return {sensible,kinetic,h:air.totalEnergy()};};
  const before=components(),openingRoundoff=air.checkpoint().roundoff;let force:ReturnType<typeof components>|undefined;
  internal.commit=()=>{force??=components();commit();};internal.dynamics(1,environment);
  expect(force).toBeDefined();expect(force!.kinetic).toBeGreaterThan(before.kinetic);expect(force!.sensible).toBeLessThan(before.sensible);
  expect(force!.h).toBeCloseTo(before.h,9);expect((force!.sensible-before.sensible)+(force!.kinetic-before.kinetic)).toBeCloseTo(0,9);
  // Advection separately records reference/material arithmetic residuals.
  // Keep the physical budget tolerance and independently bound that ledger.
  const numerical=air.checkpoint().roundoff.map((v,i)=>v-openingRoundoff[i]);
  expect(numerical.reduce((a,b)=>a+Math.abs(b),0)).toBeLessThan(5e-9);
  expect(air.totalEnergy()-before.h-numerical.reduce((a,b)=>a+b,0)).toBeCloseTo(0,9);
 });
 it('continues 10,000 steps across the old cutoff with finite stocks and separate external/roundoff ledgers',()=>{
  const {solver,environment}=world(),start=airInventory(solver),initialH=totalEnthalpy(solver.state,solver.climate),lost=new Float64Array(STRIDE);let external=0,correction=0,min=Infinity;
  for(let n=0;n<10000;n++){
   solver.advance(1/30,empty,environment);external+=solver.energyChanges.reduce((a,b)=>a+b);correction+=solver.energyChanges.filter((_,i)=>i%4===3).reduce((a,b)=>a+b);
   for(let i=0;i<grid.count;i++)for(let k=0;k<GASES.length;k++)lost[GASES[k].field]+=solver.escapeCells[i*GASES.length+k];min=Math.min(min,...solver.climate.air.temperature);
  }
  const after=airInventory(solver);for(let f=0;f<STRIDE;f++)after[f]+=lost[f];const a=elementalMass(start),b=elementalMass(after);
  expect(min).toBeLessThan(-150);expect(min).toBeGreaterThan(MIN_THERMODYNAMIC_TEMPERATURE);expect(solver.climate.air.mass.every(m=>Number.isFinite(m)&&m>=0)).toBe(true);
  expect(Math.abs(after.reduce((a,b)=>a+b)-start.reduce((a,b)=>a+b))).toBeLessThan(1e-6);for(const k of Object.keys(ATOMIC_MASS) as Element[])expect(Math.abs(b[k]-a[k])).toBeLessThan(1e-6*Math.max(1,a[k]));
  console.log('cold soak',{steps:10000,min,initialH,correction,massResidual:after.reduce((a,b)=>a+b)-start.reduce((a,b)=>a+b),energyResidual:totalEnthalpy(solver.state,solver.climate)-initialH-external,surfaceMin:Math.min(...solver.state.filter((_,i)=>i%STRIDE===F.temperature))});
  expect(Math.abs(totalEnthalpy(solver.state,solver.climate)-initialH-external)).toBeLessThan(1e-6);expect(Math.abs(correction)/Math.abs(initialH)).toBeLessThan(2e-4);
 },process.env.CI?270000:90000);
 it('reads old v11/v6 metadata unchanged, then saves and exactly resumes cold evolved air',()=>{
  const {solver,environment}=world(),old=save(solver,environment),text=JSON.stringify(old);expect(validSnapshot(old,grid.count)).toBe(true);const loaded=upgradeSnapshot(old,grid.count);expect(JSON.stringify(old)).toBe(text);expect(loaded.state).toEqual(old.state);expect(loaded.climate).toEqual(old.climate);
  for(let n=0;n<300;n++)solver.advance(1/30,empty,environment);expect(Math.min(...solver.climate.air.temperature)).toBeLessThan(-150);
  const cold=JSON.parse(JSON.stringify(save(solver,environment)));expect(cold.climate.atmosphere.minTemperature).toBe(-150);expect(validSnapshot(cold,grid.count)).toBe(true);
  const restored=new CpuSolver(grid,new Float32Array(cold.state));restored.climate.restore(cold.climate);
  for(let n=0;n<60;n++){solver.advance(1/30,empty,environment);restored.advance(1/30,empty,environment);}expect(restored.state).toEqual(solver.state);expect(restored.climate.snapshot()).toEqual(solver.climate.snapshot());
 });
 it('keeps the cold solution when the integration interval is halved',()=>{
  // Start below the air solver’s one-physical-second substep ceiling, so
  // all three runs actually refine its integration interval.
  const a=world(),b=world(),c=world();for(let n=0;n<120;n++)a.solver.advance(1/60,empty,a.environment);for(let n=0;n<240;n++)b.solver.advance(1/120,empty,b.environment);for(let n=0;n<480;n++)c.solver.advance(1/240,empty,c.environment);
  expect(Math.min(...a.solver.climate.air.temperature)).toBeLessThan(-150);expect(Math.min(...b.solver.climate.air.temperature)).toBeLessThan(-150);
  const coarse=Math.max(...a.solver.climate.air.temperature.map((t,i)=>Math.abs(t-b.solver.climate.air.temperature[i]))),fine=Math.max(...b.solver.climate.air.temperature.map((t,i)=>Math.abs(t-c.solver.climate.air.temperature[i])));
  expect(coarse).toBeLessThan(.1);expect(fine).toBeLessThan(coarse*.6);
 });
 it('rejects nonphysical Kelvin states and rolls back an invalid energy state instead of clipping it',()=>{
  const {solver,environment}=world(),bad=solver.climate.air.snapshot()!;bad.temperature[0]=-273.15;expect(validLayered(bad,grid.count)).toBe(false);bad.temperature[0]=NaN;expect(validLayered(bad,grid.count)).toBe(false);
  // A deliberately invalid finite energy state must still fail atomically.
  solver.climate.air.temperature[0]=-274;const before=solver.state.slice(),checkpoint=solver.climate.snapshot();expect(()=>solver.advance(1/30,empty,environment)).toThrow();expect(solver.state).toEqual(before);expect(solver.climate.snapshot()).toEqual(checkpoint);expect(solver.energyChanges.every(v=>v===0)).toBe(true);
 });
});
