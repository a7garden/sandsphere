import {CpuSolver,STRIDE} from './model';
import type {SphereGrid} from './sphere';
import {initializeSpectralAcceleration} from './spectralRadiation';
import {resultTransferBuffers,type SolverWorkerRequest,type SolverWorkerReply} from './solverWorkerProtocol';

const scope=self as unknown as {
 onmessage:((event:MessageEvent<SolverWorkerRequest>)=>void)|null;
 postMessage:(message:SolverWorkerReply,transfer?:Transferable[])=>void;
};
let solver:CpuSolver|undefined;let grid:SphereGrid|undefined;
scope.onmessage=async({data:request})=>{
 try{
  if(request.type==='init'){
   solver?.dispose();solver=undefined;grid=request.grid;
   const state=new Float32Array(request.grid.count*STRIDE);
   solver=new CpuSolver(request.grid,state);
   // Initialization is bounded and selects the exact JS fallback on unsupported
   // runtimes. It never runs inside a physical advance or changes the backend.
   const acceleration=await initializeSpectralAcceleration({enabled:request.spectralAcceleration});
   scope.postMessage({id:request.id,type:'ready',backend:solver.backend,acceleration});return;
  }
  if(!solver)throw new Error('Simulation worker is not initialized');
  // Each request starts from the application's last committed state. This also
  // carries planet switches, restored saves and external climate edits exactly.
  solver.state=request.state;solver.climate.restoreCheckpoint(request.climate);solver.climate.lift.set(request.lift);
  solver.advanceUncommitted(request.dt,request.commands,request.environment);
  // The worker relinquishes only its published surface buffer. The next request
  // supplies a fresh owned buffer; rollback/scratch buffers remain resident.
  const result={state:solver.state,climate:solver.climate.checkpoint(),lift:solver.climate.lift.slice(),
   escapeCells:solver.escapeCells.slice(),condensedCells:solver.condensedCells.slice(),precipitatedCells:solver.precipitatedCells.slice(),energyChanges:solver.energyChanges.slice(),feedingCells:solver.feedingCells.slice()};
  scope.postMessage({id:request.id,type:'result',result},resultTransferBuffers(result));
 }catch(error){
  // A failed uncommitted transaction may have mutated any worker-local array.
  // Never reuse it: the next request restores the application's retained commit.
  if(request.type==='step'){solver?.dispose();solver=grid?new CpuSolver(grid,new Float32Array(grid.count*STRIDE)):undefined;}
  scope.postMessage({id:request.id,type:'error',message:error instanceof Error?error.message:String(error)});}
};
