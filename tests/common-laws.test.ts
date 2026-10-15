import {describe,it,expect} from 'vitest';
import {conductiveExchange,mechanicalEnergy,phaseChangeEnergy,SPECIFIC_HEAT,PHASE_ENERGY} from '../src/sim/thermodynamics';
import {outgoingScale,queueSpecies,carryVelocity,queueEnergyMomentum,commitMomentum} from '../src/sim/conservativeTransport';
import {materialReaction,reactInventory} from '../src/sim/materialReaction';
import {waterEquilibrium,solveEnthalpy} from '../src/sim/phaseEquilibrium';
import {saturationPressure} from '../src/sim/waterPhysics';
import {saturationPressure as deepSaturation} from '../src/sim/giantCloudPhysics';
import {createSphere} from '../src/sim/sphere';
import {createDefinedPlanet,createMarsPlanet} from '../src/sim/planetCreation';
import {JUPITER_DEFINITION} from '../src/sim/planetDefinition';
import {CpuSolver,COMMAND_STRIDE,F,STRIDE,totalEnthalpy,totalMass,type Snapshot} from '../src/sim/model';
import {upgradeSnapshot,validSnapshot} from '../src/sim/storage';
import {BackgroundWorlds,advanceOrbit,type PlanetRecord} from '../src/sim/system';

describe('shared finite reservoir laws',()=>{
 it('derives phase-change costs at the limiting temperature, including changed heat capacity',()=>{
  expect(phaseChangeEnergy(F.water,F.vapor,100)).toBe(2257);
  expect(phaseChangeEnergy(F.ice,F.vapor,-100)).toBe(2819);
  expect(phaseChangeEnergy(F.ice,F.vapor,0)).toBe(2809);
 });
 it('exchanges finite heat without crossing equilibrium, with no dependence on time partition',()=>{
  const ca=2,cb=13,a=80,b=-10,heat=conductiveExchange(a,b,ca,cb,4,100);
  expect(ca*(a-heat/ca)+cb*(b+heat/cb)).toBeCloseTo(ca*a+cb*b,12);
  expect(a-heat/ca).toBeCloseTo(b+heat/cb,12);
  const first=conductiveExchange(a,b,ca,cb,4,.2),second=conductiveExchange(a-first/ca,b+first/cb,ca,cb,4,.3);
  expect(first+second).toBeCloseTo(conductiveExchange(a,b,ca,cb,4,.5),12);
  expect(conductiveExchange(20,20,ca,cb,4,100)).toBe(0);
  expect(conductiveExchange(a,b,0,cb,4,100)).toBe(0);
 });
 it('limits all neighbors together, preserving each species and transported energy',()=>{
  const mass=new Float64Array([2,1,0,0,0,0]),delta=new Float64Array(6),heat=new Float64Array(3),momentum=new Float64Array(9),velocity=new Float64Array([4,0,0,0,0,0,0,0,0]);
  const requests=[.8,.7],scale=outgoingScale(1,requests.reduce((a,b)=>a+b),.9);
  for(let edge=0;edge<2;edge++){
   const f=requests[edge]*scale;
   for(let k=0;k<2;k++)queueSpecies(mass,delta,2,0,edge+1,k,f);
   queueEnergyMomentum(0,edge+1,3*f,100*f,velocity,[4,0,0],heat,momentum);
  }
  for(let k=0;k<6;k++)mass[k]+=delta[k];
  expect(mass.every(v=>v>=0)).toBe(true);expect(mass[0]+mass[2]+mass[4]).toBeCloseTo(2,14);expect(mass[1]+mass[3]+mass[5]).toBeCloseTo(1,14);
  expect(heat.reduce((a,b)=>a+b)).toBeCloseTo(0,12);
  for(let q=0;q<3;q++)commitMomentum(q,q===0?3:0,mass[q*2]+mass[q*2+1],velocity,momentum);
  velocity.forEach((v,i)=>expect(v).toBeCloseTo(i%3===0?4:0,12));
 });
 it('parallel-transports tangent momentum reversibly without changing kinetic energy',()=>{
  const directions=[1,0,0,0,1,0],velocity=[0,3,4],out=new Float64Array(3),back=new Float64Array(3);
  carryVelocity(velocity,0,directions,0,1,out);expect(out[1]).toBeCloseTo(0,14);expect(out.reduce((a,v)=>a+v*v,0)).toBeCloseTo(25,14);
  carryVelocity(out,0,directions,1,0,back);expect([...back]).toEqual(velocity);
  expect(mechanicalEnergy(2,9.81,1000,25)).toBeCloseTo(19.645,12);
 });
 it('bounds a multi-reactant conversion by the limiting stock and rejects a mass source',()=>{
  const reaction=materialReaction([[0,2],[1,1]],[[2,3]]),stock=[4,.5,0];
  expect(reactInventory(stock,0,reaction,10)).toBe(.5);expect(stock).toEqual([3,0,1.5]);
  expect(reactInventory(stock,0,reaction,10)).toBe(0);expect(stock.reduce((a,b)=>a+b)).toBe(4.5);
  expect(()=>materialReaction([[0,1]],[[1,2]])).toThrow('질량');
 });
 it.each([-150,-30,0,20,90])('uses one water saturation curve at %s C in every atmosphere',t=>{
  expect(deepSaturation('water',t)).toBe(saturationPressure(t,t<0?'ice':'water'));
 });
 it('condenses finite water, preserves enthalpy and resolves a mixed-phase plateau',()=>{
  const water=.02,cp=10,t=-30,h=(cp+water*SPECIFIC_HEAT[9])*t+water*PHASE_ENERGY[9];
  const r=waterEquilibrium(cp,30,water,h,1e5,0);
  expect(r.ice).toBeGreaterThan(0);expect(r.temperature).toBeGreaterThan(t);expect(r.vapor+r.ice+r.liquid).toBeCloseTo(water,14);expect(r.energy).toBeCloseTo(h,8);
  const mixed=waterEquilibrium(1,0,1,-167,1e5,0);expect(mixed.temperature).toBe(0);expect(mixed.ice).toBe(.5);expect(mixed.liquid).toBe(.5);
  expect(()=>solveEnthalpy(t=>({energy:2*t}),30,0,10,5)).toThrow('범위');
 });
});

