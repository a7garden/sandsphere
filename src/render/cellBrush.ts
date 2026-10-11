import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {nearestCell,type SphereGrid} from '../sim/sphere';
import type {dualSurface} from './surface';
import {sectionShader} from './sectionClip';

/** Highlights the actual dual-cell fans, with no internal triangle spokes. */
export class CellBrush {
 private mesh:Mesh;
 private selected=new Set<number>();
 private owners:Uint32Array;
 private corners=new Map<number,number[]>();
 private material;
 constructor(scene:Scene,root:TransformNode,grid:SphereGrid,surface:ReturnType<typeof dualSurface>,name='cell brush footprint',group=2){
  this.owners=Uint32Array.from(surface.owners,i=>nearestCell(grid,surface.directions[i*3],surface.directions[i*3+1],surface.directions[i*3+2]));
  const seen=new Map<number,Set<number>>();
  for(let t=0;t<this.owners.length;t++){const owner=this.owners[t],vertices=seen.get(owner)??new Set<number>(),offsets=this.corners.get(owner)??[];
   for(const k of [1,2]){const vertex=surface.indices[t*3+k];if(!vertices.has(vertex)){vertices.add(vertex);offsets.push(t*9+k*3);}}
   seen.set(owner,vertices);this.corners.set(owner,offsets);
  }
  this.mesh=new Mesh(name,scene);this.mesh.parent=root;this.mesh.isPickable=false;this.mesh.alwaysSelectAsActiveMesh=true;this.mesh.renderingGroupId=group;
  this.material=sectionShader(scene,'cell brush',{vertexSource:`precision highp float;
attribute vec3 position;attribute float edgeDistance;uniform mat4 world;uniform mat4 viewProjection;varying float edge;
void main(){edge=edgeDistance;gl_Position=viewProjection*world*vec4(position,1.0);}`,fragmentSource:`precision highp float;
varying float edge;uniform vec3 brushColor;
void main(){float line=1.0-smoothstep(0.0,fwidth(edge)*1.4,edge);gl_FragColor=vec4(brushColor,.13+line*.72);}`},{attributes:['position','edgeDistance'],uniforms:['world','viewProjection','brushColor'],needAlphaBlending:true});
  this.material.disableDepthWrite=true;this.material.backFaceCulling=true;this.material.setVector3('brushColor',new Vector3(1,.84,.46));this.mesh.material=this.material;this.mesh.setEnabled(false);
 }
 select(cells:readonly number[],positions:Float32Array,kind:string){
  this.material.setVector3('brushColor',kind==='heat'?new Vector3(1,.45,.15):kind==='cool'?new Vector3(.4,.85,1):new Vector3(1,.84,.46));
  if(cells.length===this.selected.size&&cells.every(i=>this.selected.has(i)))return;
  this.selected=new Set(cells);this.update(positions);
 }
 boundaryPoints(cell:number,positions:Float32Array){return (this.corners.get(cell)??[]).map(offset=>Vector3.FromArray(positions,offset).scale(1.001));}
 update(positions:Float32Array){
  if(!this.selected.size){this.mesh.setEnabled(false);return;}
  const points:number[]=[],edges:number[]=[];
  for(let t=0;t<this.owners.length;t++)if(this.selected.has(this.owners[t])){
   for(let k=0;k<9;k++)points.push(positions[t*9+k]*1.001);
   edges.push(1,0,0);
  }
  const data=new VertexData();data.positions=points;data.indices=Array.from({length:points.length/3},(_,i)=>i);data.applyToMesh(this.mesh,true);
  this.mesh.setVerticesData('edgeDistance',edges,true,1);this.mesh.setEnabled(points.length>0);
 }
}
