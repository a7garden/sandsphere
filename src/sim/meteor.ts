import {F,STRIDE,capacity,totalEnthalpy} from './model';
import type {SphereGrid} from './sphere';

/** Redistribute excavated solid stock into a raised rim, then add the incoming
 * iron body and its heat. No crater mass is deleted or invented. */
export function impactMeteor(state:Float32Array,grid:SphereGrid,direction:readonly number[],mass=36,energyChanges?:Float64Array){
 const result=new Float32Array(state),rim:number[]=[],weights:number[]=[],pool=new Float64Array(STRIDE);
 const fields=[F.sand,F.clay,F.ceramic,F.glass,F.salt,F.rock,F.soil,F.iron,F.ice,F.molten];
 let weightTotal=0,carriedHeat=0,carriedDose=0;
 for(let i=0;i<grid.count;i++){
  const angle=Math.acos(Math.max(-1,Math.min(1,grid.directions[i*3]*direction[0]+grid.directions[i*3+1]*direction[1]+grid.directions[i*3+2]*direction[2])));
  if(angle<.18){const beforeCapacity=capacity(result,i);const fraction=.56*(1-angle/.18);for(const f of fields){const before=result[i*STRIDE+f];result[i*STRIDE+f]*=1-fraction;const removed=before-result[i*STRIDE+f];pool[f]+=removed;if(f===F.clay)carriedDose+=removed*result[i*STRIDE+F.firing];}carriedHeat+=(beforeCapacity-capacity(result,i))*result[i*STRIDE+F.temperature];if(result[i*STRIDE+F.clay]<1e-8)result[i*STRIDE+F.firing]=0;}
  if(angle>=.18&&angle<.3){const w=Math.sin((angle-.18)/.12*Math.PI);rim.push(i);weights.push(w);weightTotal+=w;}
 }
 if(!rim.length){rim.push(0);weights.push(1);weightTotal=1;}
 for(let n=0;n<rim.length;n++){
  const i=rim[n],p=i*STRIDE,w=weights[n]/weightTotal,energy=capacity(result,i)*result[p+F.temperature];
  const dose=result[p+F.clay]*result[p+F.firing]+carriedDose*w;
  for(const f of fields)result[p+f]+=pool[f]*w;
  result[p+F.firing]=result[p+F.clay]>1e-8?dose/result[p+F.clay]:0;
  result[p+F.temperature]=(energy+carriedHeat*w)/capacity(result,i);
 }
 const hit:number[]=[],share:number[]=[];let sum=0;
 for(let i=0;i<grid.count;i++){
  const dot=grid.directions[i*3]*direction[0]+grid.directions[i*3+1]*direction[1]+grid.directions[i*3+2]*direction[2];
  const w=Math.max(0,(dot-Math.cos(.2))/(1-Math.cos(.2)));if(w>0){hit.push(i);share.push(w*w);sum+=w*w;}
 }
 for(let n=0;n<hit.length;n++){
  const i=hit[n],amount=mass*share[n]/sum,p=i*STRIDE;
  const energy=capacity(result,i)*result[p+F.temperature]+amount*1800;
  result[p+F.iron]+=amount;result[p+F.temperature]=Math.min(2500,energy/capacity(result,i));
 }
 // Impact energy is an external source. The residual includes the temperature
 // safety clamp and Float32 redistribution roundoff, rather than hiding either.
 if(energyChanges){energyChanges[1]+=mass*1800;energyChanges[3]+=totalEnthalpy(result)-totalEnthalpy(state)-mass*1800;}
 return result;
}
