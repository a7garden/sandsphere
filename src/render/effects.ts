import {ParticleSystem} from '@babylonjs/core/Particles/particleSystem';
import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';
import {Color4} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {GASES} from '../sim/gases';
type EffectGas=Exclude<typeof GASES[number]['id'],'vapor'>;

/** Sparse fine tracers and wisps; the solver owns every material transfer. */
export class SurfaceEffects {
  private steamSystem:ParticleSystem;
  private sparkSystem:ParticleSystem;
  private steamQueue:Vector3[]=[];
  private sparkQueue:Vector3[]=[];
  private gasSystems=new Map<EffectGas,{system:ParticleSystem;queue:Vector3[];color:readonly number[]}>();
  private escapeSystems=new Map<typeof GASES[number]['id'],{system:ParticleSystem;queue:Vector3[];color:readonly number[]}>();
  constructor(scene:Scene,root:TransformNode) {
    const emitter=new Mesh('surface transfer origin',scene);emitter.parent=root;emitter.isPickable=false;
    const wisp=new DynamicTexture('fine vapor filaments',{width:64,height:128},scene,false);
    const ctx=wisp.getContext() as CanvasRenderingContext2D;ctx.clearRect(0,0,64,128);
    for(let n=0;n<12;n++){
      const x=20+Math.random()*24,gradient=ctx.createLinearGradient(0,0,0,128);
      gradient.addColorStop(0,'rgba(255,255,255,0)');gradient.addColorStop(.4,'rgba(255,255,255,0.20)');gradient.addColorStop(1,'rgba(255,255,255,0)');
      ctx.strokeStyle=gradient;ctx.lineWidth=2+Math.random()*5;ctx.beginPath();ctx.moveTo(x,122);ctx.bezierCurveTo(x-12,90,x+16,52,x-4,8);ctx.stroke();
    }wisp.update();
    const trace=new DynamicTexture('thin transfer tracer',{width:16,height:64},scene,false),tx=trace.getContext();
    const fade=tx.createLinearGradient(0,0,0,64);fade.addColorStop(0,'rgba(255,255,255,0)');fade.addColorStop(.65,'rgba(255,255,255,0.8)');fade.addColorStop(1,'rgba(255,255,255,0)');tx.fillStyle=fade;tx.fillRect(6,0,4,64);trace.update();
    const setup=(name:string,queue:Vector3[],capacity:number,texture=trace)=>{
      const system=new ParticleSystem(name,capacity,scene);system.particleTexture=texture;system.emitter=emitter;system.emitRate=0;system.manualEmitCount=0;
      system.updateSpeed=1/60;system.renderingGroupId=1;system.blendMode=ParticleSystem.BLENDMODE_STANDARD;
      system.startPositionFunction=(matrix,position)=>Vector3.TransformCoordinatesToRef(queue.shift()??Vector3.Zero(),matrix,position);
      system.startDirectionFunction=(_matrix,direction,particle)=>{direction.copyFrom(particle.position).normalize().scaleInPlace(.22+Math.random()*.18);direction.x+=(Math.random()-.5)*.05;direction.z+=(Math.random()-.5)*.05;};
      system.minEmitPower=1;system.maxEmitPower=1;system.minAngularSpeed=-.1;system.maxAngularSpeed=.1;system.start();return system;
    };
    this.steamSystem=setup('evaporation wisps',this.steamQueue,320,wisp);
    this.steamSystem.minLifeTime=.7;this.steamSystem.maxLifeTime=1.5;this.steamSystem.minSize=.045;this.steamSystem.maxSize=.09;
    this.steamSystem.addSizeGradient(0,.6);this.steamSystem.addSizeGradient(1,1.8);this.steamSystem.colorDead=new Color4(.7,.8,.9,0);
    this.sparkSystem=setup('fine heat shimmer',this.sparkQueue,100);
    this.sparkSystem.minLifeTime=.2;this.sparkSystem.maxLifeTime=.5;this.sparkSystem.minSize=.012;this.sparkSystem.maxSize=.024;
    this.sparkSystem.color1=new Color4(1,.55,.18,.4);this.sparkSystem.color2=new Color4(1,.77,.42,.25);this.sparkSystem.colorDead=new Color4(1,.5,.2,0);
    this.sparkSystem.billboardMode=ParticleSystem.BILLBOARDMODE_STRETCHED;
    for(const gas of GASES){
      const queue:Vector3[]=[],system=setup('escaping '+gas.id,queue,180);
      system.minLifeTime=.7;system.maxLifeTime=1.6;system.minSize=.018;system.maxSize=.028;system.billboardMode=ParticleSystem.BILLBOARDMODE_STRETCHED;
      system.startDirectionFunction=(_matrix,direction,particle)=>direction.copyFrom(particle.position).normalize().scaleInPlace(2+Math.random());
      system.colorDead=new Color4(...gas.color,0);this.escapeSystems.set(gas.id,{system,queue,color:gas.color});
      if(gas.id==='vapor')continue;
      const supplied:Vector3[]=[],supply=setup('supplied '+gas.id,supplied,140);
      supply.minLifeTime=.4;supply.maxLifeTime=.9;supply.minSize=.035;supply.maxSize=.055;supply.billboardMode=ParticleSystem.BILLBOARDMODE_STRETCHED;
      supply.colorDead=new Color4(...gas.color,0);this.gasSystems.set(gas.id,{system:supply,queue:supplied,color:gas.color});
    }
  }
  steam(point:Vector3,amount:number){
    const expected=Math.min(3,amount*24),count=Math.floor(expected)+(Math.random()<expected%1?1:0);
    for(let n=0;n<count&&this.steamQueue.length<40;n++)this.steamQueue.push(point);this.steamSystem.manualEmitCount=this.steamQueue.length;
  }
  heat(point:Vector3,temperature:number,dt:number){
    if(temperature<450||Math.random()>dt*Math.min(1,temperature/1800)||this.sparkQueue.length>30)return;
    this.sparkQueue.push(point);this.sparkSystem.manualEmitCount=this.sparkQueue.length;
  }
  gas(point:Vector3,kind:EffectGas,amount:number){
    const {system,queue}=this.gasSystems.get(kind)!,expected=Math.min(3,amount*.5),count=Math.floor(expected)+(Math.random()<expected%1?1:0);
    for(let n=0;n<count&&queue.length<25;n++)queue.push(point);system.manualEmitCount=queue.length;
  }
  escape(point:Vector3,kind:typeof GASES[number]['id'],amount:number){
    const {system,queue}=this.escapeSystems.get(kind)!,expected=Math.min(1,amount*4),count=Math.floor(expected)+(Math.random()<expected%1?1:0);
    for(let n=0;n<count&&queue.length<45;n++)queue.push(point);system.manualEmitCount=queue.length;
  }
  setSpace(black:boolean){
    this.steamSystem.color1=new Color4(black?.8:.35,black?.88:.44,black?.94:.5,.32);this.steamSystem.color2=new Color4(black?.92:.46,black?.95:.52,black?1:.57,.20);
    for(const {system,color} of [...this.gasSystems.values(),...this.escapeSystems.values()]){const shade=black?1:.6;system.color1=new Color4(color[0]*shade,color[1]*shade,color[2]*shade,.42);system.color2=new Color4(color[0]*shade,color[1]*shade,color[2]*shade,.22);}
  }
  clear(){this.steamQueue.length=0;this.sparkQueue.length=0;this.steamSystem.reset();this.sparkSystem.reset();this.steamSystem.manualEmitCount=0;this.sparkSystem.manualEmitCount=0;for(const {system,queue} of [...this.gasSystems.values(),...this.escapeSystems.values()]){queue.length=0;system.reset();system.manualEmitCount=0;}}
  stats(){return {steam:this.steamSystem.getActiveCount(),heat:this.sparkSystem.getActiveCount(),gas:[...this.gasSystems.values()].reduce((s,v)=>s+v.system.getActiveCount(),0),escape:[...this.escapeSystems.values()].reduce((s,v)=>s+v.system.getActiveCount(),0)};}
}
