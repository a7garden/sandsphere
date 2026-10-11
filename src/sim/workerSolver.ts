import {WeatherClimate} from './weatherClimate';
import type {SphereGrid} from './sphere';
import type {Environment,Solver} from './model';
import {climateTransferBuffers,type SolverWorkerRequest,type SolverWorkerReply} from './solverWorkerProtocol';

/** Surface, atmosphere and ecology compute off the UI thread. The UI sees only
 * complete steps, so rendering, edits and save accounting share one snapshot. */
export class WorkerSolver implements Solver {
 readonly climate:WeatherClimate;
 readonly backgroundCompute=true;
 backend:Solver['backend']='CPU';
 escapeCells:Float32Array;condensedCells:Float32Array;precipitatedCells:Float32Array;energyChanges:Float32Array;feedingCells:Float32Array;
 private nextId=0;
 private stopped=false;
 private inFlight=false;
 private pending=new Map<number,{resolve:(reply:SolverWorkerReply)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 private constructor(readonly grid:SphereGrid,public state:Float32Array,private worker:Worker){
  this.climate=new WeatherClimate(grid);
  this.escapeCells=new Float32Array(grid.count*4);this.condensedCells=new Float32Array(grid.count);
  this.precipitatedCells=new Float32Array(grid.count*2);this.energyChanges=new Float32Array(grid.count*4);
  this.feedingCells=new Float32Array(grid.count*2);
  worker.onmessage=({data}:MessageEvent<SolverWorkerReply>)=>{
   const pending=this.pending.get(data.id);if(!pending)return;
   this.pending.delete(data.id);clearTimeout(pending.timer);
   if(data.type==='error')pending.reject(new Error(data.message));else pending.resolve(data);
  };
  worker.onerror=event=>{event.preventDefault();this.stop(new Error(event.message||'Simulation worker stopped'));};
  worker.onmessageerror=()=>this.stop(new Error('Simulation worker response could not be read'));
 }
 static async create(grid:SphereGrid,state:Float32Array,forceCpu=false):Promise<WorkerSolver|null>{
  if(typeof Worker==='undefined')return null;
  const solver=new WorkerSolver(grid,state.slice(),new Worker(new URL('./solver.worker.ts',import.meta.url),{type:'module',name:'Sandsphere physics'}));
  try{
   const reply=await solver.request({id:0,type:'init',grid,forceCpu});
   if(reply.type!=='ready')throw new Error('Unexpected simulation worker initialization');
   solver.backend=reply.backend;return solver;
  }catch(error){solver.dispose();throw error;}
 }
 private request(message:SolverWorkerRequest,transfer:Transferable[]=[]):Promise<SolverWorkerReply>{
  if(this.stopped)return Promise.reject(new Error('Simulation worker is disposed'));
  message.id=++this.nextId;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>this.stop(new Error('Simulation worker timed out')),15000);
   this.pending.set(message.id,{resolve,reject,timer});
   try{this.worker.postMessage(message,transfer);}catch(error){this.stop(error instanceof Error?error:new Error(String(error)));}
  });
 }
 async step(dt:number,commands:Float32Array,environment:Environment){
  if(this.stopped)throw new Error('Simulation worker is disposed');
  if(this.inFlight)throw new Error('A simulation step is already running');
  if(dt<=0&&!commands.some(v=>v!==0)){this.clearTransfers();return;}
  this.inFlight=true;
  try{
   const state=this.state.slice(),climate=this.climate.checkpoint(),batch=commands.slice(),lift=this.climate.lift.slice();
   const reply=await this.request({id:0,type:'step',dt,commands:batch,environment,state,climate,lift},
    [state.buffer,batch.buffer,lift.buffer,...climateTransferBuffers(climate)]);
   if(reply.type!=='result')throw new Error('Unexpected simulation worker response');
   // Publish together, without mutating or detaching any live input while waiting.
   const result=reply.result;this.state=result.state;this.climate.restoreCheckpoint(result.climate);this.climate.lift.set(result.lift);
   this.escapeCells=result.escapeCells;this.condensedCells=result.condensedCells;
   this.precipitatedCells=result.precipitatedCells;this.energyChanges=result.energyChanges;this.feedingCells=result.feedingCells;
  }finally{this.inFlight=false;}
 }
 replace(state:Float32Array){
  if(this.inFlight)throw new Error('Cannot replace a running simulation step');
  this.state=state.slice();this.clearTransfers();
 }
 private clearTransfers(){this.escapeCells.fill(0);this.condensedCells.fill(0);this.precipitatedCells.fill(0);this.energyChanges.fill(0);this.feedingCells.fill(0);}
 private stop(error:Error){
  this.stopped=true;this.worker.terminate();
  for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();
 }
 dispose(){this.stop(new Error('Simulation worker is disposed'));}
}
