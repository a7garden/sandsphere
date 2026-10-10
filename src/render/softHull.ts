import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import type {Scene} from '@babylonjs/core/scene';
import {createSphere} from '../sim/sphere';

export type Lobe=readonly [number,number,number,number,number,number];
/** A single watertight silhouette, not intersecting balls. Broad overlapping
 * ellipsoids are blended before meshing; no small-scale noise or cavity texture. */
export function softHull(name:string,lobes:readonly Lobe[],scene:Scene,faceting=.25,subdivisions=3){
 const grid=createSphere(subdivisions),positions=new Float32Array(grid.count*3),normals=new Float32Array(grid.count*3);
 const field=(x:number,y:number,z:number)=>{
  let d=10;
  for(const [cx,cy,cz,rx,ry,rz] of lobes){
   const b=(Math.hypot((x-cx)/rx,(y-cy)/ry,(z-cz)/rz)-1)*Math.min(rx,ry,rz),k=.18;
   const h=Math.max(0,k-Math.abs(d-b))/k;d=Math.min(d,b)-h*h*k*.25;
  }
  return d;
 };
 for(let i=0;i<grid.count;i++){
  const x=grid.directions[i*3],y=grid.directions[i*3+1],z=grid.directions[i*3+2];let lo=0,hi=3;
  for(let k=0;k<18;k++){const r=(lo+hi)*.5;if(field(x*r,y*r,z*r)<0)lo=r;else hi=r;}
  positions.set([x*lo,y*lo,z*lo],i*3);
 }
 VertexData.ComputeNormals(positions,grid.indices,normals);
 const p:number[]=[],n:number[]=[],indices:number[]=[];
 for(let i=0;i<grid.indices.length;i+=3){
  const face=[grid.indices[i],grid.indices[i+1],grid.indices[i+2]],mean=[0,0,0];
  const a=face[0]*3,b=face[1]*3,c=face[2]*3;
  const ux=positions[b]-positions[a],uy=positions[b+1]-positions[a+1],uz=positions[b+2]-positions[a+2],vx=positions[c]-positions[a],vy=positions[c+1]-positions[a+1],vz=positions[c+2]-positions[a+2];
  mean[0]=uz*vy-uy*vz;mean[1]=ux*vz-uz*vx;mean[2]=uy*vx-ux*vy;const length=Math.hypot(...mean);for(let k=0;k<3;k++)mean[k]/=length;
  for(const v of face){for(let k=0;k<3;k++){p.push(positions[v*3+k]);n.push(normals[v*3+k]*(1-faceting)+mean[k]*faceting);}indices.push(indices.length);}
 }
 const mesh=new Mesh(name,scene),data=new VertexData();data.positions=p;data.normals=n;data.indices=indices;data.uvs=new Float32Array(p.length/3*2);data.applyToMesh(mesh);return mesh;
}
