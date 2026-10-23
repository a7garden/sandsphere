import {afterEach,describe,it,expect,vi} from 'vitest';
import {WorkerSolver} from '../src/sim/workerSolver';
import {CpuSolver,COMMAND_STRIDE,F,seedPlanet,totalMass} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {PHYSICS_DT} from '../src/sim/clock';
import {orbitalEnvironment} from '../src/sim/orbit';
import {resultTransferBuffers,type SolverWorkerRequest,type SolverWorkerReply} from '../src/sim/solverWorkerProtocol';
import {createCommandBatch} from '../src/sim/supply';

class ControlledWorker {
 static latest:ControlledWorker;
 onmessage:((event:{data:SolverWorkerReply})=>void)|null=null;
 onerror:((event:{message:string;preventDefault:()=>void})=>void)|null=null;
 onmessageerror:(()=>void)|null=null;
 terminated=false;request:SolverWorkerRequest|null=null;initRequest:Extract<SolverWorkerRequest,{type:'init'}>|null=null;
 constructor(){ControlledWorker.latest=this;}
 postMessage(request:SolverWorkerRequest,transfer:Transferable[]=[]){
  const copy=structuredClone(request,{transfer});
  if(copy.type==='init'){
   this.initRequest=copy;
   const acceleration=copy.spectralAcceleration===false?{backend:'js' as const,state:'disabled' as const,memoryBytes:0,tableBytes:0}:undefined;
   queueMicrotask(()=>this.onmessage?.({data:{id:copy.id,type:'ready',backend:'CPU',...(acceleration?{acceleration}:{})}}));
  }
  else this.request=copy;
 }
 async complete(){
  const request=this.request!;if(request.type!=='step')throw new Error('No step queued');
  const grid=createSphere(1),cpu=new CpuSolver(grid,request.state);
  cpu.climate.restoreCheckpoint(request.climate);cpu.climate.lift.set(request.lift);
  await cpu.step(request.dt,request.commands,request.environment);
  const result={state:cpu.state,climate:cpu.climate.checkpoint(),lift:cpu.climate.lift,
   escapeCells:cpu.escapeCells,condensedCells:cpu.condensedCells,precipitatedCells:cpu.precipitatedCells,energyChanges:cpu.energyChanges,feedingCells:cpu.feedingCells};
  this.onmessage?.({data:structuredClone({id:request.id,type:'result',result},{transfer:resultTransferBuffers(result)})});
 }
 terminate(){this.terminated=true;}
}
afterEach(()=>vi.unstubAllGlobals());
describe('simulation worker commits',()=>{
 const grid=createSphere(1),environment={...orbitalEnvironment(1),climate:true};
 const make=async()=>{vi.stubGlobal('Worker',ControlledWorker);return (await WorkerSolver.create(grid,seedPlanet(grid,'sand',22),true))!;};

 it('forwards optional spectral control and reports the returned init diagnostic without changing the CPU backend',async()=>{
  vi.stubGlobal('Worker',ControlledWorker);
  const worker=(await WorkerSolver.create(grid,seedPlanet(grid,'sand',22),true,{spectralAcceleration:false}))!;
  expect(ControlledWorker.latest.initRequest).toMatchObject({type:'init',forceCpu:true,spectralAcceleration:false});
  expect(worker.backend).toBe('CPU');expect(worker.acceleration).toEqual({backend:'js',state:'disabled',memoryBytes:0,tableBytes:0});worker.dispose();
  const compatible=await make();expect(ControlledWorker.latest.initRequest?.spectralAcceleration).toBeUndefined();expect(compatible.acceleration).toBeUndefined();compatible.dispose();
 });

 it('transfers Float64 tool queues without discarding small finite inputs',async()=>{
  const worker=await make(),before=totalMass(worker.state,worker.climate),commands=createCommandBatch(grid.count);commands[1]=1000;
  for(let n=0;n<10000;n++)commands[1]+=.00001;
  const supplied=commands[1],step=worker.step(0,commands,environment),request=ControlledWorker.latest.request;
  expect(request?.type).toBe('step');
  if(request?.type==='step'){expect(request.commands).toBeInstanceOf(Float64Array);expect(request.commands[1]).toBe(supplied);}
  expect(commands[1]).toBe(supplied);
  await ControlledWorker.latest.complete();await step;
  expect(totalMass(worker.state,worker.climate)-before).toBeCloseTo(1000.1,8);worker.dispose();
 });

 it('keeps live buffers readable until a complete step and matches direct CPU computation exactly',async()=>{
  const worker=await make(),initial=worker.state,checkpoint=worker.climate.checkpoint(),commands=new Float32Array(grid.count*COMMAND_STRIDE);commands[1]=7;
  const cpu=new CpuSolver(grid,initial.slice());cpu.climate.restoreCheckpoint(checkpoint);await cpu.step(PHYSICS_DT,commands,environment);
  const step=worker.step(PHYSICS_DT,commands,environment);
  expect(worker.state).toBe(initial);expect(initial.byteLength).toBeGreaterThan(0);expect(commands[1]).toBe(7);
  expect(worker.climate.checkpoint()).toEqual(checkpoint);
  await ControlledWorker.latest.complete();await step;
  expect(worker.state).toEqual(cpu.state);expect(worker.climate.checkpoint()).toEqual(cpu.climate.checkpoint());
  expect(worker.climate.lift).toEqual(cpu.climate.lift);expect(worker.energyChanges).toEqual(cpu.energyChanges);expect(worker.feedingCells).toEqual(cpu.feedingCells);worker.dispose();
 });

 it('carries restored planets and paused commands without advancing climate time',async()=>{
  const worker=await make(),commands=new Float32Array(grid.count*COMMAND_STRIDE);commands[1]=2;
  let step=worker.step(PHYSICS_DT,commands,environment);await ControlledWorker.latest.complete();await step;
  const savedState=worker.state.slice(),savedClimate=worker.climate.checkpoint();
  worker.replace(seedPlanet(grid,'ice',-20));worker.climate.restore();
  worker.replace(savedState);worker.climate.restoreCheckpoint(savedClimate);
  commands.fill(0);commands[8]=.3;commands[4]=12;
  const cpu=new CpuSolver(grid,savedState.slice());cpu.climate.restoreCheckpoint(savedClimate);cpu.climate.lift.set(worker.climate.lift);
  await cpu.step(0,commands,environment);step=worker.step(0,commands,environment);await ControlledWorker.latest.complete();await step;
  expect(worker.state).toEqual(cpu.state);expect(worker.climate.checkpoint()).toEqual(cpu.climate.checkpoint());expect(worker.climate.lift).toEqual(cpu.climate.lift);worker.dispose();
 });

 it('preserves the committed state on failure so fallback supplies a command exactly once',async()=>{
  const worker=await make(),before=worker.state.slice(),climate=worker.climate.checkpoint(),commands=new Float32Array(grid.count*COMMAND_STRIDE);commands[1]=7;
  const step=worker.step(PHYSICS_DT,commands,environment),failed=expect(step).rejects.toThrow('Worker crashed');
  ControlledWorker.latest.onerror?.({message:'Worker crashed',preventDefault:()=>{}});await failed;
  expect(worker.state).toEqual(before);expect(worker.climate.checkpoint()).toEqual(climate);
  const cpu=new CpuSolver(grid,worker.state.slice());cpu.climate.restoreCheckpoint(worker.climate.checkpoint());cpu.advance(0,commands,{...environment,climate:false});
  expect(totalMass(cpu.state)-totalMass(before)).toBeCloseTo(7,6);expect(ControlledWorker.latest.terminated).toBe(true);
 });

 it('rejects overlapping steps and cancels pending work on disposal',async()=>{
  const worker=await make(),before=worker.state,commands=new Float32Array(grid.count*COMMAND_STRIDE);commands[1]=1;
  const step=worker.step(PHYSICS_DT,commands,environment);
  await expect(worker.step(PHYSICS_DT,commands,environment)).rejects.toThrow('already running');
  expect(()=>worker.replace(before)).toThrow('running');
  const failed=expect(step).rejects.toThrow('disposed');worker.dispose();await failed;
  await ControlledWorker.latest.complete();expect(worker.state).toBe(before);
 });

 it('supports environments without Worker and clears diagnostics on paused no-ops',async()=>{
  vi.stubGlobal('Worker',undefined);expect(await WorkerSolver.create(grid,seedPlanet(grid,'sand',22))).toBeNull();
  const worker=await make();worker.energyChanges[0]=4;worker.feedingCells[0]=1;const initial=worker.state;
  await worker.step(0,new Float32Array(grid.count*COMMAND_STRIDE),environment);
  expect(worker.state).toBe(initial);expect(worker.energyChanges[0]).toBe(0);expect(worker.feedingCells[0]).toBe(0);expect(ControlledWorker.latest.request).toBeNull();worker.dispose();
 });
});
