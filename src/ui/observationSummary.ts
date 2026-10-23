import {F,STRIDE,totals} from '../sim/model';
import {observedCellStock} from '../sim/observations';
import {dustOpticalDepth} from '../sim/dustPhysics';
import {COLUMN_KG} from '../sim/layeredAtmosphere';
import type {WeatherClimate} from '../sim/weatherClimate';

export interface ObservationSummary {stock:Float64Array;min:number;max:number;cloudCells:number;stormCells:number;}
interface Entry {revision:number;climate:WeatherClimate|undefined;summary:ObservationSummary;}
const summaries=new WeakMap<Float32Array,Entry>();
/** A revision must advance for surface AND authoritative column changes. Without
 * one, calculate afresh so legacy callers never retain mutable physics data. */
export function observationSummary(state:Float32Array,climate?:WeatherClimate,revision?:number):ObservationSummary {
 const cached=summaries.get(state);
 if(revision!==undefined&&cached?.revision===revision&&cached.climate===climate)return cached.summary;
 let min=Infinity,max=-Infinity,cloudCells=0,stormCells=0;
 for(let i=0;i<state.length/STRIDE;i++){
  const temperature=state[i*STRIDE+F.temperature];min=Math.min(min,temperature);max=Math.max(max,temperature);
  if(observedCellStock(state,i,F.cloud,climate)+observedCellStock(state,i,F.cloudIce,climate)>.02)cloudCells++;
  if(dustOpticalDepth(observedCellStock(state,i,F.airborneDust,climate)*COLUMN_KG)>=1)stormCells++;
 }
 const summary={stock:totals(state,climate),min,max,cloudCells,stormCells};
 if(revision!==undefined)summaries.set(state,{revision,climate,summary});
 return summary;
}
