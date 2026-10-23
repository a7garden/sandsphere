import {describe,it,expect} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,totalMass,totalEnthalpy,seedPlanet,type Snapshot} from '../src/sim/model';
import {MARS_DEFINITION,sandboxDefinition,validPlanetDefinition,planetSupport,planetOrbitPeriod,temperatureLimits,type PlanetDefinition} from '../src/sim/planetDefinition';
import {createDefinedPlanet,createMarsPlanet,createSandboxPlanet} from '../src/sim/planetCreation';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {prepareSystemSave,BackgroundWorlds,advanceOrbit,type PlanetRecord} from '../src/sim/system';
import {atmosphereState} from '../src/sim/atmosphere';
import {orbitalEnvironment} from '../src/sim/orbit';
import {climateColor} from '../src/sim/weatherClimate';
import {phaseLimitNotes,carbonDioxideFrostPoint} from '../src/sim/materialPhysics';
const grid=createSphere(1),empty=new Float32Array(grid.count*COMMAND_STRIDE);
function mars():Snapshot{const p=createMarsPlanet(grid);return {version:5,preset:'coast',planet:{primary:p.primary},time:0,state:[...p.state],environment:p.environment,spin:p.spin,discoveries:[],supplied:0,removed:0};}
const record=(snapshot:Snapshot):PlanetRecord=>({id:'planet-mars',name:'Mars',snapshot});
function giant():PlanetDefinition {return {...structuredClone(MARS_DEFINITION),preset:'custom',kind:'gas-giant',radiusMeters:69911000,
 atmosphere:{pressurePa:1e5,composition:[{species:'hydrogen',moleFraction:.86},{species:'helium',moleFraction:.14}],radiation:'hydrogen-helium'},
 lowerBoundary:{kind:'deep-atmosphere',pressurePa:3e6,intrinsicFlux:5.4}};}
