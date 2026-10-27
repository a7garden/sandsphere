// @ts-nocheck -- immutable pre-optimization fixture; production nominal types may evolve.
// Only import paths differ; normalize them to verify the original captured source SHA-256.
import type {PhysicalState} from './physicalState';
/** Local material conversion owns its thermal + gravitational work budget.
 * accept records the new coordinate after the thermal reservoir paid its work;
 * a later mechanical reconciliation must not charge the same work twice. */
import {MIN_THERMODYNAMIC_TEMPERATURE} from './thermodynamics';

export interface LocalMechanics {
 potential(state:PhysicalState,index:number):number;
 accept(state:PhysicalState,index:number):void;
 /** Optional resolved liquid mechanics at the surface/air material boundary. */
 kinetic?(index:number):number;
 massParcel?(state:PhysicalState,index:number,field:number,amount:number):{momentum:number[];kinetic:number};
 transferMass?(state:PhysicalState,index:number,field:number,amount:number,momentum:readonly number[]):number;
 checkpointCell?(index:number):unknown;
 restoreCell?(index:number,checkpoint:unknown):void;
}

export interface LocalEnergyAdapter extends LocalMechanics {
 admissible?(state:PhysicalState,index:number):boolean;
 energy(state:PhysicalState,index:number):number;
 setEnergy(state:PhysicalState,index:number,energy:number):void;
 capacity(state:PhysicalState,index:number):number;
 phase(state:PhysicalState,index:number):number;
}

/** An unaffordable nested trial is an inadmissible candidate of its owning
 * conversion. It must be retried from the unchanged outer reservoir. */
class LocalEnergyAdmissionError extends Error {}

/** Replay the actual local reaction at a shorter extent/rate if its mechanical
 * work would overdraw sensible heat. The callback must only write this column;
 * callers own any diagnostic rollback. External heating/escape belongs outside
 * this operation. No stock interpolation or temperature clamp is performed. */
export function admitLocalChange(state:PhysicalState,index:number,stride:number,
 operation:(fraction:number)=>void,adapter:LocalEnergyAdapter){
 const offset=index*stride,before=state.slice(offset,offset+stride);
 const initialEnergy=adapter.energy(state,index),initialPotential=adapter.potential(state,index);
 const trial=(fraction:number)=>{
  state.set(before,offset);
  if(fraction>0)try{operation(fraction);}catch(error){if(error instanceof LocalEnergyAdmissionError)return {target:NaN,valid:false};throw error;}
  const target=initialEnergy+(initialPotential-adapter.potential(state,index));
  const minimum=adapter.phase(state,index)+adapter.capacity(state,index)*Math.fround(MIN_THERMODYNAMIC_TEMPERATURE);
  return {target,valid:Number.isFinite(target)&&target>=minimum&&(adapter.admissible?.(state,index)??true)};
 };
 let fraction=1,result=trial(1);
 if(!result.valid){
  let lo=0,hi=1;const initial=trial(0);
  if(!initial.valid){state.set(before,offset);throw new LocalEnergyAdmissionError('국소 반응의 초기 에너지 재고가 유효하지 않습니다.');}
  for(let n=0;n<32;n++){const mid=(lo+hi)/2;if(trial(mid).valid)lo=mid;else hi=mid;}
  fraction=lo;result=trial(fraction);
 }
 adapter.setEnergy(state,index,result.target);adapter.accept(state,index);
 return fraction;
}
