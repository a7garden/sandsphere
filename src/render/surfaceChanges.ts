import {F,STRIDE} from '../sim/model';
import {SOLID_VOLUMES} from '../sim/solidMechanics';

export interface SurfaceChanges {geometry:boolean;water:boolean;appearance:boolean;temperature:boolean;biosphere:boolean;section:boolean;}
const geometryFields=new Set([...SOLID_VOLUMES.map(([field])=>field),F.hydrogen,F.helium]);
const appearanceFields=new Set([...geometryFields,F.water,F.plant]);
const biosphereFields=new Set([...geometryFields,F.water,F.plant,F.herbivore,F.carnivore,F.temperature,F.dissolved]);
/** Compare the published surface, even when callers mutate the same array. The
 * snapshot is presentation-owned and never becomes a simulation inventory. */
export class SurfaceChangeTracker {
 private previous:Float32Array|null=null;
 reset(){this.previous=null;}
 read(state:Float32Array):SurfaceChanges {
  const first=!this.previous||this.previous.length!==state.length;
  const changes:SurfaceChanges={geometry:first,water:first,appearance:first,temperature:first,biosphere:first,section:first};
  if(!first)for(let i=0;i<state.length;i++)if(state[i]!==this.previous![i]){
   const field=i%STRIDE;
   changes.geometry ||= geometryFields.has(field);
   changes.water ||= field===F.water||field===F.soil||field===F.ice;
   changes.appearance ||= appearanceFields.has(field);
   changes.temperature ||= field===F.temperature;
   changes.biosphere ||= biosphereFields.has(field);
   changes.section ||= appearanceFields.has(field);
  }
  if(first)this.previous=new Float32Array(state);else this.previous!.set(state);
  return changes;
 }
}
