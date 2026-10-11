import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Matrix,Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {AnimalNavigation,animalLand} from '../sim/animalNavigation';
import {consumerTravelHabitat} from '../sim/ecology';
import {F,STRIDE} from '../sim/model';
import {INVALID,NEIGHBORS,type SphereGrid} from '../sim/sphere';

const LIMIT=256;
interface Walker {owner:number;cell:number;target:number;progress:number;seed:number;steps:number;rest:number;heading:Vector3;feeding:number;phase:number;size:number;}
/** A single rounded seed and a low triangular wedge, both grounded at y=0. */
function token(scene:Scene,kind:number){
 const mesh=new Mesh(kind===0?'grazing populations':'predator populations',scene),data=new VertexData(),positions:number[]=[],indices:number[]=[];
 if(kind===0){
  const sides=10,rings=7;
  for(let ring=0;ring<=rings;ring++){
   const latitude=ring/rings*Math.PI,z=-Math.cos(latitude)*.68,width=Math.sin(latitude)*(.46-.08*z);
   for(let j=0;j<sides;j++){const angle=j/sides*Math.PI*2;positions.push(Math.cos(angle)*width,.24+Math.sin(angle)*Math.sin(latitude)*.24,z);}
  }
  for(let ring=0;ring<rings;ring++)for(let j=0;j<sides;j++){const a=ring*sides+j,b=ring*sides+(j+1)%sides,c=a+sides,d=b+sides;if(ring>0)indices.push(a,c,b);if(ring<rings-1)indices.push(b,c,d);}
 }else{
  positions.push(-.46,0,-.53,.46,0,-.53,0,0,.80,-.35,.38,-.44,.35,.38,-.44,0,.16,.62);
  indices.push(0,2,1,3,4,5,0,1,4,0,4,3,1,2,5,1,5,4,2,0,3,2,3,5);
 }
 data.positions=positions;data.indices=indices;data.normals=[];VertexData.ComputeNormals(positions,indices,data.normals);data.applyToMesh(mesh);
 return mesh;
}
/** Bounded representatives of the saved biomass guilds, not individual stock. */
export class LandAnimals {
 private bodies:Mesh[]=[];
 private matrices=[new Float32Array(LIMIT*16),new Float32Array(LIMIT*16)];
 private walkers:[Map<number,Walker>,Map<number,Walker>]=[new Map(),new Map()];
 private order:number[];
 private navigation:AnimalNavigation;
 private planAge=Infinity;
 private walkSpeed=1;
 private dirty=true;
 private state:Float32Array;
 private radii:Float32Array;
 private normal=new Vector3();private destination=new Vector3();private forward=new Vector3();private side=new Vector3();private position=new Vector3();private scale=new Vector3();private rotation=new Quaternion();private nodRotation=new Quaternion();private matrix=Matrix.Identity();
 constructor(scene:Scene,root:TransformNode,private grid:SphereGrid){
  this.navigation=new AnimalNavigation(grid);this.state=new Float32Array(grid.count*STRIDE);this.radii=new Float32Array(grid.count);
  const hash=(i:number)=>(Math.imul(i+1,16807)>>>0)%997;
  this.order=Array.from({length:grid.count},(_,i)=>i).sort((a,b)=>hash(a)-hash(b)||a-b);
  for(let kind=0;kind<2;kind++){
   const body=token(scene,kind);
   const material=new StandardMaterial('land animal '+kind,scene,true);material.diffuseColor=kind===0?new Color3(.94,.86,.65):new Color3(.88,.37,.28);material.specularColor=Color3.Black();body.material=material;
   body.parent=root;body.isPickable=false;body.alwaysSelectAsActiveMesh=true;body.doNotSyncBoundingInfo=true;body.thinInstanceCount=0;body.setEnabled(false);
   body.thinInstanceSetBuffer('matrix',this.matrices[kind],16,false);this.bodies.push(body);
  }
 }
 update(state:Float32Array,radii:Float32Array){
  this.state=state;this.radii=radii;this.dirty=true;
  // Remove erased/extinct populations immediately; preserve surviving paths.
  for(let kind=0;kind<2;kind++){
   const field=kind===0?F.herbivore:F.carnivore,map=this.walkers[kind];
   for(const [owner,w] of map)if(state[owner*STRIDE+field]<.025||!this.onLand(owner)||!this.onLand(w.cell)||!this.onLand(w.target))map.delete(owner);
   for(const owner of this.order){
    if(map.size>=LIMIT)break;if(map.has(owner)||state[owner*STRIDE+field]<.025||!this.onLand(owner))continue;
    const seed=(Math.imul(owner+1+kind*127,16807)>>>0)%997/997,normal=Vector3.FromArray(this.grid.directions,owner*3),heading=Vector3.Cross(normal,Math.abs(normal.y)>.9?Vector3.RightReadOnly:Vector3.UpReadOnly).normalize();
    map.set(owner,{owner,cell:owner,target:owner,progress:0,seed,steps:0,rest:seed*.5,heading,feeding:0,phase:seed*6.28,size:this.size(state[owner*STRIDE+field],kind)});
   }
  }
  this.animate(0,this.walkSpeed);
 }
 private onLand(cell:number){const p=cell*STRIDE;return animalLand(this.state[p+F.water],this.state[p+F.soil],this.state[p+F.molten]);}
 private size(mass:number,kind:number){return Math.min(.17,.065+Math.sqrt(Math.max(0,mass))*.055)*(kind===0?1:1.12);}
 /** Actual consumption from the last committed physical step, never visual attacks. */
 feed(cells:Float32Array,dt:number){
  if(dt<=0)return;
  for(let kind=0;kind<2;kind++)for(const w of this.walkers[kind].values()){
   const amount=cells[w.cell*2+kind];
   if(amount>0&&w.cell===w.target){w.feeding=Math.min(1,amount/(dt*.015));w.rest=Math.max(w.rest,.35);}
  }
 }
 stats(){return {representatives:this.walkers.map(map=>map.size),feeding:this.walkers.map(map=>[...map.values()].filter(w=>w.feeding>.01&&w.cell===w.target).length),meshes:2,bufferBytes:this.matrices.reduce((sum,a)=>sum+a.byteLength,0)};}
 private traversable(cell:number,kind:number){const p=cell*STRIDE;return this.onLand(cell)&&consumerTravelHabitat(this.state[p+F.temperature],this.state[p+F.water],this.state[p+F.dissolved],this.state[p+F.ice],kind===1)>0;}
 private target(w:Walker,kind:number){
  const route=this.navigation.next[kind][w.cell];if(route>=0&&this.traversable(route,kind))return route;
  // On pasture / at prey, mix short rests with a deterministic local wander.
  let target=w.cell,best=-Infinity;
  for(let k=0;k<NEIGHBORS;k++){
   const j=this.grid.neighbors[w.cell*NEIGHBORS+k];if(j===INVALID||!this.traversable(j,kind))continue;
   const p=j*STRIDE,food=this.state[p+(kind===0?F.plant:F.herbivore)],danger=kind===0?this.state[p+F.carnivore]*6:0;
   const variation=((Math.imul(j+1+w.steps*31+(kind+1)*97,16807)>>>0)%997)/997;
   const score=Math.min(2,food)-danger+variation*.5;
   if(score>best){best=score;target=j;}
  }
  return target;
 }
 animate(dt:number,speed=1){
  if(dt>0||speed===0)this.walkSpeed=speed;
  const elapsed=Math.max(0,Math.min(.05,dt))*Math.max(0,Math.min(4,speed));this.planAge+=elapsed;
  if(elapsed===0&&!this.dirty)return;
  if(elapsed>0&&this.planAge>=.6&&(this.walkers[0].size||this.walkers[1].size)){this.navigation.plan(this.state);this.planAge=0;}
  for(let kind=0;kind<2;kind++){
   let count=0;
   for(const w of this.walkers[kind].values()){
    if(elapsed>0){
     w.phase+=elapsed*5;w.feeding*=Math.exp(-elapsed*2.5);
     w.rest=Math.max(0,w.rest-elapsed);
     if(w.cell===w.target&&w.rest===0){w.target=this.target(w,kind);w.progress=0;}
     if(w.target!==w.cell){
      const a=w.cell*3,b=w.target*3,chord=Math.hypot(this.grid.directions[a]-this.grid.directions[b],this.grid.directions[a+1]-this.grid.directions[b+1],this.grid.directions[a+2]-this.grid.directions[b+2]);
      const travel=chord*Math.max(1,this.radii[w.cell]);
      this.normal.set(this.grid.directions[a],this.grid.directions[a+1],this.grid.directions[a+2]);this.forward.set(this.grid.directions[b],this.grid.directions[b+1],this.grid.directions[b+2]);const dot=Vector3.Dot(this.forward,this.normal);this.forward.subtractInPlace(this.normal.scaleToRef(dot,this.destination)).normalize();
      // Turn toward a newly selected edge before setting off; never slide backwards.
      if(w.progress>0||Vector3.Dot(w.heading,this.forward)>.75)w.progress=Math.min(1,w.progress+elapsed*(kind===0?.085:.13)/Math.max(.01,travel));
      if(w.progress>=1){w.cell=w.target;w.progress=0;w.steps++;w.rest=(kind===0?.5:this.navigation.next[1][w.cell]>=0?.08:.3)+w.seed*(kind===0?.6:.25);}
     }
    }
    const a=w.cell*3,b=w.target*3,t=w.progress*w.progress*(3-2*w.progress);
    this.normal.set(this.grid.directions[a]*(1-t)+this.grid.directions[b]*t,this.grid.directions[a+1]*(1-t)+this.grid.directions[b+1]*t,this.grid.directions[a+2]*(1-t)+this.grid.directions[b+2]*t).normalize();
    this.destination.set(this.grid.directions[b],this.grid.directions[b+1],this.grid.directions[b+2]);this.forward.copyFrom(this.destination).subtractInPlace(this.normal);const dot=Vector3.Dot(this.forward,this.normal);this.forward.set(this.forward.x-this.normal.x*dot,this.forward.y-this.normal.y*dot,this.forward.z-this.normal.z*dot);
    // Transport the last heading along the globe, including while resting.
    const tilt=Vector3.Dot(w.heading,this.normal);w.heading.set(w.heading.x-this.normal.x*tilt,w.heading.y-this.normal.y*tilt,w.heading.z-this.normal.z*tilt).normalize();
    if(this.forward.lengthSquared()>1e-8&&elapsed>0){
     this.forward.normalize();Vector3.CrossToRef(w.heading,this.forward,this.side);
     const angle=Math.atan2(Vector3.Dot(this.side,this.normal),Vector3.Dot(w.heading,this.forward)),turn=Math.max(-elapsed*3,Math.min(elapsed*3,angle));
     Vector3.CrossToRef(this.normal,w.heading,this.side);const c=Math.cos(turn),s=Math.sin(turn);w.heading.set(w.heading.x*c+this.side.x*s,w.heading.y*c+this.side.y*s,w.heading.z*c+this.side.z*s).normalize();
    }
    // The nose is local +Z; LookDirectionLH would point its -Z at the path.
    Vector3.CrossToRef(this.normal,w.heading,this.side);Matrix.FromXYZAxesToRef(this.side,this.normal,w.heading,this.matrix);Quaternion.FromRotationMatrixToRef(this.matrix,this.rotation);
    const feeding=w.cell===w.target?w.feeding:0;
    if(feeding>.001){Quaternion.RotationAxisToRef(this.side,Math.sin(w.phase)*.055*feeding,this.nodRotation);this.nodRotation.multiplyToRef(this.rotation,this.rotation);}
    const targetSize=this.size(this.state[w.owner*STRIDE+(kind===0?F.herbivore:F.carnivore)],kind);w.size+=(targetSize-w.size)*(this.walkSpeed===0?1:1-Math.exp(-elapsed*5));
    const size=w.size,radius=this.radii[w.cell]*(1-t)+this.radii[w.target]*t;
    this.position.copyFrom(this.normal).scaleInPlace(radius+size*(.025+feeding*.035));this.scale.set(size,size*(1-Math.max(0,Math.sin(w.phase))*.06*feeding),size);Matrix.ComposeToRef(this.scale,this.rotation,this.position,this.matrix);this.matrix.copyToArray(this.matrices[kind],count*16);
    count++;
   }
   const body=this.bodies[kind];body.thinInstanceCount=count;body.setEnabled(count>0);if(count)body.thinInstanceBufferUpdated('matrix');
  }
  this.dirty=false;
 }
}