describe('common planet definition and supported creation',()=>{
 it('represents a giant without giving it a solid surface and rejects simulation before mutation',()=>{
  const d=giant();d.atmosphere.composition=[{species:'ammonia',moleFraction:1}];expect(validPlanetDefinition(d)).toBe(true);expect(planetSupport(d).supported).toBe(false);
  expect(()=>createDefinedPlanet(grid,d)).toThrow('깊은 대기');
  const p=createMarsPlanet(grid),solver=new CpuSolver(grid,p.state),before=solver.state.slice(),air=solver.climate.snapshot();
  expect(()=>solver.advance(.1,empty,{...p.environment,body:d})).toThrow('깊은 대기');expect(solver.state).toEqual(before);expect(solver.climate.snapshot()).toEqual(air);
  d.kind='ice-giant';expect(validPlanetDefinition(d)).toBe(true);
 });
 it('rejects unknown/duplicate species, malformed boundaries and inconsistent mixtures',()=>{
  for(const mutate of [(d:PlanetDefinition)=>{d.radiusMeters=NaN;},(d:PlanetDefinition)=>{d.atmosphere.composition[0].moleFraction=.2;},(d:PlanetDefinition)=>{d.atmosphere.composition.push(d.atmosphere.composition[0]);},(d:PlanetDefinition)=>{d.lowerBoundary=giant().lowerBoundary;},(d:PlanetDefinition)=>{d.atmosphere.pressurePa=0;}]){
   const d=structuredClone(MARS_DEFINITION);mutate(d);expect(validPlanetDefinition(d)).toBe(false);
  }
  const d=structuredClone(MARS_DEFINITION);d.atmosphere.composition=[{species:'hydrogen',moleFraction:1}];expect(planetSupport(d).supported).toBe(false);
 });
 it('initializes the stated pressure, mole fractions, ice and physical motion without life',()=>{
  const p=createMarsPlanet(grid),a=atmosphereState(p.state,p.environment);
  expect(a.pressure*101325).toBeCloseTo(636,3);expect(a.species.find(g=>g.id==='carbonDioxide')!.fraction).toBeCloseTo(.97,6);
  expect(p.spin.period*60).toBeCloseTo(88642.7,5);expect(p.spin.tilt).toBe(25.19);expect(a.referenceRadiusKm).toBe(3389.5);
  expect(a.boundaryKind).toBe('finite');expect(p.state.filter((_,i)=>i%STRIDE===F.ice).some(v=>v>0)).toBe(true);
  for(const f of [F.water,F.plant,F.seed,F.herbivore,F.carnivore])expect(p.state.every((v,i)=>i%STRIDE!==f||v===0)).toBe(true);
  p.environment.body!.radiusMeters=1000;expect(MARS_DEFINITION.radiusMeters).toBe(3389500);
 });
 it('retains sandbox seed inventory and accepts a thin custom atmosphere',()=>{
  for(const primary of ['rock','sand','clay','water','ice'] as const){const p=createSandboxPlanet(grid,primary,1,1,'methane',2);expect(p.state).toEqual(seedPlanet(grid,primary,18,'methane',2));}
  const p=createSandboxPlanet(grid,'rock',1.524,.38,'carbonDioxide',.016);expect(atmosphereState(p.state,p.environment).pressure*101325).toBeLessThan(650);
  expect(validSnapshot({...mars(),state:[...p.state],environment:p.environment,planet:{primary:'rock'},spin:undefined},grid.count)).toBe(true);
 });
 it('uses physical orbit time for Mars while keeping sandbox years unchanged',()=>{
  expect(planetOrbitPeriod(1,sandboxDefinition('rock'))).toBe(240);
  const s=mars();advanceOrbit(s,10);expect(s.environment.orbitAngle).toBeCloseTo(10*60*2*Math.PI/59355072,14);
  expect(s.spin!.angle).toBeCloseTo(10*60*2*Math.PI/88642.7,14);
 });
});
describe('save compatibility and deterministic Mars calculation',()=>{
 it.each([1,2,3,4] as const)('upgrades v%s without modifying inventories, heat, clocks or the input',version=>{
  const original:Snapshot={version,preset:'coast',state:[...seedPlanet(grid,'rock',18)],environment:orbitalEnvironment(1),time:12,discoveries:[],supplied:0,removed:0};
  const before=structuredClone(original),upgraded=upgradeSnapshot(original,grid.count);
  expect(original).toEqual(before);expect(upgraded.state).toEqual(original.state);expect(upgraded.time).toBe(original.time);expect(upgraded.version).toBe(11);
  expect(upgraded.environment.body!.radiusMeters).toBe(1e6);expect(planetOrbitPeriod(1,upgraded.environment.body)).toBe(240);expect(validSnapshot(upgraded,grid.count)).toBe(true);
  const a=new CpuSolver(grid,new Float32Array(original.state)),b=new CpuSolver(grid,new Float32Array(upgraded.state));
  for(let n=0;n<3;n++){a.advance(1/30,empty,{...original.environment,climate:true});b.advance(1/30,empty,{...upgraded.environment,climate:true});}
  expect(b.state).toEqual(a.state);expect(b.climate.snapshot()).toEqual(a.climate.snapshot());
 });
 it('retains readable 16/20-field legacy layouts',()=>{
  for(const stride of [16,20]){const s=mars();s.version=1;delete s.environment.body;s.environment=orbitalEnvironment(1);s.spin=undefined;s.planet={primary:'rock'};
   const old=seedPlanet(grid,'rock',18);s.state=Array.from({length:grid.count},(_,i)=>[...old.slice(i*STRIDE,i*STRIDE+stride)]).flat();
   expect(validSnapshot(s,grid.count)).toBe(true);const upgraded=upgradeSnapshot(s,grid.count);expect(validSnapshot(upgraded,grid.count)).toBe(true);
   for(let i=0;i<grid.count;i++)expect(upgraded.state.slice(i*STRIDE,i*STRIDE+stride)).toEqual(s.state.slice(i*stride,(i+1)*stride));
  }
 });
 it('rejects missing definitions, unsupported giants and mismatched environment or atmosphere metadata',()=>{
  const s=mars();expect(validSnapshot(s,grid.count)).toBe(true);
  const missing=structuredClone(s);delete missing.environment.body;expect(validSnapshot(missing,grid.count)).toBe(false);
  for(const mutate of [(s:Snapshot)=>{s.environment.body=giant();},(s:Snapshot)=>{s.environment.gravity=1;},(s:Snapshot)=>{s.environment.orbitDistance=1;},(s:Snapshot)=>{s.planet={primary:'water'};}]){const bad=structuredClone(s);mutate(bad);expect(validSnapshot(bad,grid.count)).toBe(false);}
  const solver=new CpuSolver(grid,new Float32Array(s.state));solver.advance(.1,empty,s.environment);s.state=[...solver.state];s.climate=solver.climate.snapshot();expect(validSnapshot(s,grid.count)).toBe(true);
  const bad=structuredClone(s);bad.climate!.atmosphere!.radiusMeters=1e6;expect(validSnapshot(bad,grid.count)).toBe(false);
 });
 it('keeps a cold Mars surface below the legacy clamp and selects a distinct radiation path',()=>{
  const p=createMarsPlanet(grid);for(let i=0;i<grid.count;i++)p.state[i*STRIDE+F.temperature]=-125;
  const solver=new CpuSolver(grid,p.state);solver.advance(1/30,empty,{...p.environment,sunlight:0});expect(solver.state[F.temperature]).toBeLessThan(-120);
  expect(solver.climate.air.radiusMeters).toBe(3389500);expect(solver.climate.air.snapshot()!.radiationModel).toBe('thin-co2-grey');
  const column=solver.climate.air.radiationColumn(solver.state,0,p.environment);expect(column.longwaveBands).toBeUndefined();expect(column.opticalDepth[0]).toBeGreaterThan(0);
  expect(temperatureLimits(p.environment.body).surfaceMin).toBe(-200);
  const a=climateColor('temperature',solver.state,0,p.environment,solver.climate);solver.state[F.temperature]=-50;expect(climateColor('temperature',solver.state,0,p.environment,solver.climate)).not.toEqual(a);
 });
 it('uses CO2 partial pressure for frost warnings instead of the 1-atm threshold',()=>{
  const p=createMarsPlanet(grid);p.state[F.temperature]=-80;expect(phaseLimitNotes(p.state,0,p.environment.gravity)).toEqual([]);
  p.state[F.temperature]=-135;expect(phaseLimitNotes(p.state,0,p.environment.gravity)).toContain('이산화탄소: 기체 저온 응축 모델 범위 밖');
  expect(carbonDioxideFrostPoint(101325)).toBeCloseTo(-78.4,0);expect(carbonDioxideFrostPoint(636)).toBeLessThan(-120);
 });
 it('conserves mass and the declared energy budget over a Martian hour, then resumes exactly',()=>{
  const s=mars(),a=new CpuSolver(grid,new Float32Array(s.state)),mass=totalMass(a.state),heat=totalEnthalpy(a.state);let external=0,escaped=0;
  for(let n=0;n<120;n++){a.advance(.5,empty,s.environment);external+=a.energyChanges.reduce((x,y)=>x+y,0);escaped+=a.escapeCells.reduce((x,y)=>x+y,0);}
  expect(totalMass(a.state)+escaped-mass).toBeCloseTo(0,3);expect(totalEnthalpy(a.state,a.climate)-heat-external).toBeCloseTo(0,2);expect(a.state.every(Number.isFinite)).toBe(true);
  const saved={...s,state:[...a.state],climate:a.climate.snapshot()};expect(validSnapshot(saved,grid.count)).toBe(true);
  const system=prepareSystemSave({version:3,mode:'sandbox',activeId:'planet-mars',planets:[record(saved)],stock:{ice:0,ceramic:0,glass:0,plant:0,herbivore:0,carnivore:0,iron:0},savedAt:1},grid.count);
  const resumed=JSON.parse(JSON.stringify(system)).planets[0].snapshot as Snapshot,b=new CpuSolver(grid,new Float32Array(resumed.state));b.climate.restore(resumed.climate);
  expect(totalEnthalpy(a.state,a.climate.snapshot())).toBeCloseTo(totalEnthalpy(a.state,a.climate),6);
  for(let n=0;n<5;n++){a.advance(1/30,empty,s.environment);b.advance(1/30,empty,resumed.environment);}expect(b.state).toEqual(a.state);expect(b.climate.snapshot()).toEqual(a.climate.snapshot());
 },process.env.CI?60000:20000);
 it('uses the same definition and orbit in active, background and asynchronous execution',async()=>{
  const s=mars(),p=record(structuredClone(s)),q=record(structuredClone(s)),a=new CpuSolver(grid,new Float32Array(s.state));
  const background=new BackgroundWorlds(grid),asyncBackground=new BackgroundWorlds(grid,async state=>new CpuSolver(grid,state));
  for(let n=0;n<4;n++){advanceOrbit(s,1/30);a.advance(1/30,empty,s.environment);background.step([p],'planet-other',1/30);await asyncBackground.stepAsync([q],'planet-other',1/30);}
  expect(p.snapshot.state).toEqual([...a.state]);expect(p.snapshot.climate).toEqual(a.climate.snapshot());expect(q.snapshot).toEqual(p.snapshot);expect(p.snapshot.environment).toEqual(s.environment);
 });
});
