import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {Color4} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {LinesMesh} from '@babylonjs/core/Meshes/linesMesh';
import type {Scene} from '@babylonjs/core/scene';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';

interface Drop {position:Vector3;normal:Vector3;floor:number;speed:number;life:number;age:number;snow:boolean;}
const LIMIT=480;

/** Fine precipitation strokes. Water is transferred by the solver; these carry no mass. */
export class WeatherParticles {
  private mesh:LinesMesh;
  private drops:Drop[]=[];
  private positions=new Float32Array(LIMIT*6);
  private colors=new Float32Array(LIMIT*8);
  private black=true;
  private visible=true;
  constructor(scene:Scene,root:TransformNode) {
    this.mesh=MeshBuilder.CreateLineSystem('rain and snow strokes',{
      lines:Array.from({length:LIMIT},()=>[Vector3.Zero(),Vector3.Zero()]),
      colors:Array.from({length:LIMIT},()=>[new Color4(1,1,1,0),new Color4(1,1,1,0)]),updatable:true,useVertexAlpha:true,
    },scene);
    this.mesh.parent=root;this.mesh.isPickable=false;this.mesh.alwaysSelectAsActiveMesh=true;this.mesh.renderingGroupId=1;
    this.mesh.setEnabled(false);
  }
  emit(normal:Vector3,floor:number,amount:number,snow:boolean,gravity:number) {
    const expected=Math.min(2,amount*25),count=Math.floor(expected)+(Math.random()<expected%1?1:0);
    for(let n=0;n<count&&this.drops.length<LIMIT;n++) {
      const height=.3+Math.random()*.33;
      const speed=(snow?.38:2.4)*Math.sqrt(Math.max(.02,gravity));
      this.drops.push({normal:normal.clone(),position:normal.scale(floor+height),floor,speed,life:height/Math.max(.04,speed),age:0,snow});
    }
  }
  animate(dt:number) {
    this.positions.fill(0);this.colors.fill(0);
    for(let i=this.drops.length-1;i>=0;i--) {
      const d=this.drops[i];d.age+=dt;d.position.subtractInPlace(d.normal.scale(d.speed*dt));
      if(d.position.length()<=d.floor||d.age>d.life*1.25){this.drops.splice(i,1);continue;}
    }
    for(let i=0;i<this.drops.length;i++) {
      const d=this.drops[i],length=d.snow?.016:.025+Math.min(.035,d.speed*.01),tail=d.position.add(d.normal.scale(length));
      const fade=Math.min(1,d.age/.05)*Math.min(1,(d.life-d.age)/.06),alpha=(d.snow?.55:.38)*Math.max(0,fade);
      this.positions.set([tail.x,tail.y,tail.z,d.position.x,d.position.y,d.position.z],i*6);
      const color=this.black?[.62,.78,.85]:[.24,.37,.43];
      this.colors.set([...color,alpha*.08,...color,alpha],i*8);
    }
    this.mesh.updateVerticesData(VertexBuffer.PositionKind,this.positions);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind,this.colors);
    this.mesh.setEnabled(this.visible&&this.drops.length>0);
  }
  setVisible(visible:boolean){this.visible=visible;this.mesh.setEnabled(visible&&this.drops.length>0);}
  setSpace(black:boolean){this.black=black;}
  clear(){this.drops=[];this.mesh.setEnabled(false);}
  stats(){return {rain:this.drops.filter(d=>!d.snow).length,snow:this.drops.filter(d=>d.snow).length};}
}
