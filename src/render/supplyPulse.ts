import type {SupplyCell} from '../sim/supply';

export const SUPPLY_PULSE_LIFE=.24;
/** One reusable texel per cell. Repeated strokes replace, never accumulate,
 * effects. Only emission changes pixels; fading needs a single time uniform. */
export class SupplyPulse {
 readonly width=64;
 readonly height:number;
 readonly pixels:Float32Array;
 time=0;
 dirty=false;
 private lastEmission=-Infinity;
 constructor(readonly cellCount:number){
  this.height=Math.max(1,Math.ceil(cellCount/this.width));
  this.pixels=new Float32Array(this.width*this.height*4);
 }
 get active(){return this.time-this.lastEmission<SUPPLY_PULSE_LIFE;}
 emit(cells:readonly SupplyCell[],color:readonly number[],amount:number){
  if(!(amount>0)||!Number.isFinite(amount))return;
  for(const {index,weight} of cells){
   const mass=amount*weight;
   if(!Number.isInteger(index)||index<0||index>=this.cellCount||!(mass>0)||!Number.isFinite(mass))continue;
   const gain=.55+.45*(1-Math.exp(-mass*3)),p=index*4;
   for(let k=0;k<3;k++)this.pixels[p+k]=(.25+.75*color[k])*gain;
   this.pixels[p+3]=this.time;this.dirty=true;this.lastEmission=this.time;
  }
 }
 advance(dt:number){if(Number.isFinite(dt))this.time+=Math.max(0,dt);}
 clear(){this.pixels.fill(0);this.lastEmission=-Infinity;this.dirty=true;}
 activeCells(){let count=0;for(let i=0;i<this.cellCount;i++){const p=i*4;if(this.time-this.pixels[p+3]<SUPPLY_PULSE_LIFE&&this.pixels[p]>0)count++;}return count;}
}

/** The fan center carries 1 and the two outer corners 0. Interpolation outlines
 * only polygon boundaries, never the triangle spokes inside each hex/pentagon. */
export function supplyPulseCoordinates(owners:Uint32Array|Int32Array|number[],pulse:SupplyPulse,water=false){
 const perFace=water?6:3,coordinates=new Float32Array(owners.length*perFace*3);
 for(let face=0;face<owners.length;face++){
  const owner=owners[face],u=(owner%pulse.width+.5)/pulse.width,v=(Math.floor(owner/pulse.width)+.5)/pulse.height;
  for(let k=0;k<perFace;k++){const p=(face*perFace+k)*3;coordinates[p]=u;coordinates[p+1]=v;coordinates[p+2]=k===0?1:0;}
 }
 return coordinates;
}
