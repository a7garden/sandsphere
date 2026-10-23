import {describe,it,expect} from 'vitest';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,totalMass,type Environment} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {measurePlanet,type TelemetryInput} from '../src/sim/telemetry';
import {atmosphereState,GASES,REFERENCE_COLUMN_MASS} from '../src/sim/atmosphere';
import {CHEMICAL_ENERGY} from '../src/sim/thermodynamics';
import {AIR_SPECIES} from '../src/sim/layeredAtmosphere';
import {snapshotSurface} from '../src/sim/session';

const environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:false};
function input(solver:CpuSolver,e=environment):TelemetryInput{return {time:1,state:solver.state,climate:solver.climate.snapshot(),environment:e,supplied:0,removed:0,escaped:0,transferredIn:0,transferredOut:0};}

describe('canonical inventory observations',()=>{
 it('reports retained surface inventory in species, water and chemical-energy measurements',()=>{
  const grid=createSphere(0),solver=new CpuSolver(grid,new Float32Array(grid.count*STRIDE)),actual=new Float64Array(solver.state);
  for(let i=0;i<grid.count;i++)actual[i*STRIDE+F.temperature]=20;
  actual[F.water]=1000-.00001;actual[F.vapor]=.001+.00000000001;
  actual[F.cloud]=.02-.0000000001;actual[F.methane]=100+.000001;actual[F.nitrogen]=.3;
  actual[F.soot]=.1+.000000001;actual[F.plant]=.5+.00000001;
  solver.state=solver.climate.publishSurface(actual);
  expect(solver.state[F.water]).not.toBe(actual[F.water]);
  const values=measurePlanet(input(solver)).values;
  expect(values.water).toBe(actual[F.water]);expect(values.vapor).toBe(actual[F.vapor]);
  expect(values.waterTotal).toBe(actual[F.water]+actual[F.vapor]+actual[F.cloud]);
  expect(values.methane).toBe(actual[F.methane]);expect(values.soot).toBe(actual[F.soot]);
  expect(values.biomass).toBe(actual[F.plant]);
  const chemical=[F.water,F.vapor,F.cloud,F.methane,F.nitrogen,F.soot,F.plant].reduce((sum,f)=>sum+actual[f]*CHEMICAL_ENERGY[f],0);
  expect(values.chemicalEnergy).toBe(chemical);
  const gases=GASES.reduce((sum,g)=>sum+actual[g.field],0);
  const observed=atmosphereState(solver.state,environment,solver.climate);
  expect(observed.mass).toBe(gases);expect(values.gas).toBe(gases);
  expect(observed.species.find(g=>g.id==='methane')!.mass).toBe(actual[F.methane]);
  expect(atmosphereState(solver.state,environment,solver.climate.snapshot())).toEqual(observed);
  expect(measurePlanet({...input(solver),climate:JSON.parse(JSON.stringify(solver.climate.snapshot()))})).toEqual(measurePlanet(input(solver)));
 });

 it('counts authoritative layered gas and aerosols once when their Float32 mirrors lose low bits',()=>{
  const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE);
  for(let i=0;i<grid.count;i++){state[i*STRIDE+F.rock]=1;state[i*STRIDE+F.temperature]=20;state[i*STRIDE+F.nitrogen]=.3;}
  const solver=new CpuSolver(grid,state),e={...environment,climate:true},commands=new Float32Array(grid.count*COMMAND_STRIDE);commands[4]=1;
  solver.advance(0,commands,e);
  const air=solver.climate.air;air.mass.fill(0);air.dustMass.fill(0);air.temperature.fill(20);air.velocity.fill(0);
  const vapor=1000+.00001,nitrogen=2+.00000003,cloud=.1+.000000001,soot=.2+.000000001,dust=.3+.00000001;
  air.mass[0]=vapor;air.mass[1]=nitrogen;air.mass[4]=cloud;air.mass[8]=soot;air.dustMass[0]=dust;
  air.attach(solver.state);
  expect(solver.state[F.vapor]).not.toBe(vapor);expect(AIR_SPECIES).toBe(9);
  const observed=atmosphereState(solver.state,e,solver.climate),saved=solver.climate.snapshot(),values=measurePlanet(input(solver,e)).values;
  expect(observed.mass).toBe(vapor+nitrogen);expect(observed.dustMass).toBe(dust);
  expect(observed.pressure).toBe((vapor+nitrogen+dust+soot+cloud)/(grid.count*REFERENCE_COLUMN_MASS));
  expect(observed.species.find(g=>g.id==='vapor')!.mass).toBe(vapor);
  expect(values.gas).toBe(vapor+nitrogen);expect(values.vapor).toBe(vapor);expect(values.cloudWater).toBe(cloud);
  expect(values.waterTotal).toBe(vapor+cloud);expect(values.soot).toBe(soot);expect(values.airborneDust).toBe(dust);
  expect(atmosphereState(solver.state,e,saved)).toEqual(observed);
  expect(observed.species.reduce((sum,g)=>sum+g.fraction,0)).toBeCloseTo(1,15);
 });

 it.each([false,true])('settles erasure and collection from the same canonical inventory as the solver (layered=%s)',layered=>{
  const grid=createSphere(0),solver=new CpuSolver(grid,new Float32Array(grid.count*STRIDE)),actual=new Float64Array(solver.state),e={...environment,climate:layered};
  for(let i=0;i<grid.count;i++)actual[i*STRIDE+F.temperature]=20;
  actual[F.water]=1000-.00001;actual[F.glass]=100+.000001;actual[F.nitrogen]=.3+.000000001;
  solver.state=solver.climate.publishSurface(actual);
  const before=totalMass(solver.state,solver.climate),commands=new Float32Array(grid.count*COMMAND_STRIDE);commands[5]=.125;commands[6]=.25;
  const captured=snapshotSurface(solver.state,commands,[],null,solver.climate,e);
  expect(captured.pendingRemoved).toBeCloseTo(before*.125,12);
  expect(captured.collected.glass).toBeCloseTo(actual[F.glass]*.875*.25,12);
  solver.advance(0,commands,e);
  expect(captured.state).toEqual(solver.state);expect(captured.climate).toEqual(solver.climate.snapshot());
  const collected=Object.values(captured.collected).reduce((sum,mass)=>sum+mass,0);
  expect(totalMass(captured.state,captured.climate)+captured.pendingRemoved+collected-before).toBeCloseTo(0,10);
 });
});
