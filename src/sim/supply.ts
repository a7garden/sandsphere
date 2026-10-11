export interface SupplyCell {index:number;weight:number;}
/** Brush transfers enter the command batch immediately for surface and air picks,
 * including pause edits. The selected cell footprint owns delivery. */
export function deliverSurfaceSupply(cells:readonly SupplyCell[],amount:number,deposit:(cell:number,mass:number)=>void){
  if(!(amount>0)||!Number.isFinite(amount))return;
  for(const {index,weight} of cells)deposit(index,amount*weight);
}
