import {describe,it,expect,vi} from 'vitest';
import {BackgroundWorlds,advanceOrbit,migrateWorld,validSystem,switchSystemMode,materialSupply,prepareSystemSave} from '../src/sim/system';
import {createSphere} from '../src/sim/sphere';
import {COMMAND_STRIDE,COMMAND_FIELD,F,STRIDE,CpuSolver,applyCommand,emptyStock,totalMass,seedPlanet,type Snapshot} from '../src/sim/model';
import {snapshotSurface} from '../src/sim/session';
import {localSun,orbitalEnvironment,orbitalPeriod} from '../src/sim/orbit';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';

const grid=createSphere(1);
function snapshot(primary:'rock'|'ice'='rock'):Snapshot {
 return {version:3,preset:'coast',planet:{primary},state:[...seedPlanet(grid,primary,primary==='ice'?-30:18)],time:0,environment:orbitalEnvironment(primary==='ice'?1.8:1),supplied:0,removed:0,discoveries:[],paused:false,spin:{angle:0,running:false,period:120,tilt:0}};
}

describe('discovery production and stock transfers',()=>{
 it('collects actual products after deposits and removal, preserving the combined budget',()=>{
  const state=new Float32Array(STRIDE),commands=new Float32Array(COMMAND_STRIDE),stock=emptyStock();
  state[F.temperature]=20;state[F.ice]=10;state[F.ceramic]=8;state[F.glass]=6;state[F.sand]=4;
  commands[COMMAND_FIELD.glass]=2;commands[5]=.25;commands[6]=.5;
  applyCommand(state,0,commands,stock);
  expect(stock).toEqual({...emptyStock(),ice:3.75,ceramic:3,glass:3});
  expect(totalMass(state)+Object.values(stock).reduce((a,b)=>a+b,0)).toBe(30*.75);
 });
 it('saves pending GPU work, later brush commands and falling products in order',()=>{
  const state=new Float32Array(STRIDE),active=new Float32Array(COMMAND_STRIDE),queued=new Float32Array(COMMAND_STRIDE);
  state[F.glass]=10;state[F.temperature]=20;active[COMMAND_FIELD.glass]=10;active[6]=.25;queued[6]=.5;
  const saved=snapshotSurface(state,queued,[{index:0,material:'ice',amount:2}],active);
  expect(saved.collected.glass).toBe(12.5);expect(saved.state[F.glass]).toBe(7.5);
  expect(totalMass(saved.state)+saved.collected.glass).toBe(22);expect(state[F.glass]).toBe(10);
 });
 it('does not create any warehouse material on a bare rock planet',()=>{
  const state=seedPlanet(grid,'rock',18),command=new Float32Array(grid.count*COMMAND_STRIDE);
  for(let i=0;i<grid.count;i++)command[i*COMMAND_STRIDE+6]=1;
  expect(snapshotSurface(state,command,[]).collected).toEqual(emptyStock());
  expect(state[F.sand]+state[F.water]+state[F.clay]).toBe(0);
 });
});

