import {totals,STRIDE,MASS_FIELDS,type CpuSolver} from '../../src/sim/model';
/** Count canonical layers and retained surface stock, never rounded mirrors. */
export function airInventory(s:CpuSolver){
 const canonical=totals(s.state,s.climate),stock=new Float64Array(STRIDE);
 for(const f of MASS_FIELDS)stock[f]=canonical[f];
 return stock;
}
