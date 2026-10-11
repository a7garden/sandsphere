import {CpuSolver,STRIDE,type Solver} from './model';
import {GpuSolver} from './gpu';
import {resultTransferBuffers,type SolverWorkerRequest,type SolverWorkerReply} from './solverWorkerProtocol';

const scope=self as unknown as {
 onmessage:((event:MessageEvent<SolverWorkerRequest>)=>void)|null;
 postMessage:(message:SolverWorkerReply,transfer?:Transferable[])=>void;
};
let solver:Solver|undefined;
scope.onmessage=async({data:request})=>{
 try{
  if(request.type==='init'){
   solver?.dispose();solver=undefined;
   const state=new Float32Array(request.grid.count*STRIDE);
   if(!request.forceCpu)try{solver=await GpuSolver.create(request.grid,state)??undefined;}catch(error){console.warn('Worker GPU unavailable; using worker CPU.',error);}
   solver??=new CpuSolver(request.grid,state);
   scope.postMessage({id:request.id,type:'ready',backend:solver.backend});return;
  }
  if(!solver)throw new Error('Simulation worker is not initialized');
  // Each request starts from the application's last committed state. This also
  // carries planet switches, restored saves and external climate edits exactly.
  solver.replace(request.state);solver.climate.restoreCheckpoint(request.climate);solver.climate.lift.set(request.lift);
  await solver.step(request.dt,request.commands,request.environment);
  const result={state:solver.state.slice(),climate:solver.climate.checkpoint(),lift:solver.climate.lift.slice(),
   escapeCells:solver.escapeCells.slice(),condensedCells:solver.condensedCells.slice(),precipitatedCells:solver.precipitatedCells.slice(),energyChanges:solver.energyChanges.slice(),feedingCells:solver.feedingCells.slice()};
  scope.postMessage({id:request.id,type:'result',result},resultTransferBuffers(result));
 }catch(error){scope.postMessage({id:request.id,type:'error',message:error instanceof Error?error.message:String(error)});}
};
