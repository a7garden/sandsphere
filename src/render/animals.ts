import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Matrix,Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {AnimalNavigation,animalLand} from '../sim/animalNavigation';
import {F,STRIDE} from '../sim/model';
import {INVALID,NEIGHBORS,type SphereGrid} from '../sim/sphere';

const LIMIT=256;
interface Walker {owner:number;cell:number;target:number;progress:number;seed:number;steps:number;rest:number;}
/** Bounded representatives of the saved biomass guilds, not individual stock. */
export class LandAnimals {
 private bodies:Mesh[]=[];
 private legs:Mesh[]=[];
 private matrices=[new Float32Array(LIMIT*16),new Float32Array(LIMIT*16)];
 private legMatrices=[new Float32Array(LIMIT*4*16),new Float32Array(LIMIT*4*16)];
 private walkers:[Map<number,Walker>,Map<number,Walker>]=[new Map(),new Map()];
 private order:number[];
 private navigation:AnimalNavigation;
 private planAge=Infinity;
 private walkSpeed=1;
 private state:Float32Array;
 private radii:Float32Array;
 private normal=new Vector3();private destination=new Vector3();private forward=new Vector3();private side=new Vector3();private position=new Vector3();private legPosition=new Vector3();private scale=new Vector3();private rotation=new Quaternion();private matrix=Matrix.Identity();
 constructor(scene:Scene,root:TransformNode,private grid:SphereGrid){
  this.navigation=new AnimalNavigation(grid);this.state=new Float32Array(grid.count*STRIDE);this.radii=new Float32Array(grid.count);
  const hash=(i:number)=>(Math.imul(i+1,16807)>>>0)%997;
  this.order=Array.from({length:grid.count},(_,i)=>i).sort((a,b)=>hash(a)-hash(b)||a-b);
  for(let kind=0;kind<2;kind++){
   const parts:Mesh[]=[];
   const part=(name:string,size:[number,number,number],position:[number,number,number])=>{const m=MeshBuilder.CreateSphere(name,{diameter:1,segments:6},scene);m.scaling.set(...size);m.position.set(...position);parts.push(m);return m;};
   part('animal body',[.95,.5,1.35],[0,.46,0]);part('animal head',[.55,.5,.6],[0,.7,.64]);part('animal muzzle',[.36,.23,.34],[0,.59,.94]);
   for(const x of [-.23,.23])part('animal ears',[.15,kind===0?.23:.36,.17],[x,.98,.67]);
   const tail=part('animal tail',[.18,.18,kind===0?.3:.65],[0,.58,kind===0?-.72:-.89]);tail.rotation.x=kind===0?-.7:-.35;
   const body=Mesh.MergeMeshes(parts,true)!;body.name=kind===0?'grazing populations':'predator populations';
   const material=new StandardMaterial('land animal '+kind,scene,true);material.diffuseColor=kind===0?new Color3(.80,.69,.48):new Color3(.47,.28,.17);material.specularColor=Color3.Black();body.material=material;
   const leg=MeshBuilder.CreateBox('walking legs '+kind,{width:.13,height:.34,depth:.14},scene);leg.material=material;
   for(const mesh of [body,leg]){mesh.parent=root;mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;mesh.doNotSyncBoundingInfo=true;mesh.thinInstanceCount=0;mesh.setEnabled(false);}
   body.thinInstanceSetBuffer('matrix',this.matrices[kind],16,false);leg.thinInstanceSetBuffer('matrix',this.legMatrices[kind],16,false);this.bodies.push(body);this.legs.push(leg);
  }
 }
 update(state:Float32Array,radii:Float32Array){
  this.state=state;this.radii=radii;
  // Remove erased/extinct populations immediately; preserve surviving paths.
  for(let kind=0;kind<2;kind++){
   const field=kind===0?F.herbivore:F.carnivore,map=this.walkers[kind];
   for(const [owner,w] of map)if(state[owner*STRIDE+field]<.025||!this.onLand(owner)||!this.onLand(w.cell)||!this.onLand(w.target))map.delete(owner);
   for(const owner of this.order){if(map.size>=LIMIT)break;if(map.has(owner)||state[owner*STRIDE+field]<.025||!this.onLand(owner))continue;map.set(owner,{owner,cell:owner,target:owner,progress:0,seed:(Math.imul(owner+1+kind*127,16807)>>>0)%997/997,steps:0,rest:0});}
  }
  this.animate(0,this.walkSpeed);
 }
 private onLand(cell:number){const p=cell*STRIDE;return animalLand(this.state[p+F.water],this.state[p+F.soil],this.state[p+F.molten]);}
 private target(w:Walker,kind:number){
  const route=this.navigation.next[kind][w.cell];if(route>=0&&this.onLand(route))return route;
  // On pasture / at prey, mix short rests with a deterministic local wander.
  let target=w.cell,best=-Infinity;
  for(let k=0;k<NEIGHBORS;k++){
   const j=this.grid.neighbors[w.cell*NEIGHBORS+k];if(j===INVALID||!this.onLand(j))continue;
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
  if(this.planAge>=.6&&(this.walkers[0].size||this.walkers[1].size)){this.navigation.plan(this.state);this.planAge=0;}
  for(let kind=0;kind<2;kind++){
   let count=0;
   for(const w of this.walkers[kind].values()){
    if(elapsed>0){
     w.rest=Math.max(0,w.rest-elapsed);
     if(w.cell===w.target&&w.rest===0){w.target=this.target(w,kind);w.progress=0;}
     if(w.target!==w.cell){
      const a=w.cell*3,b=w.target*3,chord=Math.hypot(this.grid.directions[a]-this.grid.directions[b],this.grid.directions[a+1]-this.grid.directions[b+1],this.grid.directions[a+2]-this.grid.directions[b+2]);
      const travel=chord*Math.max(1,this.radii[w.cell]);w.progress=Math.min(1,w.progress+elapsed*(kind===0?.085:.13)/Math.max(.01,travel));
      if(w.progress>=1){w.cell=w.target;w.progress=0;w.steps++;w.rest=(kind===0?.5:.2)+w.seed*.6;}
     }
    }
    const a=w.cell*3,b=w.target*3,t=w.progress;
    this.normal.set(this.grid.directions[a]*(1-t)+this.grid.directions[b]*t,this.grid.directions[a+1]*(1-t)+this.grid.directions[b+1]*t,this.grid.directions[a+2]*(1-t)+this.grid.directions[b+2]*t).normalize();
    this.destination.set(this.grid.directions[b],this.grid.directions[b+1],this.grid.directions[b+2]);this.forward.copyFrom(this.destination).subtractInPlace(this.normal);const dot=Vector3.Dot(this.forward,this.normal);this.forward.set(this.forward.x-this.normal.x*dot,this.forward.y-this.normal.y*dot,this.forward.z-this.normal.z*dot);
    if(this.forward.lengthSquared()<1e-8)Vector3.CrossToRef(this.normal,Math.abs(this.normal.y)>.9?Vector3.RightReadOnly:Vector3.UpReadOnly,this.forward);this.forward.normalize();Vector3.CrossToRef(this.normal,this.forward,this.side);this.side.normalize();
    Quaternion.FromLookDirectionLHToRef(this.forward,this.normal,this.rotation);
    const mass=this.state[w.owner*STRIDE+(kind===0?F.herbivore:F.carnivore)],size=Math.min(.17,.065+Math.sqrt(mass)*.055),walking=w.cell!==w.target&&this.walkSpeed>0;
    const gait=(w.steps+t)*Math.PI*6+w.seed*6.28,bob=walking?Math.abs(Math.sin(gait))*.012:0,radius=this.radii[w.cell]*(1-t)+this.radii[w.target]*t;
    this.position.copyFrom(this.normal).scaleInPlace(radius+size*.02+bob);this.scale.setAll(size);Matrix.ComposeToRef(this.scale,this.rotation,this.position,this.matrix);this.matrix.copyToArray(this.matrices[kind],count*16);
    for(let foot=0;foot<4;foot++){
     const side=foot%2===0?-1:1,front=foot<2?1:-1,stride=walking?Math.sin(gait+(side*front>0?0:Math.PI))*.19:0;
     const sx=side*.3*size,fz=(front*.43+stride)*size,up=.19*size;
     this.legPosition.set(this.position.x+this.side.x*sx+this.forward.x*fz+this.normal.x*up,this.position.y+this.side.y*sx+this.forward.y*fz+this.normal.y*up,this.position.z+this.side.z*sx+this.forward.z*fz+this.normal.z*up);
     this.scale.setAll(size);Matrix.ComposeToRef(this.scale,this.rotation,this.legPosition,this.matrix);this.matrix.copyToArray(this.legMatrices[kind],(count*4+foot)*16);
    }
    count++;
   }
   this.bodies[kind].thinInstanceCount=count;this.legs[kind].thinInstanceCount=count*4;
   for(const mesh of [this.bodies[kind],this.legs[kind]]){mesh.setEnabled(count>0);if(count)mesh.thinInstanceBufferUpdated('matrix');}
  }
 }
}
