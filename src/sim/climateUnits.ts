import {REFERENCE_PRESSURE,REFERENCE_GAS_MASS} from './waterPhysics';
/** Shared boundary-flux units for the simple and layered climate domains. */
export const AIR_SECONDS=60;
export const COLUMN_KG=REFERENCE_PRESSURE/(9.81*REFERENCE_GAS_MASS);
export function radiationEnergy(flux:number,physicalSeconds:number){return flux*physicalSeconds/(COLUMN_KG*1000);}
