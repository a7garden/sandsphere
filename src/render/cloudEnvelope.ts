import {CLOUD_DISPLAY_SCALE} from '../sim/layeredAtmosphere';
import {F,STRIDE} from '../sim/model';
import {INVALID,NEIGHBORS,type SphereGrid} from '../sim/sphere';

/** A presentation-only field. Symmetric edge diffusion softens cell-scale
 * steps without changing the solver or losing the liquid/ice mass contrast. */
export class CloudEnvelopeField {
 private data:Float32Array;
 private scratch:Float32Array;
 constructor(private grid:SphereGrid){this.data=new Float32Array(grid.count*4);this.scratch=new Float32Array(this.data.length);}
 sample(state:Float32Array,radii:Float32Array,physical=false){
  const scale=physical?CLOUD_DISPLAY_SCALE:1;
  for(let i=0;i<this.grid.count;i++){
   const p=i*STRIDE,q=i*4,liquid=Math.max(0,state[p+F.cloud]),ice=Math.max(0,state[p+F.cloudIce]);
   this.data.set([liquid*scale,ice*scale,radii[i],(liquid+ice)*scale],q);
  }
  for(let pass=0;pass<2;pass++){
   for(let i=0;i<this.grid.count;i++)for(let f=0;f<3;f++){
    const value=this.data[i*4+f];let delta=0;
    for(let k=0;k<NEIGHBORS;k++){const j=this.grid.neighbors[i*NEIGHBORS+k];if(j!==INVALID)delta+=(this.data[j*4+f]-value)*.075;}
    this.scratch[i*4+f]=value+delta;
   }
   for(let i=0;i<this.grid.count;i++)for(let f=0;f<3;f++)this.data[i*4+f]=this.scratch[i*4+f];
  }
  // Clear the local terrain while keeping broad cloud bases free of cell steps.
  for(let i=0;i<this.grid.count;i++)this.data[i*4+2]=Math.max(radii[i],this.data[i*4+2]);
  return this.data;
 }
}

/** Connected components are measured on the same field drawn by the renderer. */
export function cloudComponents(grid:SphereGrid,field:Float32Array){
 const seen=new Uint8Array(grid.count),stack:number[]=[];let count=0,cells=0;
 for(let i=0;i<grid.count;i++){
  if(seen[i]||field[i*4]+field[i*4+1]<.012)continue;
  count++;seen[i]=1;stack.push(i);
  while(stack.length){const cell=stack.pop()!;cells++;
   for(let k=0;k<NEIGHBORS;k++){const j=grid.neighbors[cell*NEIGHBORS+k];if(j!==INVALID&&!seen[j]&&field[j*4]+field[j*4+1]>=.012){seen[j]=1;stack.push(j);}}
  }
 }
 return {count,cells};
}
