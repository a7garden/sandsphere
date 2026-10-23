import {afterEach,describe,expect,it,vi} from 'vitest';
import {CpuSolver,F,STRIDE,seedPlanet,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {createCommandBatch} from '../src/sim/supply';
import {WeatherClimate} from '../src/sim/weatherClimate';
import {climateTransferBuffers,type SolverWorkerRequest,type SolverWorkerReply} from '../src/sim/solverWorkerProtocol';
import {climateSnapshotFromCheckpoint} from '../src/sim/climateSnapshot';
import {BackgroundWorlds,type PlanetRecord} from '../src/sim/system';
import {orbitalEnvironment} from '../src/sim/orbit';
import {createJupiterPlanet} from '../src/sim/planetCreation';

const grid=createSphere(0),environment={...orbitalEnvironment(1),climate:true};
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
function planet(id='planet-background'):PlanetRecord{
 const snapshot:Snapshot={version:11,preset:'coast',planet:{primary:'rock'},state:Array.from(seedPlanet(grid,'rock',20)),time:0,environment:structuredClone(environment),supplied:0,removed:0,discoveries:[],paused:false,spin:{angle:0,running:true,period:120,tilt:0}};
 return {id,name:id,snapshot};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('runtime buffer ownership',()=>{
 it('transfers every checkpoint view once without detaching a live climate buffer',()=>{
  const climate=new WeatherClimate(grid),checkpoint=climate.checkpoint(),before=structuredClone(checkpoint),views:ArrayBufferView[]=[];
  const visit=(v:unknown):void=>{if(ArrayBuffer.isView(v))views.push(v);else if(v&&typeof v==='object')Object.values(v).forEach(visit);};visit(checkpoint);
  const buffers=climateTransferBuffers(checkpoint);expect(new Set(buffers).size).toBe(buffers.length);expect(buffers.length).toBe(views.length);
  for(const field of ['boundaryImpulse','gasRadiationCache','sootRadiationCache','sootLiftCarry'] as const)expect(buffers).toContain(checkpoint.air[field].buffer);
  const received=structuredClone(checkpoint,{transfer:buffers});expect(received).toEqual(before);expect(views.every(v=>v.byteLength===0)).toBe(true);expect(climate.checkpoint()).toEqual(before);
 });

 it('materializes each supported checkpoint shape exactly like the public climate snapshot',()=>{
  const cpu=new CpuSolver(grid,seedPlanet(grid,'rock',20)),empty=createCommandBatch(grid.count);
  const exact=()=>{const snapshot=cpu.climate.snapshot(),converted=climateSnapshotFromCheckpoint(cpu.climate.checkpoint());expect(converted).toEqual(snapshot);expect(JSON.stringify(converted)).toBe(JSON.stringify(snapshot));};
  exact();cpu.advance(.01,empty,environment);exact();
  const giant=createJupiterPlanet(grid);cpu.replace(giant.state);cpu.climate.restore(giant.climate);exact();
 });

 it('keeps ordinary CPU rollback while disposable worker execution avoids its redundant checkpoint',()=>{
  const normal=new CpuSolver(grid,seedPlanet(grid,'rock',20)),uncommitted=new CpuSolver(grid,normal.state.slice()),commands=createCommandBatch(grid.count);commands[1]=2.00000000001;
  const checkpoint=vi.spyOn(uncommitted.climate,'checkpoint');normal.advance(.01,commands,environment);uncommitted.advanceUncommitted(.01,commands,environment);
  expect(checkpoint).not.toHaveBeenCalled();expect(uncommitted.state).toEqual(normal.state);expect(uncommitted.climate.checkpoint()).toEqual(normal.climate.checkpoint());
  normal.climate.lift[0]=.123;const before=normal.state.slice(),climate=normal.climate.checkpoint(),lift=normal.climate.lift.slice();
  vi.spyOn(normal.climate,'step').mockImplementation(()=>{normal.climate.lift[0]=99;throw new Error('transaction failed');});
  expect(()=>normal.advance(.01,commands,environment)).toThrow('transaction failed');expect(normal.state).toEqual(before);expect(normal.climate.checkpoint()).toEqual(climate);expect(normal.climate.lift).toEqual(lift);
 });

 it('discards a failed worker transaction and restores the retained main commit on the next request',async()=>{
  const replies:SolverWorkerReply[]=[],scope={onmessage:null as null|((event:MessageEvent<SolverWorkerRequest>)=>Promise<void>),postMessage:(message:SolverWorkerReply,transfer:Transferable[]=[])=>{replies.push(structuredClone(message,{transfer}));}};
  vi.stubGlobal('self',scope);await import('../src/sim/solver.worker');
  const send=async(message:SolverWorkerRequest)=>{await scope.onmessage!({data:message} as MessageEvent<SolverWorkerRequest>);};
  await send({id:1,type:'init',grid,forceCpu:false,spectralAcceleration:false});expect(replies.at(-1)).toEqual({id:1,type:'ready',backend:'CPU',acceleration:{backend:'js',state:'disabled',memoryBytes:0,tableBytes:0}});
  const cpu=new CpuSolver(grid,seedPlanet(grid,'rock',20)),commands=createCommandBatch(grid.count);commands[1]=3;
  const failed=vi.spyOn(CpuSolver.prototype,'advanceUncommitted').mockImplementationOnce(function(this:CpuSolver){this.state[F.sand]=999;throw new Error('injected failure');});
  await send({id:2,type:'step',dt:0,state:cpu.state.slice(),climate:cpu.climate.checkpoint(),lift:cpu.climate.lift.slice(),commands:commands.slice(),environment});expect(replies.at(-1)?.type).toBe('error');failed.mockRestore();
  await send({id:3,type:'step',dt:0,state:cpu.state.slice(),climate:cpu.climate.checkpoint(),lift:cpu.climate.lift.slice(),commands:commands.slice(),environment});cpu.advance(0,commands,environment);
  const reply=replies.at(-1)!;expect(reply.type).toBe('result');if(reply.type==='result'){expect(reply.result.state).toEqual(cpu.state);expect(reply.result.climate).toEqual(cpu.climate.checkpoint());}
  vi.stubGlobal('WebAssembly',undefined);await send({id:4,type:'init',grid,forceCpu:true,spectralAcceleration:true});expect(replies.at(-1)).toMatchObject({id:4,type:'ready',backend:'CPU',acceleration:{backend:'js',state:'unavailable',reason:'WebAssembly unavailable',memoryBytes:0,tableBytes:0}});
 });
});

describe('background committed residency',()=>{
 it('retains typed immutable commits until a public read, capture or explicit materialization',async()=>{
  const p=planet(),cpu=new CpuSolver(grid,new Float32Array(p.snapshot.state)),snapshot=vi.spyOn(cpu.climate,'snapshot'),background=new BackgroundWorlds(grid,async()=>cpu);
  await background.stepAsync([p],'planet-active',.01);expect(snapshot).not.toHaveBeenCalled();expect(Object.getOwnPropertyDescriptor(p.snapshot,'state')?.get).toBeTypeOf('function');
  const captured=background.capture(p)!;expect(captured.state).toEqual(cpu.state);expect(captured.climate).toEqual(cpu.climate.checkpoint());
  structuredClone(captured,{transfer:[captured.state.buffer as ArrayBuffer,...climateTransferBuffers(captured.climate)]});expect(cpu.state.byteLength).toBeGreaterThan(0);
  const expectedState=cpu.state.slice(),expectedClimate=cpu.climate.snapshot();
  let release!:()=>void;const original=cpu.step.bind(cpu);cpu.step=async(...args)=>{await new Promise<void>(resolve=>release=resolve);await original(...args);};
  const work=background.stepAsync([p],'planet-active',.01);await flush();background.materialize([p]);expect(p.snapshot.state).toEqual(Array.from(expectedState));expect(p.snapshot.climate).toEqual(expectedClimate);expect(background.capture(p)).toBeUndefined();
  release();await work;expect(p.snapshot.time).toBe(.02);expect(new Float32Array(p.snapshot.state)).toEqual(cpu.state);
 });

 it('runs at most two independent planets concurrently and ignores an invalidated result',async()=>{
  const planets=[planet('planet-a'),planet('planet-b'),planet('planet-c')],before=structuredClone(planets[0]);
  const gates:Array<()=>void>=[];let running=0,maximum=0;const instances:CpuSolver[]=[];
  const background=new BackgroundWorlds(grid,async state=>{const cpu=new CpuSolver(grid,state),original=cpu.step.bind(cpu);instances.push(cpu);cpu.step=async(...args)=>{running++;maximum=Math.max(maximum,running);await new Promise<void>(resolve=>gates.push(resolve));try{await original(...args);}finally{running--;}};return cpu;});
  const work=background.stepAsync(planets,'planet-active',.01);await flush();expect(gates.length).toBe(2);expect(maximum).toBe(2);
  background.invalidate('planet-a');gates[0]();await flush();expect(gates.length).toBe(3);gates[1]();gates[2]();await work;
  expect(planets[0]).toEqual(before);expect(planets.slice(1).map(p=>p.snapshot.time)).toEqual([.01,.01]);expect(maximum).toBe(2);
 });

 it('keeps synchronous orbit publication atomic when its physical step fails',()=>{
  const p=planet(),before=structuredClone(p);
  vi.spyOn(CpuSolver.prototype,'advance').mockImplementation(()=>{throw new Error('rejected step');});
  expect(()=>new BackgroundWorlds(grid).step([p],'planet-active',.01)).toThrow('rejected step');expect(p).toEqual(before);
 });

 it('drains independent work before rejecting a batch so the next batch cannot overlap it',async()=>{
  const failed=planet('planet-failed'),good=planet('planet-good'),gates:Array<()=>void>=[];let creations=0;
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  const background=new BackgroundWorlds(grid,async state=>{const cpu=new CpuSolver(grid,state),original=cpu.step.bind(cpu),index=creations++;cpu.step=async(...args)=>{if(index===0||index===2)throw new Error('cannot compute');await new Promise<void>(resolve=>gates.push(resolve));await original(...args);};return cpu;});
  let rejected=false;const first=background.stepAsync([failed,good],'planet-active',.01).catch(()=>{rejected=true;});await flush();expect(gates.length).toBe(1);expect(rejected).toBe(false);
  const second=background.stepAsync([good],'planet-active',.01);await flush();expect(gates.length).toBe(1);gates[0]();await first;await flush();expect(rejected).toBe(true);expect(gates.length).toBe(2);gates[1]();await second;expect(good.snapshot.time).toBe(.02);warn.mockRestore();
 });

 it('queues overlapping batches so a planet never receives concurrent or reordered steps',async()=>{
  const p=planet(),gates:Array<()=>void>=[],times:number[]=[];let running=0,maximum=0;
  const background=new BackgroundWorlds(grid,async state=>{const cpu=new CpuSolver(grid,state),original=cpu.step.bind(cpu);cpu.step=async(...args)=>{running++;maximum=Math.max(maximum,running);times.push(args[0]);await new Promise<void>(resolve=>gates.push(resolve));try{await original(...args);}finally{running--;}};return cpu;});
  const first=background.stepAsync([p],'planet-active',.01),second=background.stepAsync([p],'planet-active',.02);await flush();expect(gates.length).toBe(1);gates[0]();await first;await flush();expect(gates.length).toBe(2);expect(p.snapshot.time).toBe(.01);gates[1]();await second;expect(times).toEqual([.01,.02]);expect(maximum).toBe(1);expect(p.snapshot.time).toBe(.03);
 });
});
