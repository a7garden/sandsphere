export interface SupplyCell {index:number;weight:number;}
/** Surface brush transfers enter the command batch immediately, including pause edits. */
export function deliverSurfaceSupply(cells:readonly SupplyCell[],amount:number,deposit:(cell:number,mass:number)=>void){
  if(!(amount>0)||!Number.isFinite(amount))return;
  for(const {index,weight} of cells)deposit(index,amount*weight);
}