const grid=createSphere(1),commands=new Float32Array(grid.count*COMMAND_STRIDE);
const plain={referenceTemperatureKelvin:165,minimumTemperatureKelvin:110,jetSpeed:0,temperaturePerturbation:0,cloudBands:false};
function giant(){const p=createDefinedPlanet(grid,JUPITER_DEFINITION,plain),solver=new CpuSolver(grid,p.state.slice());solver.climate.restore(p.climate);return {...p,solver};}
describe('common laws across execution domains',()=>{
 it('does not use a planet label for evolution or aggregate-only initialization',()=>{
  const p=giant(),a=p.solver,b=new CpuSolver(grid,p.state.slice()),renamed=structuredClone(p.environment);renamed.body!.preset='saturn';b.climate.restore(p.climate);
  a.advance(.2,commands,p.environment);b.advance(.2,commands,renamed);expect(b.state.every((v,i)=>v===a.state[i])).toBe(true);expect(JSON.stringify(b.climate.snapshot())).toBe(JSON.stringify(a.climate.snapshot()));
  const x=new CpuSolver(grid,p.state.slice()),y=new CpuSolver(grid,p.state.slice());
  x.advance(1/30,commands,p.environment);y.advance(1/30,commands,renamed);expect(y.state).toEqual(x.state);expect(y.climate.snapshot()).toEqual(x.climate.snapshot());
 });
 it('develops circulation from directional heating without seeded bands or jets, with a no-sun control',()=>{
  const p=giant(),dark=giant(),mass=totalMass(p.solver.state,p.solver.climate),energy=totalEnthalpy(p.solver.state,p.solver.climate);let external=0;
  expect(p.solver.climate.giant.velocity.every(v=>v===0)).toBe(true);
  for(let n=0;n<120;n++){
   p.solver.advance(.5,commands,p.environment);external+=p.solver.energyChanges.reduce((a,b)=>a+b,0);
   dark.solver.advance(.5,commands,{...dark.environment,sunlight:0});
  }
  const lightWind=Math.max(...p.solver.climate.giant.velocity.map(Math.abs)),darkWind=Math.max(...dark.solver.climate.giant.velocity.map(Math.abs));
  expect(lightWind).toBeGreaterThan(1e-5);expect(darkWind).toBeLessThan(1e-9);
  expect(totalMass(p.solver.state,p.solver.climate)).toBeCloseTo(mass,9);expect(totalEnthalpy(p.solver.state,p.solver.climate)-energy-external).toBeCloseTo(0,5);
  console.log('unseeded circulation control',{lightWind,darkWind});
 });
 it.each(['surface','deep'] as const)('preserves JSON saves, exact restart and active/background equivalence (%s)',kind=>{
  const p=kind==='deep'?giant():createMarsPlanet(grid),a=new CpuSolver(grid,p.state.slice());if(p.climate)a.climate.restore(p.climate);
  a.advance(.1,commands,p.environment);
  const saved:Snapshot={version:11,preset:'coast',time:.1,state:[...a.state],climate:a.climate.snapshot(),environment:p.environment,spin:p.spin,discoveries:[],supplied:0,removed:0,...(kind==='surface'?{planet:{primary:p.primary}}:{})},original=JSON.parse(JSON.stringify(saved)),before=structuredClone(original),upgraded=upgradeSnapshot(original,grid.count);
  expect(original).toEqual(before);expect(validSnapshot(upgraded,grid.count)).toBe(true);
  const b=new CpuSolver(grid,new Float32Array(upgraded.state));b.climate.restore(upgraded.climate);
  const planets:PlanetRecord[]=[{id:'planet-test',name:'test',snapshot:structuredClone(upgraded)}],orbit=structuredClone(upgraded);
  for(let n=0;n<3;n++){advanceOrbit(orbit,1/30);a.advance(1/30,commands,orbit.environment);b.advance(1/30,commands,orbit.environment);}
  new BackgroundWorlds(grid).step(planets,'other',.1);
  expect(b.state.every((v,i)=>v===a.state[i])).toBe(true);expect(JSON.stringify(b.climate.snapshot())).toBe(JSON.stringify(a.climate.snapshot()));
  expect(planets[0].snapshot.state.every((v,i)=>v===a.state[i])).toBe(true);expect(JSON.stringify(planets[0].snapshot.climate)).toBe(JSON.stringify(a.climate.snapshot()));
 });
});
