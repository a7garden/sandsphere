import {STRIDE,COMMAND_STRIDE,F,applyCommand,capacity} from './model';

/** Predict queued commands before asking for heat, so a waiting GPU batch is
 * neither heated twice nor treated as if arriving mass had zero heat capacity. */
export function heatForTarget(state:Float32Array,index:number,target:number,mode:'heat'|'cool',queued:Float32Array,active?:Float32Array|null){
  const cell=state.slice(index*STRIDE,(index+1)*STRIDE),start=index*COMMAND_STRIDE;
  if(active)applyCommand(cell,0,active.slice(start,start+COMMAND_STRIDE));
  applyCommand(cell,0,queued.slice(start,start+COMMAND_STRIDE));
  const delta=mode==='heat'?Math.max(0,target-cell[F.temperature]):Math.min(0,target-cell[F.temperature]);
  return Math.abs(delta)<.01?0:capacity(cell,0)*delta;
}
