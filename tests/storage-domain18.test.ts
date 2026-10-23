import {describe,expect,it} from 'vitest';
import {CpuSolver,F,STRIDE,COMMAND_FIELD,emptyStock,seedPlanet,totalMass,type Environment,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {createCommandBatch} from '../src/sim/supply';
import {PHYSICS_DT} from '../src/sim/clock';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {prepareSystemSave} from '../src/sim/system';
import {JUPITER_DEFINITION,SATURN_DEFINITION,sandboxDefinition,planetSupport} from '../src/sim/planetDefinition';
import {createDefinedPlanet} from '../src/sim/planetCreation';
import {DEEP_LAYERS,validDeep} from '../src/sim/deepAtmosphere';
import {DEEP_MAX_HEIGHT,deepInitialProfile} from '../src/sim/deepAtmosphereProfile';
import {validClimate} from '../src/sim/weatherClimate';
import {validLayered} from '../src/sim/layeredAtmosphere';
import {validInventoryAmount} from '../src/sim/physicalState';

const grid=createSphere(0);
const environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true,body:sandboxDefinition('rock')};
function snapshot(solver:CpuSolver,e=environment):Snapshot{return {version:11,preset:'coast',state:[...solver.state],climate:solver.climate.snapshot(),time:0,environment:structuredClone(e),...(solver.climate.giant.ready?{}:{planet:{primary:'rock' as const}}),supplied:0,removed:0,discoveries:[]};}
function roundTrip(solver:CpuSolver,e=environment){
 const before=snapshot(solver,e),serialized=JSON.stringify(before),raw=JSON.parse(serialized) as Snapshot;
 expect(validSnapshot(raw,grid.count)).toBe(true);
 const system=prepareSystemSave({version:3,mode:'sandbox',activeId:'planet-domain',planets:[{id:'planet-domain',name:'Domain',snapshot:raw}],stock:emptyStock(),savedAt:1},grid.count);
 const upgraded=upgradeSnapshot(system.planets[0].snapshot,grid.count),copy=new CpuSolver(grid,new Float32Array(upgraded.state));copy.climate.restore(upgraded.climate);
 expect(JSON.stringify(raw)).toBe(serialized);expect(copy.state).toEqual(solver.state);expect(copy.climate.snapshot()).toEqual(raw.climate);
 return copy;
}

