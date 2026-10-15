import {it,expect,vi} from 'vitest';
import {CpuSolver,seedPlanet,totalEnthalpy} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {WeatherClimate,climateColor} from '../src/sim/weatherClimate';
import {LayeredAtmosphere} from '../src/sim/layeredAtmosphere';
import {DeepAtmosphere} from '../src/sim/deepAtmosphere';
import {BackgroundWorlds,migrateWorld} from '../src/sim/system';
import {createJupiterPlanet} from '../src/sim/planetCreation';
import {orbitalEnvironment} from '../src/sim/orbit';
import {climateTransferBuffers} from '../src/sim/solverWorkerProtocol';
import {atmosphereState} from '../src/sim/atmosphere';
const grid=createSphere(0),environment={...orbitalEnvironment(1),climate:true};
const record=(id:string)=>({...migrateWorld({version:4,preset:'coast',state:[...seedPlanet(grid,'sand',22)],environment,time:0,supplied:0,removed:0,discoveries:[]},grid.count).planets[0],id});
it('does not allocate inactive atmospheric domains for readiness, diagnostics or compact checkpoints',()=>{
 const c=new WeatherClimate(grid),state=seedPlanet(grid,'sand',22);expect(c.airReady).toBe(false);expect(c.giantReady).toBe(false);c.snapshot();c.checkpoint();totalEnthalpy(state,c);atmosphereState(state,environment,c);climateColor('wind',state,0,environment,c);climateColor('jets',state,0,environment,c);
 expect(Object.values(c).some(x=>x instanceof LayeredAtmosphere||x instanceof DeepAtmosphere)).toBe(false);
 c.prepareSurface(state,environment);expect(c.airReady).toBe(true);expect(Object.values(c).some(x=>x instanceof DeepAtmosphere)).toBe(false);
 const p=createJupiterPlanet(grid),giant=new WeatherClimate(grid);giant.restore(p.climate);const checkpoint=giant.checkpoint();expect(checkpoint.air.mass.length).toBe(0);expect(checkpoint.giant).toBeDefined();atmosphereState(p.state,p.environment,giant);expect(Object.values(giant).some(x=>x instanceof LayeredAtmosphere)).toBe(false);
 c.restoreCheckpoint(checkpoint);expect(c.giantReady).toBe(true);expect(c.airReady).toBe(false);expect(Object.values(c).some(x=>x instanceof LayeredAtmosphere)).toBe(false);
 c.restore();expect(c.giantReady).toBe(false);expect(c.airReady).toBe(false);
});
it('transfers every climate array, including soot caches, without duplicating ownership',()=>{
 const c=new WeatherClimate(grid);c.prepareSurface(seedPlanet(grid,'sand',22),environment);const checkpoint=c.checkpoint(),transfer=climateTransferBuffers(checkpoint);
 for(const value of [...Object.values(checkpoint.air),checkpoint.wind,checkpoint.currents,checkpoint.seeds])if(ArrayBuffer.isView(value))expect(transfer).toContain(value.buffer);
 expect(new Set(transfer).size).toBe(transfer.length);const copy=structuredClone(checkpoint,{transfer});expect(copy.air.initialized).toBe(true);expect(copy.air.sootRadiationCache.length).toBeGreaterThan(0);
});
it('keeps deferred background snapshots fixed while later steps reuse live solver buffers',async()=>{
 let live:CpuSolver|undefined;const background=new BackgroundWorlds(grid,async state=>live=new CpuSolver(grid,state)),planet=record('planet-b'),worlds=[record('planet-a'),planet];
 await background.stepAsync(worlds,'planet-a',1/30);const old=planet.snapshot,expected=live!.state.slice(),climate=live!.climate.snapshot();
 expect(Object.getOwnPropertyDescriptor(old,'state')!.get).toBeTypeOf('function');expect(Object.getOwnPropertyDescriptor(old,'climate')!.get).toBeTypeOf('function');
 for(let n=0;n<3;n++)await background.stepAsync(worlds,'planet-a',1/30);
 expect(old.time).toBe(1/30);expect(old.state).toEqual([...expected]);expect(old.climate).toEqual(climate);expect(planet.snapshot.time).toBeCloseTo(4/30,14);expect(old.state).toBe(old.state);expect(old.climate).toBe(old.climate);
});
it('limits background concurrency to two and publishes only completed independent steps',async()=>{
 let running=0,maximum=0;const releases:Array<()=>void>=[],worlds=[record('planet-a'),record('planet-b'),record('planet-c'),record('planet-d')];
 const background=new BackgroundWorlds(grid,async state=>{const solver=new CpuSolver(grid,state),step=solver.step.bind(solver);solver.step=async(...args)=>{running++;maximum=Math.max(maximum,running);await new Promise<void>(resolve=>releases.push(resolve));try{await step(...args);}finally{running--;}};return solver;});
 const active=structuredClone(worlds[0]),job=background.stepAsync(worlds,'planet-a',1/30);
 await vi.waitFor(()=>expect(releases.length).toBe(2));expect(worlds.map(p=>p.snapshot.time)).toEqual([0,0,0,0]);releases.shift()!();await vi.waitFor(()=>expect(releases.length).toBe(2));for(const release of releases.splice(0))release();await job;
 expect(maximum).toBe(2);expect(worlds[0]).toEqual(active);for(const p of worlds.slice(1))expect(p.snapshot.time).toBe(1/30);
});
