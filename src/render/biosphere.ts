import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Matrix,Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {createSphere,type SphereGrid} from '../sim/sphere';
import {vegetationCover,woodlandDensity} from './vegetation';
import {F,STRIDE} from '../sim/model';
import {LandAnimals} from './animals';
export class Biosphere {
 private trees:Mesh;
 private shadows:Mesh;
 private shadowMatrices:Float32Array;
 private patches:number[][];
 private treeMatrices:Float32Array;
 private animals:LandAnimals;
 constructor(scene:Scene,root:TransformNode,private grid:SphereGrid){
  const trunk=MeshBuilder.CreateCylinder('tree trunk',{height:.53,diameterTop:.065,diameterBottom:.13,tessellation:7},scene);trunk.position.y=.265;
  const parts:Mesh[]=[trunk];
  for(const [x,z] of [[-.24,.04],[.23,-.08]]){
   const from=new Vector3(0,.32,0),to=new Vector3(x,.66,z),delta=to.subtract(from);
   const branch=MeshBuilder.CreateCylinder('spreading branch',{height:delta.length(),diameterTop:.035,diameterBottom:.065,tessellation:6},scene);
   branch.position=from.add(to).scale(.5);branch.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Up(),delta.normalize(),new Quaternion());parts.push(branch);
  }
  // Broad, bevelled leaf masses with a flat summit. Their perimeter varies,
  // but no ring narrows into a leader, cone or repeated needle-like peak.
  for(let crown=0;crown<2;crown++){
   const positions:number[]=[],indices:number[]=[],sides=9;
   const rings=[[.25,-.18],[.51,-.07],[.49,.11],[.26,.23]];
   for(let ring=0;ring<rings.length;ring++)for(let j=0;j<sides;j++){
    const angle=j/sides*Math.PI*2,variation=1+.09*Math.sin(j*2.4+crown*1.7)+.06*Math.cos(j*1.3);
    const [radius,height]=rings[ring];positions.push(Math.cos(angle)*radius*variation,height+.025*Math.sin(j*1.8+crown),Math.sin(angle)*radius*variation*.86);
   }
   for(let ring=0;ring<rings.length-1;ring++)for(let j=0;j<sides;j++){
    const a=ring*sides+j,b=ring*sides+(j+1)%sides,c=b+sides,d=a+sides;indices.push(a,b,c,a,c,d);
   }
   positions.push(0,rings[0][1],0,0,rings[3][1],0);
   for(let j=0;j<sides;j++){const next=(j+1)%sides;indices.push(36,next,j,37,27+j,27+next);}
   const mesh=new Mesh('broad leaf crown',scene),data=new VertexData();data.positions=positions;data.indices=indices;data.normals=[];VertexData.ComputeNormals(positions,indices,data.normals);data.uvs=new Float32Array(positions.length/3*2);data.applyToMesh(mesh);mesh.convertToFlatShadedMesh();
   mesh.position.set(crown===0?-.13:.28,crown===0?.66:.72,crown===0?0:.07);mesh.scaling.setAll(crown===0?1:.73);mesh.rotation.y=crown*.8;parts.push(mesh);
  }
  parts.forEach((part,i)=>{
   const colors=new Float32Array(part.getTotalVertices()*4),positions=part.getVerticesData(VertexBuffer.PositionKind)!;
   for(let j=0;j<colors.length/4;j++){const h=positions[j*3+1],shade=.88+h*.13;const rgb=i<3?[.29,.19,.10]:i===3?[.37,.51,.20]:[.43,.56,.24];colors.set([rgb[0]*shade,rgb[1]*shade,rgb[2]*shade,1],j*4);}
   part.setVerticesData(VertexBuffer.ColorKind,colors);part.useVertexColors=true;
  });
  this.trees=Mesh.MergeMeshes(parts,true)!;this.trees.name='branching grove';this.trees.parent=root;this.trees.isPickable=false;this.trees.alwaysSelectAsActiveMesh=true;this.trees.useVertexColors=true;
  const leaves=new StandardMaterial('matte tree canopy',scene,true);leaves.diffuseColor=Color3.White();leaves.specularColor=Color3.Black();this.trees.material=leaves;
  const regions=createSphere(1);this.patches=Array.from({length:regions.count},()=>[]);
  for(let i=0;i<grid.count;i++){let best=0,dot=-2;for(let j=0;j<regions.count;j++){let d=0;for(let k=0;k<3;k++)d+=grid.directions[i*3+k]*regions.directions[j*3+k];if(d>dot){dot=d;best=j;}}this.patches[best].push(i);}
  this.treeMatrices=new Float32Array(Math.max(grid.count,42*28)*16);this.trees.thinInstanceSetBuffer('matrix',this.treeMatrices,16,false);this.trees.thinInstanceCount=0;this.trees.setEnabled(false);
  this.shadows=MeshBuilder.CreateDisc('forest contact shade',{radius:1,tessellation:16},scene);this.shadows.parent=root;this.shadows.isPickable=false;this.shadows.alwaysSelectAsActiveMesh=true;
  const shade=new StandardMaterial('soft forest shade',scene,true);shade.disableLighting=true;shade.emissiveColor=new Color3(.06,.10,.05);shade.alpha=.30;shade.backFaceCulling=false;this.shadows.material=shade;
  const positions=this.shadows.getVerticesData(VertexBuffer.PositionKind)!,colors=new Float32Array(this.shadows.getTotalVertices()*4);
  for(let i=0;i<positions.length/3;i++)colors.set([1,1,1,Math.max(0,1-Math.hypot(positions[i*3],positions[i*3+1]))],i*4);
  this.shadows.setVerticesData(VertexBuffer.ColorKind,colors);this.shadows.useVertexColors=true;this.shadows.hasVertexAlpha=true;
  this.shadowMatrices=new Float32Array(this.treeMatrices.length);this.shadows.thinInstanceSetBuffer('matrix',this.shadowMatrices,16,false);this.shadows.thinInstanceCount=0;this.shadows.setEnabled(false);
  this.animals=new LandAnimals(scene,root,grid);
 }
 update(state:Float32Array,radii:Float32Array,time:number,cover:Float32Array=vegetationCover(this.grid,state),treesDirty=true){
  if(treesDirty){
  let treeCount=0;
  for(let patch=0;patch<this.patches.length;patch++){
   const cells=this.patches[patch],land=cells.filter(i=>{const p=i*STRIDE;return woodlandDensity(cover[i])>0&&state[p+F.plant]>.045&&state[p+F.water]<=Math.max(.3,Math.min(1.2,state[p+F.soil]*.12)+.15)&&state[p+F.ice]<.15;});
   if(!land.length)continue;
   const biomass=land.reduce((sum,i)=>sum+state[i*STRIDE+F.plant],0);
   const count=Math.min(28,Math.max(1,Math.ceil(Math.sqrt(biomass)*3.3)));
   const groups=Math.min(6,Math.max(1,Math.ceil(land.length/12)));
   for(let k=0;k<count;k++){
    const group=k%groups,anchor=(patch*17+group*23)%land.length,i=land[(anchor+Math.floor(k/groups)*3)%land.length],mass=state[i*STRIDE+F.plant];
    let hash=Math.imul((patch+1)*97+k*37,374761393);hash=Math.imul(hash^(hash>>>13),1274126177);const seed=((hash^(hash>>>16))>>>0)/4294967295;
    const density=woodlandDensity(cover[i]);if(seed>density)continue;
    const normal=Vector3.FromArray(this.grid.directions,i*3),tangent=Vector3.Cross(normal,Math.abs(normal.y)>.9?Vector3.Right():Vector3.Up()).normalize(),side=Vector3.Cross(normal,tangent);
    const size=(.20+Math.min(.10,Math.sqrt(mass)*.08))*(.75+seed*.55)*(.65+.35*density);
    const q=Quaternion.FromUnitVectorsToRef(Vector3.Up(),normal,new Quaternion()).multiply(Quaternion.RotationAxis(Vector3.Up(),seed*6.283));
    const position=normal.scale(radii[i]-.025).add(tangent.scale(Math.sin(k*2.399)*.07)).add(side.scale(Math.cos(k*2.399)*.07));
    Matrix.ComposeToRef(new Vector3(size*(1.08+seed*.22),size*(.88+seed*.18),size*1.05),q,position,Matrix.Identity()).copyToArray(this.treeMatrices,treeCount*16);
    const shadowQ=Quaternion.FromUnitVectorsToRef(Vector3.Forward(),normal,new Quaternion());
    Matrix.ComposeToRef(new Vector3(size*.9,size*.68,1),shadowQ,normal.scale(radii[i]+.012),Matrix.Identity()).copyToArray(this.shadowMatrices,treeCount++*16);
   }
  }
  this.shadows.thinInstanceCount=treeCount;this.shadows.setEnabled(treeCount>0);if(treeCount)this.shadows.thinInstanceBufferUpdated('matrix');

  this.trees.thinInstanceCount=treeCount;this.trees.setEnabled(treeCount>0);if(treeCount)this.trees.thinInstanceBufferUpdated('matrix');
  }
  this.animals.update(state,radii);
 }
 animate(dt:number,speed=1){this.animals.animate(dt,speed);}
 feed(cells:Float32Array,dt:number){this.animals.feed(cells,dt);}
 animalStats(){return this.animals.stats();}
}