describe('alpha18 runtime and save inventory domain',()=>{
 it('saves the exact audited ordinary paused pour across 100,000 kg without clipping stock or carry',()=>{
  const state=seedPlanet(grid,'rock',20,'none');state[F.sand]=99999;
  const solver=new CpuSolver(grid,state),commands=createCommandBatch(grid.count);commands[COMMAND_FIELD.sand]=200*PHYSICS_DT;
  expect(validSnapshot(snapshot(solver),grid.count)).toBe(true);
  const initialMass=totalMass(solver.state,solver.climate);solver.advance(0,commands,environment);
  expect(solver.climate.physicalSurface(solver.state)[F.sand]).toBeCloseTo(100005.66666666667,8);
  expect(totalMass(solver.state,solver.climate)-initialMass).toBeCloseTo(commands[COMMAND_FIELD.sand],8);
  expect(solver.climate.air.surfaceMassCarry[F.sand]).not.toBe(0);
  const copy=roundTrip(solver),empty=createCommandBatch(grid.count);
  for(let i=0;i<5;i++){solver.advance(PHYSICS_DT,empty,environment);copy.advance(PHYSICS_DT,empty,environment);}
  expect(copy.state).toEqual(solver.state);expect(copy.climate.snapshot()).toEqual(solver.climate.snapshot());
 });
 it.each([false,true])('retains million-kg stocks, supplies and exact JSON resume through 120 steps (climate=%s)',climate=>{
  const e={...environment,climate},state=seedPlanet(grid,'rock',20,'none');
  for(let i=0;i<grid.count;i++)state[i*STRIDE+F.sand]=1000000;
  let solver=new CpuSolver(grid,state),copy:CpuSolver|undefined;const empty=createCommandBatch(grid.count),commands=empty.slice();commands[COMMAND_FIELD.sand]=200*PHYSICS_DT;
  solver.advance(0,commands,e);const initial=totalMass(solver.state,solver.climate);
  for(let n=0;n<120;n++){
   solver.advance(PHYSICS_DT,empty,e);
   if(copy){copy.advance(PHYSICS_DT,empty,e);expect(copy.state).toEqual(solver.state);expect(copy.climate.snapshot()).toEqual(solver.climate.snapshot());solver=copy;copy=undefined;}
   if(n===59)copy=roundTrip(solver,e);
  }
  expect(Math.abs(totalMass(solver.state,solver.climate)-initial)).toBeLessThan(.002);
  expect(validSnapshot(snapshot(solver,e),grid.count)).toBe(true);
 });
 it('persists large liquid mechanical partitions beyond the former 200,000 kg ocean ceiling',()=>{
  const state=seedPlanet(grid,'rock',20,'none');for(let i=0;i<grid.count;i++)state[i*STRIDE+F.water]=250001;
  const e={...environment,climate:false},solver=new CpuSolver(grid,state),commands=createCommandBatch(grid.count);commands[4]=.1;
  solver.advance(0,commands,e);expect(solver.climate.ocean.mass[0]).toBeGreaterThan(200000);
  roundTrip(solver,e);
 });
 it('saves authoritative ordinary air over 100,000 kg after ordinary gas supply',()=>{
  const solver=new CpuSolver(grid,seedPlanet(grid,'rock',20,'nitrogen')),commands=createCommandBatch(grid.count);commands[COMMAND_FIELD.nitrogen]=200005;
  solver.advance(0,commands,environment);expect(solver.state[F.nitrogen]).toBeGreaterThan(100000);
  const copy=roundTrip(solver);commands.fill(0);commands[4]=.1;
  solver.advance(0,commands,environment);copy.advance(0,commands,environment);
  expect(copy.state).toEqual(solver.state);expect(copy.climate.snapshot()).toEqual(solver.climate.snapshot());
 });
 it('uses the same finite stock representation for air inventories, particle caches and deferred carries',()=>{
  const solver=new CpuSolver(grid,seedPlanet(grid,'rock',20,'nitrogen')),commands=createCommandBatch(grid.count);commands[4]=.1;solver.advance(0,commands,environment);
  const air=solver.climate.air.snapshot()!;
  for(const field of ['mass','dustMass','dustRadiationCache','sootRadiationCache','dustLiftCarry','sootLiftCarry','evaporationCarry'] as const){
   const large=structuredClone(air);large[field]![0]=100001;expect(validLayered(large,grid.count),field).toBe(true);
   for(const value of [NaN,Infinity,-Infinity,Number.MAX_VALUE,-1]){const bad=structuredClone(air);bad[field]![0]=value;expect(validLayered(bad,grid.count),`${field} ${value}`).toBe(false);}
  }
 });
 it('saves finite ordinary-air flow above old velocity, updraft and displayed wind ceilings and resumes exactly',()=>{
  const solver=new CpuSolver(grid,seedPlanet(grid,'rock',20,'nitrogen')),commands=createCommandBatch(grid.count);commands[4]=.1;solver.advance(0,commands,environment);
  const air=solver.climate.air;air.velocity[0]=6000;air.updraft[0]=7000;air.surfaceWind(solver.climate.wind);
  expect(solver.climate.wind[0]).toBeGreaterThan(.31);expect(validLayered(air.snapshot(),grid.count)).toBe(true);
  const copy=roundTrip(solver);commands.fill(0);solver.advance(.00001,commands,environment);copy.advance(.00001,commands,environment);
  expect(copy.state).toEqual(solver.state);expect(copy.climate.snapshot()).toEqual(solver.climate.snapshot());
 });
 it('accepts finite radiative cache values above the old serializer-only ceiling',()=>{
  const solver=new CpuSolver(grid,seedPlanet(grid,'rock',20,'nitrogen')),commands=createCommandBatch(grid.count);commands[4]=.1;solver.advance(0,commands,environment);
  const air=solver.climate.air.snapshot()!;air.radiationCache![9]=1e20;expect(validLayered(air,grid.count)).toBe(true);
  for(const value of [NaN,Infinity,-Infinity]){const bad=structuredClone(air);bad.radiationCache![9]=value;expect(validLayered(bad,grid.count)).toBe(false);}
 });
 it('rejects nonfinite, negative and unprojectable serialized inventories and physical remainders',()=>{
  const solver=new CpuSolver(grid,seedPlanet(grid,'rock',20,'none')),commands=createCommandBatch(grid.count);commands[4]=.1;solver.advance(0,commands,environment);
  const saved=snapshot(solver);
  for(const value of [NaN,Infinity,-Infinity,Number.MAX_VALUE,-1]){const bad=structuredClone(saved);bad.state[F.sand]=value;expect(validSnapshot(bad,grid.count)).toBe(false);}
  for(const value of [NaN,Infinity,-Infinity,Number.MAX_VALUE]){const bad=structuredClone(saved);bad.climate!.surfaceMassCarry![F.sand]=value;expect(validSnapshot(bad,grid.count)).toBe(false);}
  expect([0,100005.66666666667,1e9,3e38].every(validInventoryAmount)).toBe(true);
 });
 it('rejects unsupported tool overflow atomically without cutting an existing stock',()=>{
  const solver=new CpuSolver(grid,seedPlanet(grid,'rock',20,'none')),commands=createCommandBatch(grid.count);commands[4]=.1;solver.advance(0,commands,environment);
  const before=snapshot(solver);
  for(const value of [NaN,Infinity,Number.MAX_VALUE]){commands.fill(0);commands[COMMAND_FIELD.sand]=value;expect(()=>solver.advance(0,commands,environment)).toThrow();expect(snapshot(solver)).toEqual(before);}
 });
 it('rolls back a finite, projectable supply whose energy ledger exceeds Float32 representation',()=>{
  const e={...environment,climate:false},solver=new CpuSolver(grid,seedPlanet(grid,'rock',20,'none')),commands=createCommandBatch(grid.count);commands[4]=.1;solver.advance(0,commands,e);
  const before=snapshot(solver,e);commands.fill(0);commands[COMMAND_FIELD.sand]=1e38;
  expect(validInventoryAmount(commands[COMMAND_FIELD.sand])).toBe(true);
  expect(()=>solver.advance(0,commands,e)).toThrow('유한한 상태·수지 표현 범위');
  expect(snapshot(solver,e)).toEqual(before);expect(solver.energyChanges.every(v=>v===0)).toBe(true);
 });
});

