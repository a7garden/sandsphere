import {F,STRIDE,type PhysicalState} from './model';
import {AIR_FIELDS,AIR_LAYERS,AIR_SPECIES} from './layeredAtmosphere';
import {DEEP_FIELDS,DEEP_LAYERS} from './deepAtmosphere';
import type {WeatherClimate} from './weatherClimate';

/** A local stock is read from the same owner as totals(): authoritative layer
 * columns replace mirrors, while surface material retains its low bits. */
export function observedCellStock(state:PhysicalState,cell:number,field:number,climate?:WeatherClimate){
 if(climate?.giant.ready){const species=(DEEP_FIELDS as readonly number[]).indexOf(field);if(species<0)return 0;let mass=0;for(let k=0;k<DEEP_LAYERS;k++)mass+=climate.giant.mass[(cell*DEEP_LAYERS+k)*DEEP_FIELDS.length+species];return mass;}
 if(climate?.air.ready){
  const species=(AIR_FIELDS as readonly number[]).indexOf(field);
  if(species>=0||field===F.airborneDust){let mass=0;for(let k=0;k<AIR_LAYERS;k++){const q=cell*AIR_LAYERS+k;mass+=field===F.airborneDust?climate.air.dustMass[q]:climate.air.mass[q*AIR_SPECIES+species];}return mass;}
 }
 return climate?climate.air.surfaceStock(state,cell*STRIDE+field):state[cell*STRIDE+field];
}
