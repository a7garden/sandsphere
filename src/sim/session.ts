import {COMMAND_STRIDE,COMMAND_FIELD,MASS_FIELDS,STRIDE,applyCommand,emptyStock,type Material} from './model';

export interface FallingDeposit {index:number;material:Material;amount:number;}

/** Save a complete material budget without snapping or stopping visible falling grains. */
export function snapshotSurface(live:Float32Array,pending:Float32Array,falling:FallingDeposit[],inFlight?:Float32Array|null):{state:Float32Array;pendingRemoved:number;collected:ReturnType<typeof emptyStock>} {
  const prior=inFlight?snapshotSurface(live,inFlight,[]):null;
  const state=prior?.state??new Float32Array(live),count=live.length/STRIDE;
  let pendingRemoved=prior?.pendingRemoved??0;
  const collected=prior?.collected??emptyStock();
  for(let i=0;i<count;i++) {
    const c=i*COMMAND_STRIDE,fraction=Math.max(0,Math.min(1,pending[c+5]));
    if(fraction) {
      let mass=Object.values(COMMAND_FIELD).reduce((sum,f)=>sum+pending[c+f],0);
      for(const f of MASS_FIELDS)mass+=state[i*STRIDE+f];pendingRemoved+=mass*fraction;
    }
    applyCommand(state,i,pending,collected);
  }
  const landing=new Float32Array(pending.length);
  for(const grain of falling)landing[grain.index*COMMAND_STRIDE+COMMAND_FIELD[grain.material]]+=grain.amount;
  for(let i=0;i<count;i++)applyCommand(state,i,landing);
  return {state,pendingRemoved,collected};
}