describe('alpha18 deep fixed-geometry admission and legacy persistence',()=>{
 it('rejects the exact audited 0.0981m/s² creation before it can produce an unsaveable column',()=>{
  const d=structuredClone(JUPITER_DEFINITION);d.preset='custom';d.surfaceGravity=.0981;
  const profile=deepInitialProfile(d,165,110);expect(profile.height[0]).toBeCloseTo(76526490.7,0);
  expect(profile.height[0]).toBeGreaterThan(DEEP_MAX_HEIGHT);
  expect(planetSupport(d)).toEqual({supported:false,reason:expect.stringContaining('3,000km')});
  expect(()=>createDefinedPlanet(grid,d)).toThrow('3,000km');
 });
 it.each([JUPITER_DEFINITION,SATURN_DEFINITION])('keeps the existing $preset preset geometry and complete save/resume valid',d=>{
  expect(planetSupport(d).supported).toBe(true);const p=createDefinedPlanet(grid,d),solver=new CpuSolver(grid,p.state);solver.climate.restore(p.climate);
  expect(solver.climate.giant.height[0]).toBeLessThan(DEEP_MAX_HEIGHT);roundTrip(solver,p.environment);
 });
 it('uses the resolved deep wind rather than the old sandbox display ceiling at supported radii',()=>{
  const d=structuredClone(JUPITER_DEFINITION);d.preset='custom';d.radiusMeters=1000;
  const p=createDefinedPlanet(grid,d),solver=new CpuSolver(grid,p.state);solver.climate.restore(p.climate);
  expect(Math.max(...solver.climate.wind.map(Math.abs))).toBeGreaterThan(.31);expect(validClimate(p.climate,grid.count)).toBe(true);roundTrip(solver,p.environment);
 });
 it('admits explicit colder initial conditions independently of the warmer default creation profile',()=>{
  const d=structuredClone(JUPITER_DEFINITION);d.preset='custom';d.surfaceGravity=2;
  expect(planetSupport(d).supported).toBe(false);
  const initial={referenceTemperatureKelvin:80,minimumTemperatureKelvin:40,jetSpeed:0,temperaturePerturbation:0};
  expect(planetSupport(d,{initial}).supported).toBe(true);const p=createDefinedPlanet(grid,d,initial);
  expect(validClimate(p.climate,grid.count)).toBe(true);
 });
 it('preserves previously valid saved heights even when the current default creation profile cannot fit',()=>{
  const p=createDefinedPlanet(grid,JUPITER_DEFINITION),solver=new CpuSolver(grid,p.state);solver.climate.restore(p.climate);
  const saved=snapshot(solver,p.environment),d=saved.environment.body!;d.preset='custom';d.surfaceGravity=.0981;saved.environment.gravity=.01;saved.climate!.giant!.gravity=.01;
  expect(planetSupport(d).supported).toBe(false);expect(validSnapshot(saved,grid.count)).toBe(true);
  const upgraded=upgradeSnapshot(saved,grid.count),resumed=new CpuSolver(grid,new Float32Array(upgraded.state));resumed.climate.restore(upgraded.climate);
  const heights=[...resumed.climate.giant.height],commands=createCommandBatch(grid.count);commands[4]=.1;resumed.advance(0,commands,upgraded.environment);
  expect([...resumed.climate.giant.height]).toEqual(heights);expect(validSnapshot(snapshot(resumed,upgraded.environment),grid.count)).toBe(true);
 });
 it('retains deep species above the former per-layer save ceiling and rejects invalid geometry and values',()=>{
  const p=createDefinedPlanet(grid,JUPITER_DEFINITION),solver=new CpuSolver(grid,p.state);solver.climate.restore(p.climate);
  solver.climate.giant.mass[0]=100001;solver.climate.giant.sync(solver.state);
  const before=solver.climate.giant.mass.slice(),copy=roundTrip(solver,p.environment);
  expect(copy.climate.giant.mass).toEqual(before);
  const deep=copy.climate.giant.snapshot()!;expect(validDeep(deep,grid.count)).toBe(true);
  for(const value of [NaN,Infinity,-Infinity,Number.MAX_VALUE,-1]){const bad=structuredClone(deep);bad.mass[0]=value;expect(validDeep(bad,grid.count)).toBe(false);}
  for(const value of [NaN,Infinity,DEEP_MAX_HEIGHT+1]){const bad=structuredClone(deep);bad.height[0]=value;expect(validDeep(bad,grid.count)).toBe(false);}
  const bad=structuredClone(deep);bad.height[DEEP_LAYERS-1]=bad.height[DEEP_LAYERS-2];expect(validDeep(bad,grid.count)).toBe(false);
 });
});
