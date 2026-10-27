import {describe,it,expect} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {COMMAND_STRIDE,CpuSolver,STRIDE,seedPlanet,type Snapshot} from '../src/sim/model';
import {createDefinedPlanet} from '../src/sim/planetCreation';
import {JUPITER_DEFINITION,MARS_DEFINITION,planetSupport,type PlanetDefinition} from '../src/sim/planetDefinition';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {advanceOrbit} from '../src/sim/system';
import {orbitalEnvironment} from '../src/sim/orbit';
import {DEEP_LAYERS,DEEP_SPECIES,validDeep} from '../src/sim/deepAtmosphere';
import type {DeepInitialConditions} from '../src/sim/deepAtmosphereProfile';

const grid=createSphere(0),commands=new Float32Array(grid.count*COMMAND_STRIDE);
const custom=(base=JUPITER_DEFINITION):PlanetDefinition=>({...structuredClone(base),preset:'custom'});
function world(definition=custom(),initial?:DeepInitialConditions){
 const p=createDefinedPlanet(grid,definition,initial),solver=new CpuSolver(grid,p.state.slice());solver.climate.restore(p.climate);return {...p,solver};
}
function save(p:ReturnType<typeof world>):Snapshot {
 return {version:11,preset:'coast',time:0,state:[...p.solver.state],climate:p.solver.climate.snapshot(),environment:structuredClone(p.environment),spin:{...p.spin},supplied:0,removed:0,discoveries:[],...(p.solver.climate.giant.ready?{}:{planet:{primary:p.primary}})};
}

describe('planet creation, execution and persistence share supported inputs',()=>{
 const close=custom();close.orbit.distanceAu=.5;
 const fast=custom();fast.rotation.periodSeconds=1000;
 const slow=custom();slow.rotation.periodSeconds=200000;
 const remote=custom(MARS_DEFINITION);remote.orbit.distanceAu=100;
 const near=custom(MARS_DEFINITION);near.orbit.distanceAu=.05;
 const fastest=custom();fastest.rotation.periodSeconds=1;
 const slowest=custom();slowest.rotation.periodSeconds=1e12;
 const nearGiant=custom();nearGiant.orbit.distanceAu=.05;
 const remoteGiant=custom();remoteGiant.orbit.distanceAu=100;
 const cases:[string,PlanetDefinition,DeepInitialConditions?][]=[['half AU',close],['1000 second spin',fast],['200000 second spin',slow],['500 K initial',custom(),{referenceTemperatureKelvin:500,minimumTemperatureKelvin:110,jetSpeed:0,temperaturePerturbation:0,cloudBands:false}],['100 AU rocky',remote],['.05 AU rocky',near],['.05 AU giant',nearGiant],['100 AU giant',remoteGiant],['minimum definition spin',fastest],['maximum definition spin',slowest]];
 it.each(cases)('persists and exactly resumes %s without rewriting inputs',(_name,definition,initial)=>{
  expect(planetSupport(definition,initial?{initial}:undefined).supported).toBe(true);
  const p=world(definition,initial),created=save(p),copy=JSON.parse(JSON.stringify(created)) as Snapshot;
  expect(validSnapshot(created,grid.count)).toBe(true);expect(validSnapshot(copy,grid.count)).toBe(true);
  expect(upgradeSnapshot(copy,grid.count)).toEqual(copy);expect(copy.environment.body).toEqual(definition);
  expect(copy.spin!.period).toBe(definition.rotation.periodSeconds/60);
  const resumed=new CpuSolver(grid,new Float32Array(copy.state));resumed.climate.restore(copy.climate);
  for(let n=0;n<3;n++){
   advanceOrbit(created,1/30);advanceOrbit(copy,1/30);
   p.solver.advance(1/30,commands,created.environment);resumed.advance(1/30,commands,copy.environment);
  }
  const evolved={...copy,state:[...resumed.state],climate:resumed.climate.snapshot()};
  expect(validSnapshot(evolved,grid.count)).toBe(true);expect(resumed.state).toEqual(p.solver.state);expect(resumed.climate.snapshot()).toEqual(p.solver.climate.snapshot());
  expect(copy.environment).toEqual(created.environment);expect(copy.spin).toEqual(created.spin);
 });
 it.each([1,1e12])('persists synchronous rotation at the %s second orbital boundary',period=>{
  const definition=custom();definition.orbit.periodSeconds=period;const snapshot=save(world(definition));snapshot.spin!.locked=true;
  advanceOrbit(snapshot,1/30);expect(snapshot.spin!.period).toBe(period/60);expect(validSnapshot(snapshot,grid.count)).toBe(true);
 });
 it('still rejects nonfinite and out-of-domain physical inputs',()=>{
  const good=save(world());
  const mutations:((s:Snapshot)=>void)[]=[
   s=>{s.environment.ambient=NaN;},s=>{s.environment.ambient=-250.001;},s=>{s.environment.ambient=2500.001;},
   s=>{s.environment.sunlight=Infinity;},s=>{s.environment.sunlight=-1;},s=>{s.environment.sunlight=401;},
   s=>{s.environment.rotationRate=NaN;},s=>{s.environment.rotationRate=2*Math.PI*60+.01;},
   s=>{s.spin!.period=0;},s=>{s.spin!.period=1/60-1e-6;},s=>{s.spin!.period=1e12/60+1;},s=>{s.spin!.period=Infinity;},
   s=>{s.environment.orbitDistance=.049;},s=>{s.environment.body!.rotation.periodSeconds=0;},s=>{s.environment.body!.orbit.distanceAu=101;},
  ];
  for(const mutate of mutations){const bad=structuredClone(good);mutate(bad);expect(validSnapshot(bad,grid.count)).toBe(false);}
  for(const mutate of [(d:PlanetDefinition)=>{d.rotation.periodSeconds=0;},(d:PlanetDefinition)=>{d.rotation.periodSeconds=Infinity;},(d:PlanetDefinition)=>{d.orbit.distanceAu=.049;},(d:PlanetDefinition)=>{d.orbit.distanceAu=101;}]){
   const bad=custom();mutate(bad);expect(planetSupport(bad).supported).toBe(false);expect(()=>createDefinedPlanet(grid,bad)).toThrow();
  }
 });
 it('keeps old bodyless saves readable and their legacy input limits intact',()=>{
  const legacy:Snapshot={version:4,preset:'coast',time:12,state:[...seedPlanet(grid,'rock',18)],environment:orbitalEnvironment(1),supplied:0,removed:0,discoveries:[],spin:{angle:0,running:true,period:120}};
  expect(validSnapshot(legacy,grid.count)).toBe(true);const before=structuredClone(legacy),upgraded=upgradeSnapshot(legacy,grid.count);
  expect(legacy).toEqual(before);expect(upgraded.state).toEqual(legacy.state);expect(validSnapshot(upgraded,grid.count)).toBe(true);
  for(const mutate of [(s:Snapshot)=>{s.environment.sunlight=4;},(s:Snapshot)=>{s.environment.ambient=-101;},(s:Snapshot)=>{s.spin!.period=10;}]){const bad=structuredClone(legacy);mutate(bad);expect(validSnapshot(bad,grid.count)).toBe(false);}
 });
});