describe('persistent solar system',()=>{
 it('keeps campaign and sandbox worlds separate across mode switches',()=>{
  const campaign=migrateWorld(snapshot(),grid.count);campaign.stock.glass=3;campaign.progress={completed:['water'],meteorCount:1};campaign.telemetry={version:1,planets:[]};
  const sandbox=switchSystemMode(campaign,'sandbox',1);
  expect(validSystem(sandbox,grid.count)).toBe(true);
  expect(sandbox.planets).toEqual([]);expect(sandbox.stock.glass).toBe(0);
  sandbox.planets=[{id:'planet-sandbox',name:'Sandbox',snapshot:snapshot('ice')}];sandbox.activeId='planet-sandbox';
  sandbox.stock.glass=12;
  const restored=switchSystemMode(prepareSystemSave(sandbox,grid.count),'campaign',2);
  expect(validSystem(restored,grid.count)).toBe(true);
  expect(restored.planets).toEqual(campaign.planets);expect(restored.stock.glass).toBe(3);
  expect(restored.progress).toEqual(campaign.progress);
  expect(restored.telemetry).toEqual(campaign.telemetry);
  expect(restored.other?.stock.glass).toBe(12);
 });
 it('makes every material externally supplied only in sandbox',()=>{
  const stock=emptyStock();stock.glass=2;
  expect(materialSupply('campaign','glass',stock,5)).toEqual({amount:2,fromStock:true});
  expect(materialSupply('sandbox','glass',stock,5)).toEqual({amount:5,fromStock:false});
  expect(materialSupply('sandbox','plant',stock,5)).toEqual({amount:5,fromStock:false});
  expect(materialSupply('campaign','sand',stock,5)).toEqual({amount:5,fromStock:false});
 });
 it('reads tiny legacy phase-transfer roundoff while rejecting genuinely negative mass',()=>{
  const s=snapshot();s.state[F.cloud]=-2.153607500665622e-11;s.state[F.cloudIce]=-1.8189894035458565e-12;
  expect(validSnapshot(s,grid.count)).toBe(true);
  const recovered=upgradeSnapshot(s,grid.count);
  expect(recovered.state[F.cloud]).toBe(0);expect(recovered.state[F.cloudIce]).toBe(0);
  expect(s.state[F.cloud]).toBeLessThan(0);expect(recovered.state[F.temperature]).toBe(s.state[F.temperature]);
  s.state[F.cloud]=-.01;expect(validSnapshot(s,grid.count)).toBe(false);
 });
 it('preserves the entire legacy world when wrapping it in a solar system',()=>{
  const original=snapshot(),before=structuredClone(original),system=migrateWorld(original,grid.count);
  expect(validSystem(system,grid.count)).toBe(true);expect(system.planets[0].snapshot).toEqual(upgradeSnapshot(original,grid.count));expect(system.planets[0].snapshot.state).toEqual(original.state);expect(original).toEqual(before);
  expect(system.stock).toEqual(emptyStock());
  expect(validSystem({...system,activeId:'missing'},grid.count)).toBe(false);
  expect(validSystem({...system,stock:{ice:-1,ceramic:0,glass:0}},grid.count)).toBe(false);
  expect(validSystem({...system,planets:[system.planets[0],system.planets[0]]},grid.count)).toBe(false);
 });
 it('continues inactive experiments without modifying the active or paused world',()=>{
  const a=snapshot(),b=snapshot('ice'),c=snapshot();c.paused=true;
  b.environment=orbitalEnvironment(1);
  for(let i=0;i<grid.count;i++)b.state[i*STRIDE+F.temperature]=18;
  const system=migrateWorld(a,grid.count);system.planets.push({id:'planet-2',name:'Cold',snapshot:b},{id:'planet-3',name:'Paused',snapshot:c});
  const active=structuredClone(system.planets[0].snapshot),paused=structuredClone(c),mass=totalMass(new Float32Array(b.state));
  const background=new BackgroundWorlds(grid);for(let n=0;n<40;n++)background.step(system.planets,system.activeId,.2);
  expect(system.planets[0].snapshot).toEqual(active);expect(c).toEqual(paused);expect(b.time).toBeCloseTo(8);
  expect(totalMass(new Float32Array(b.state))+(b.escaped??0)).toBeCloseTo(mass,3);
  expect(b.state.reduce((sum,value,index)=>sum+(index%STRIDE===F.water?value:0),0)).toBeGreaterThan(0);
 });
 it('advances asynchronous inactive worlds with exactly the synchronous orbit and climate',async()=>{
  const a=snapshot(),b=snapshot('ice'),c=snapshot();c.paused=true;
  const planets=[{id:'planet-1',name:'Active',snapshot:a},{id:'planet-2',name:'Ice',snapshot:b},{id:'planet-3',name:'Paused',snapshot:c}],expected=structuredClone(planets);
  const synchronous=new BackgroundWorlds(grid),factory=vi.fn(async(state:Float32Array)=>new CpuSolver(grid,state)),background=new BackgroundWorlds(grid,factory);
  for(let n=0;n<4;n++){synchronous.step(expected,'planet-1',.2);await background.stepAsync(planets,'planet-1',.2);}
  expect(planets).toEqual(expected);expect(factory).toHaveBeenCalledTimes(1);
 });
 it('publishes an inactive planet only after a completed step and disposes invalidated workers',async()=>{
  const planet={id:'planet-2',name:'Ice',snapshot:snapshot('ice')},before=structuredClone(planet);
  let release!:()=>void;const waiting=new Promise<void>(resolve=>release=resolve);
  const solver=new CpuSolver(grid,new Float32Array(planet.snapshot.state)),dispose=vi.spyOn(solver,'dispose'),original=solver.step.bind(solver);
  solver.step=async(...args)=>{await waiting;await original(...args);};
  const background=new BackgroundWorlds(grid,async()=>solver),finished=background.stepAsync([planet],'planet-1',.01);
  await Promise.resolve();expect(planet).toEqual(before);
  release();await finished;expect(planet.snapshot.time).toBe(.01);expect(planet.snapshot.climate).toBeDefined();
  background.invalidate(planet.id);expect(dispose).toHaveBeenCalledOnce();
 });
 it('recreates failed background compute from its committed climate and advances orbit once',async()=>{
  const planet={id:'planet-2',name:'Ice',snapshot:snapshot('ice')},expected=structuredClone(planet);
  let calls=0,failed!:CpuSolver;const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
  const background=new BackgroundWorlds(grid,async state=>{
   const solver=new CpuSolver(grid,state);
   if(++calls===1){failed=solver;const step=solver.step.bind(solver);let steps=0;solver.step=async(...args)=>{if(++steps===2)throw new Error('Worker lost');await step(...args);};}
   return solver;
  });
  const synchronous=new BackgroundWorlds(grid);synchronous.step([expected],'planet-1',.01);synchronous.step([expected],'planet-1',.01);
  await background.stepAsync([planet],'planet-1',.01);const dispose=vi.spyOn(failed,'dispose');await background.stepAsync([planet],'planet-1',.01);
  expect(planet).toEqual(expected);expect(calls).toBe(2);expect(dispose).toHaveBeenCalledOnce();warning.mockRestore();
 });
 it('pauses a repeatedly failing inactive world without changing its committed state or blocking other saves',async()=>{
  const failed={id:'planet-failed',name:'Failed',snapshot:snapshot('ice')},good={id:'planet-good',name:'Good',snapshot:snapshot()},before=structuredClone(failed.snapshot),expected=structuredClone(good);
  const warning=vi.spyOn(console,'warn').mockImplementation(()=>{}),onFailure=vi.fn(),factory=vi.fn(async(state:Float32Array)=>{const solver=new CpuSolver(grid,state);if(state[F.ice]>0)solver.step=async()=>{throw new Error('model domain');};return solver;});
  const background=new BackgroundWorlds(grid,factory);await background.stepAsync([failed,good],'planet-active',.01,undefined,onFailure);
  expect(failed.snapshot).toEqual({...before,paused:true});expect(onFailure).toHaveBeenCalledOnce();expect(factory).toHaveBeenCalledTimes(3);
  new BackgroundWorlds(grid).step([expected],'planet-active',.01);expect(good).toEqual(expected);
  const ready=prepareSystemSave({version:3,mode:'sandbox',activeId:good.id,planets:[failed,good],stock:emptyStock(),savedAt:1},grid.count);expect(validSystem(ready,grid.count)).toBe(true);
  await background.stepAsync([failed,good],'planet-active',.01,undefined,onFailure);expect(onFailure).toHaveBeenCalledOnce();warning.mockRestore();
 });
 it('makes period depend on radius and synchronous rotation keep one solar face',()=>{
  expect(orbitalPeriod(4)/orbitalPeriod(1)).toBe(8);
  const s=snapshot();s.spin!.locked=true;
  for(let n=0;n<500;n++){advanceOrbit(s,.2);expect(s.environment.sun[0]).toBeCloseTo(1,8);expect(s.environment.sun[2]).toBeCloseTo(0,8);}
  expect(s.spin!.angle).toBeCloseTo(s.environment.orbitAngle!,8);
  expect(localSun(0,0,Math.PI)[0]).toBeCloseTo(-1,8);
 });
 it('allows a permanently unlit wet surface to cool without changing its mass',()=>{
  const state=seedPlanet(grid,'water',18,'none'),command=new Float32Array(grid.count*COMMAND_STRIDE),solver=new CpuSolver(grid,state);
  const mass=totalMass(state),e=orbitalEnvironment(1.1);e.sun=[0,0,0];
  for(let n=0;n<1800;n++)solver.advance(.2,command,e);
  let ice=0;for(let i=0;i<grid.count;i++)ice+=solver.state[i*STRIDE+F.ice];
  expect(solver.state[F.temperature]).toBeLessThan(18);expect(ice).toBe(0);expect(totalMass(solver.state)).toBeCloseTo(mass,1);
 });
});
