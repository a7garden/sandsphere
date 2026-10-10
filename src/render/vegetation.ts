import {F,STRIDE} from '../sim/model';
import type {SphereGrid} from '../sim/sphere';

/** Render-only ground cover. Neighborhood support shapes the coverage contour while
 * zero biomass remains bare; neither this field nor tree decoration adds mass. */
export function vegetationCover(grid:SphereGrid,state:Float32Array){
 const raw=new Float32Array(grid.count),cover=new Float32Array(grid.count);
 for(let i=0;i<grid.count;i++){
  const p=i*STRIDE,freeWater=Math.max(0,state[p+F.water]-Math.min(1.2,state[p+F.soil]*.12));
  const dry=Math.max(0,1-freeWater/.30)*Math.max(0,1-state[p+F.ice]/.15);
  raw[i]=(1-Math.exp(-Math.max(0,state[p+F.plant])*1.25))*dry;
 }
 for(let i=0;i<grid.count;i++){
  if(raw[i]===0)continue;
  let sum=0,count=0;
  for(let k=0;k<6;k++){const j=grid.neighbors[i*6+k];if(j<grid.count){sum+=raw[j];count++;}}
  const neighborhood=sum/Math.max(1,count);
  cover[i]=Math.min(raw[i],raw[i]*.50+neighborhood*.50);
 }
 return cover;
}

/** Trees start inside the grass contour instead of occupying its bare edge. */
export function woodlandDensity(cover:number){
 const t=Math.max(0,Math.min(1,(cover-.35)/.40));return t*t*(3-2*t);
}
