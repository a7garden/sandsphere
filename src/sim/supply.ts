import {COMMAND_STRIDE} from './model';

/** A queued tool input is physical stock before the solver receives it. Retain
 * small additions beside larger pending inputs instead of rounding them away. */
export function createCommandBatch(count:number){return new Float64Array(count*COMMAND_STRIDE);}

export interface SupplyCell {index:number;weight:number;}
/** Brush transfers enter the command batch immediately for surface and air picks,
 * including pause edits. The selected cell footprint owns delivery. */
export function deliverSurfaceSupply(cells:readonly SupplyCell[],amount:number,deposit:(cell:number,mass:number)=>void){
  if(!(amount>0)||!Number.isFinite(amount))return;
  for(const {index,weight} of cells)deposit(index,amount*weight);
}
