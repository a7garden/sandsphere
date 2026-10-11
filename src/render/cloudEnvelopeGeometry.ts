import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import type {SphereGrid} from '../sim/sphere';
import {refineSurface} from './surface';
import {CLOUD_PROFILES,type CloudProfile} from './cloudProfiles';

const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function hash(x:number,y:number,z:number){let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,2147483647);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;}
function noise(x:number,y:number,z:number){
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),u=smooth(0,1,x-ix),v=smooth(0,1,y-iy),w=smooth(0,1,z-iz);let value=0;
 for(let dx=0;dx<2;dx++)for(let dy=0;dy<2;dy++)for(let dz=0;dz<2;dz++)value+=hash(ix+dx,iy+dy,iz+dz)*(dx?u:1-u)*(dy?v:1-v)*(dz?w:1-w);
 return value;
}
/** Broad, shallow lobes within each bank, attached to planet coordinates.
 * This is display structure only: all coverage and relief are gated by stock. */
export function cloudLobe(x:number,y:number,z:number,p:CloudProfile=CLOUD_PROFILES.gentle){const f=p.frequency,d=p.detail;return Math.max(0,Math.min(1,noise(x*f+13,y*f*p.latitudeScale-7,z*f+3)*(1-d)+noise(x*f*2-2,y*f*2*p.latitudeScale+11,z*f*2+5)*d));}
export function cloudCoverage(mass:number,lobe:number,p:CloudProfile=CLOUD_PROFILES.gentle){const edge=p.edge+p.variation*(1-lobe);return smooth(Math.max(.002,edge-p.lower),edge+p.upper,mass);}
export function cloudRadius(ground:number,mass:number,x:number,y:number,z:number,layer:number,height:number,lobe=cloudLobe(x,y,z),p:CloudProfile=CLOUD_PROFILES.gentle){
 const cover=cloudCoverage(mass,lobe,p),relief=p.relief+(1-p.relief)*lobe;
 return ground+p.lift+layer*height*(p.base+p.gain*Math.sqrt(Math.min(1.5,mass*2)))*cover*relief;
}
export const CLOUD_RADIUS_GLSL=`
uniform vec4 cloudShape0;uniform vec4 cloudShape1;
float cloudCoverage(float mass,float lobe){float edge=cloudShape0.x+cloudShape0.y*(1.0-lobe);return smoothstep(max(.002,edge-cloudShape0.z),edge+cloudShape0.w,mass);}
float cloudRadius(float ground,float mass,float lobe,float layer,float height){
 float cover=cloudCoverage(mass,lobe),relief=mix(cloudShape1.w,1.0,lobe);
 return ground+cloudShape1.x+layer*height*(cloudShape1.y+cloudShape1.z*sqrt(min(1.5,mass*2.0)))*cover*relief;
}`;

/** One shared refinement removes coarse silhouettes without refining physics. */
export class CloudEnvelopeGeometry {
 readonly surface;
 readonly positions:Float32Array;
 readonly layers:Float32Array;
 readonly lobes:Float32Array;
 readonly indices:Uint32Array;
 private displaced:Float32Array;
 private profile=CLOUD_PROFILES.gentle;
 constructor(grid:SphereGrid){
  this.surface=refineSurface(grid,1);const s=this.surface;
  this.positions=new Float32Array(s.count*6);this.positions.set(s.directions);this.positions.set(s.directions,s.count*3);
  this.layers=new Float32Array(s.count*2);this.layers.fill(1,0,s.count);
  this.lobes=new Float32Array(s.count*2);this.fillLobes();
  this.indices=new Uint32Array(s.indices.length*2);this.indices.set(s.indices);
  for(let i=0;i<s.indices.length;i+=3)this.indices.set([s.indices[i]+s.count,s.indices[i+2]+s.count,s.indices[i+1]+s.count],s.indices.length+i);
  this.displaced=new Float32Array(this.positions.length);
 }
 private fillLobes(){const s=this.surface;for(let i=0;i<s.count;i++)this.lobes[i]=cloudLobe(s.directions[i*3],s.directions[i*3+1],s.directions[i*3+2],this.profile);this.lobes.set(this.lobes.subarray(0,s.count),s.count);}
 setProfile(profile:CloudProfile){if(this.profile===profile)return false;this.profile=profile;this.fillLobes();return true;}
 expand(field:Float32Array,target:Float32Array){
  const s=this.surface,original=field.length/4;target.set(field);
  for(let i=original;i<s.count;i++){const a=s.parents[i*2],b=s.parents[i*2+1];for(let f=0;f<4;f++)target[i*4+f]=(target[a*4+f]+target[b*4+f])*.5;}
  target.set(target.subarray(0,s.count*4),s.count*4);
 }
 normals(field:Float32Array,height:number,target:Float32Array){
  for(let i=0;i<this.layers.length;i++){
   const p=i*3,q=i*4,x=this.positions[p],y=this.positions[p+1],z=this.positions[p+2];
   const radius=cloudRadius(field[q+2],field[q]+field[q+1],x,y,z,this.layers[i],height,this.lobes[i],this.profile);
   this.displaced[p]=x*radius;this.displaced[p+1]=y*radius;this.displaced[p+2]=z*radius;
  }
  VertexData.ComputeNormals(this.displaced,this.indices,target);
 }
}
