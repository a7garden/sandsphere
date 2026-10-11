import {STRIDE,COMMAND_STRIDE,F,applyCommand,capacity} from './model';
import {AIR_FIELDS} from './layeredAtmosphere';

/** Predict queued commands before asking for heat, so a waiting GPU batch is
 * neither heated twice nor treated as if arriving mass had zero heat capacity. */
export function heatForTarget(state:Float32Array,index:number,target:number,mode:'heat'|'cool',queued:Float32Array,active?:Float32Array|null,layered=false){
  const cell=state.slice(index*STRIDE,(index+1)*STRIDE),start=index*COMMAND_STRIDE;
  if(layered)for(const f of AIR_FIELDS)cell[f]=0;
  const predict=(commands:Float32Array)=>{const batch=commands.slice(start,start+COMMAND_STRIDE);if(layered)for(const k of [8,9,10])batch[k]=0;applyCommand(cell,0,batch);};
  if(active)predict(active);
  predict(queued);
  const delta=mode==='heat'?Math.max(0,target-cell[F.temperature]):Math.min(0,target-cell[F.temperature]);
  return Math.abs(delta)<.01?0:capacity(cell,0)*delta;
}
