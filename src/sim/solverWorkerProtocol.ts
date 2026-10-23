import type {Environment,Solver,PhysicalState} from './model';
import type {SphereGrid} from './sphere';
import type {ClimateCheckpoint} from './weatherClimate';
import type {SpectralAccelerationStatus} from './spectralRadiation';

export interface WorkerStepState {
 state:Float32Array;climate:ClimateCheckpoint;lift:Float32Array;
 escapeCells:Float32Array;condensedCells:Float32Array;precipitatedCells:Float32Array;energyChanges:Float32Array;feedingCells:Float32Array;
}
export type SolverWorkerRequest=
 | {id:number;type:'init';grid:SphereGrid;forceCpu:boolean;spectralAcceleration?:boolean}
 | {id:number;type:'step';dt:number;commands:PhysicalState;environment:Environment;state:Float32Array;climate:ClimateCheckpoint;lift:Float32Array};
export type SolverWorkerReply=
 | {id:number;type:'ready';backend:Solver['backend'];acceleration?:SpectralAccelerationStatus}
 | {id:number;type:'result';result:WorkerStepState}
 | {id:number;type:'error';message:string};

/** Checkpoints own these buffers. Enumerate every typed view recursively so new
 * residual/cache fields cannot silently fall back to structured-clone copies. */
export function climateTransferBuffers(c:ClimateCheckpoint):ArrayBuffer[]{
 const buffers=new Set<ArrayBuffer>();
 const visit=(value:unknown):void=>{
  if(ArrayBuffer.isView(value)){if(value.buffer instanceof ArrayBuffer)buffers.add(value.buffer);return;}
  if(value&&typeof value==='object')for(const child of Object.values(value))visit(child);
 };
 visit(c);return [...buffers];
}
export function resultTransferBuffers(s:WorkerStepState):ArrayBuffer[]{
 return [...new Set([s.state,s.lift,s.escapeCells,s.condensedCells,s.precipitatedCells,s.energyChanges,s.feedingCells].map(a=>a.buffer as ArrayBuffer).concat(climateTransferBuffers(s.climate)))];
}
