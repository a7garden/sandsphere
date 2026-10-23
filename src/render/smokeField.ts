import {F,STRIDE} from '../sim/model';
import {AIR_LAYERS,AIR_SPECIES,COLUMN_KG,type LayeredAtmosphere} from '../sim/layeredAtmosphere';
import {SOOT} from '../sim/aerosolPhysics';
/** A column projection of real carbon inventory, with compressed display height.
 * This owns no particle stock and adds no animated opacity or synthetic plume. */
export function smokeColumn(state:Float32Array,index:number,air?:LayeredAtmosphere){
 let mass=state[index*STRIDE+F.soot],height=500;
 if(air?.ready){mass=0;let weighted=0;for(let k=0;k<AIR_LAYERS;k++){const amount=air.mass[(index*AIR_LAYERS+k)*AIR_SPECIES+8];mass+=amount;weighted+=amount*air.height(k);}height=mass>0?weighted/mass:air.height(0);}
 return {mass,opacity:-Math.expm1(-Math.max(0,mass)*COLUMN_KG*SOOT.shortwave*.01),height:.06+.55*Math.min(1,height/42000)};
}