describe('cloud-band initialization uses finite nonnegative donor inventories',()=>{
 const cases=(['hydrogen','helium'] as const).flatMap(dry=>(['vapor','ammonia'] as const).flatMap(volatile=>[.01,.05,.1].map(fraction=>({dry,volatile,fraction}))));
 it.each(cases)('creates $dry and $volatile at mole fraction $fraction with no absent species',({dry,volatile,fraction})=>{
  const d=custom();d.surfaceGravity=29.43;d.atmosphere.composition=[{species:dry,moleFraction:1-fraction},{species:volatile,moleFraction:fraction}];
  const p=world(d),g=p.solver.climate.giant,absent=dry==='hydrogen'?1:0;
  expect(g.mass.every(m=>m>=0)).toBe(true);expect(g.mass.every((m,j)=>j%DEEP_SPECIES!==absent||m===0)).toBe(true);
  expect(validDeep(g.snapshot(),grid.count)).toBe(true);expect(validSnapshot(save(p),grid.count)).toBe(true);
  p.solver.advance(1/30,commands,p.environment);expect(g.mass.every(m=>m>=0)).toBe(true);expect(g.mass.every((m,j)=>j%DEEP_SPECIES!==absent||m===0)).toBe(true);
 });
 it.each([0,1e-18,.1,1])('preserves each species, layer mass and layer energy when the helium dry fraction is %s',helium=>{
  const d=custom();d.surfaceGravity=29.43;d.atmosphere.composition=[{species:'hydrogen',moleFraction:.95*(1-helium)},{species:'helium',moleFraction:.95*helium},{species:'vapor',moleFraction:.05}];
  const p=world(d,{referenceTemperatureKelvin:165,minimumTemperatureKelvin:110,jetSpeed:100,temperaturePerturbation:1,cloudBands:false}),g=p.solver.climate.giant;
  const species=()=>Array.from({length:DEEP_SPECIES},(_,f)=>g.mass.reduce((sum,m,j)=>sum+(j%DEEP_SPECIES===f?m:0),0));
  const before=species(),layerMass=Array.from({length:grid.count*DEEP_LAYERS},(_,q)=>g.layerMass(q)),energy=layerMass.map((_,q)=>g.layerEnergy(q));
  g.seedCloudBands();expect(g.mass.every(m=>m>=0)).toBe(true);
  const after=species();for(let f=0;f<DEEP_SPECIES;f++)expect(Math.abs(after[f]-before[f])).toBeLessThanOrEqual(Math.abs(before[f])*2e-15);
  for(let q=0;q<layerMass.length;q++){
   expect(Math.abs(g.layerMass(q)-layerMass[q])).toBeLessThanOrEqual(layerMass[q]*2e-15);
   expect(Math.abs(g.layerEnergy(q)-energy[q])).toBeLessThanOrEqual(Math.max(1,Math.abs(energy[q]))*2e-15);
  }
  expect(p.state.length).toBe(grid.count*STRIDE);
 });
});
