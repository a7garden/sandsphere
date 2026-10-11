import {createSphere,type SphereGrid} from '../sim/sphere';
import {F,STRIDE} from '../sim/model';

export interface CloudRegion {
 id:number;cells:number;mass:number;ice:number;coverage:number;density:number;
 direction:[number,number,number];ground:number;
}
/** Fixed regions keep identities stable. Cover controls footprint and cloudy
 * column density controls optical depth, preserving isolated local clouds. */
export class CloudRegionField {
 private regions:SphereGrid;
 private bins:number[][];
 get count(){return this.regions.count;}
 constructor(private grid:SphereGrid,subdivisions=2){
  this.regions=createSphere(subdivisions);this.bins=Array.from({length:this.regions.count},()=>[]);
  for(let i=0;i<grid.count;i++){
   let best=0,dot=-2;
   for(let j=0;j<this.regions.count;j++){
    let d=0;for(let k=0;k<3;k++)d+=grid.directions[i*3+k]*this.regions.directions[j*3+k];
    if(d>dot){dot=d;best=j;}
   }
   this.bins[best].push(i);
  }
 }
 sample(state:Float32Array,radii:Float32Array):CloudRegion[]{
  return this.bins.map((cells,id)=>{
   let mass=0,ice=0,cover=0,ground=0,clearGround=0;const direction:[number,number,number]=[0,0,0];
   for(const i of cells){
    const liquid=Math.max(0,state[i*STRIDE+F.cloud]),frozen=Math.max(0,state[i*STRIDE+F.cloudIce]),m=liquid+frozen;
    mass+=m;ice+=frozen;cover+=1-Math.exp(-m*6);ground+=radii[i]*m;clearGround+=radii[i];
    for(let k=0;k<3;k++)direction[k]+=this.grid.directions[i*3+k]*m;
   }
   const length=Math.hypot(...direction);
   for(let k=0;k<3;k++)direction[k]=length>1e-12?direction[k]/length:this.regions.directions[id*3+k];
   return {id,cells:cells.length,mass,ice,coverage:cover/Math.max(1,cells.length),density:mass/Math.max(1e-12,cover),direction,ground:mass>0?ground/mass:clearGround/Math.max(1,cells.length)};
  });
 }
}
