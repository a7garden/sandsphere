import type {Environment,Solver} from './model';
import type {SphereGrid} from './sphere';
import type {ClimateCheckpoint} from './weatherClimate';

export interface WorkerStepState {
 state:Float32Array;climate:ClimateCheckpoint;lift:Float32Array;
 escapeCells:Float32Array;condensedCells:Float32Array;precipitatedCells:Float32Array;energyChanges:Float32Array;feedingCells:Float32Array;
}
export type SolverWorkerRequest=
 | {id:number;type:'init';grid:SphereGrid;forceCpu:boolean}
 | {id:number;type:'step';dt:number;commands:Float32Array;environment:Environment;state:Float32Array;climate:ClimateCheckpoint;lift:Float32Array};
export type SolverWorkerReply=
 | {id:number;type:'ready';backend:Solver['backend']}
 | {id:number;type:'result';result:WorkerStepState}
 | {id:number;type:'error';message:string};

/** Only copied buffers cross the boundary; committed state remains readable. */
export function climateTransferBuffers(c:ClimateCheckpoint):ArrayBuffer[]{
 return [...new Set([c.wind,c.currents,c.seeds,c.air.dustMass,c.air.dustRadiationCache,c.air.sootRadiationCache,c.air.dustLiftCarry,c.air.sootLiftCarry,c.air.mass,c.air.temperature,c.air.velocity,c.air.updraft,c.air.roundoff,c.air.radiationCache,...(c.giant?[c.giant.mass,c.giant.temperature,c.giant.velocity,c.giant.height]:[])].map(a=>a.buffer as ArrayBuffer))];
}
export function resultTransferBuffers(s:WorkerStepState):ArrayBuffer[]{
 return [s.state,s.lift,s.escapeCells,s.condensedCells,s.precipitatedCells,s.energyChanges,s.feedingCells].map(a=>a.buffer as ArrayBuffer).concat(climateTransferBuffers(s.climate));
}
