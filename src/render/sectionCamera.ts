import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import {Camera} from '@babylonjs/core/Cameras/camera';
import type {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {RADIUS} from '../sim/sphere';
import {blendedProjection} from './sectionClip';

export class SectionCamera {
  amount=0;enabled=false;halfWidth=.22;normal=Vector3.Forward();u=Vector3.Right();v=Vector3.Up();
  private globe:{position:Vector3;target:Vector3;up:Vector3;radius:number}|null=null;
  private pan=Vector3.Zero();private currentPan=Vector3.Zero();private scale=1;private angle=0;private tilt=0;
  private surfaceRadius=5;private focus=0;private currentFocus=0;private currentScale=1;
  framing:'surface'|'whole'='surface';flatRange:number|null=null;
  constructor(private camera:ArcRotateCamera,private root:TransformNode,private reducedMotion=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches){}
  toggle(enabled:boolean,direction:Vector3,surfaceRadius=5){
    if(enabled&&this.amount===0){
      this.globe={position:this.camera.position.clone(),target:this.camera.target.clone(),up:this.camera.upVector.clone(),radius:this.camera.radius};
      const inverse=this.root.computeWorldMatrix(true).clone().invert(),right=Vector3.TransformNormal(Vector3.Right(),this.camera.getViewMatrix().clone().invert());
      const tangent=Vector3.TransformNormal(right,inverse);this.v=direction.normalizeToNew();this.u=tangent.subtract(this.v.scale(Vector3.Dot(tangent,this.v)));
      if(this.u.lengthSquared()<1e-8)this.u=Vector3.Cross(Math.abs(this.v.y)>.9?Vector3.Right():Vector3.Up(),this.v);
      this.u.normalize();this.normal=Vector3.Cross(this.u,this.v).normalize();this.pan.setAll(0);this.angle=0;this.tilt=0;
      this.surfaceRadius=surfaceRadius;this.frame('surface');this.currentPan.setAll(0);this.currentFocus=this.focus;this.currentScale=this.scale;
    }
    this.enabled=enabled;
  }
  setAngle(degrees:number){const delta=(degrees-this.angle)*Math.PI/180;this.angle=this.wrap(degrees);this.u=Vector3.TransformNormal(this.u,Matrix.RotationAxis(this.v,delta)).normalize();this.normal=Vector3.Cross(this.u,this.v).normalize();}
  setTilt(degrees:number){const delta=(degrees-this.tilt)*Math.PI/180;this.tilt=this.wrap(degrees);this.v=Vector3.TransformNormal(this.v,Matrix.RotationAxis(this.u,delta)).normalize();this.normal=Vector3.Cross(this.u,this.v).normalize();}
  rotate(x:number,y:number){this.setAngle(this.angle+x*180/Math.PI);this.setTilt(this.tilt+y*180/Math.PI);}
  private wrap(degrees:number){return ((degrees+180)%360+360)%360-180;}
  private halfHeight(){const aspect=this.camera.getEngine().getAspectRatio(this.camera),fov=this.camera.fovMode===Camera.FOVMODE_VERTICAL_FIXED?this.camera.fov:2*Math.atan(Math.tan(this.camera.fov/2)/aspect);return (this.globe?.radius??this.camera.radius)*Math.tan(fov/2);}
  frame(mode:'surface'|'whole'){
    this.framing=mode;this.pan.setAll(0);this.focus=mode==='surface'?(this.flatRange!==null?RADIUS+.45:this.surfaceRadius-.15):0;
    const aspect=this.camera.getEngine().getAspectRatio(this.camera);
    this.scale=(mode==='surface'?(this.flatRange!==null?Math.max(1.0,RADIUS*this.flatRange*1.12/aspect):1.35):Math.max(6.6,this.surfaceRadius)*1.18/Math.min(1,aspect))/this.halfHeight();
  }
  followSurface(radius:number){this.surfaceRadius=radius;if(this.framing==='surface'&&this.flatRange===null)this.focus=radius-.15;}
  setFlatRange(range:number){this.flatRange=range;if(this.framing==='surface')this.frame('surface');}
  zoom(factor:number){this.scale=Math.max(.06,Math.min(6,this.scale*factor));}
  move(x:number,y:number){this.pan.x-=x*8*this.scale;this.pan.y+=y*8*this.scale;if(this.pan.length()>12)this.pan.normalize().scaleInPlace(12);}
  home(){this.frame('surface');}
  get active(){return this.enabled||this.amount>0;}
  get clipWidth(){const a=this.amount*this.amount*(3-2*this.amount);return 12+(this.halfWidth-12)*a;}
  update(dt:number){
    const was=this.amount;this.amount=this.reducedMotion?(this.enabled?1:0):Math.max(0,Math.min(1,this.amount+(this.enabled?1:-1)*dt/.35));
    if(!this.globe||(!this.active&&was===0))return false;
    const ease=this.reducedMotion?1:1-Math.exp(-Math.max(0,dt)/.12);this.currentFocus+=(this.focus-this.currentFocus)*ease;this.currentScale+=(this.scale-this.currentScale)*ease;this.currentPan=Vector3.Lerp(this.currentPan,this.pan,ease);
    const a=this.amount*this.amount*(3-2*this.amount),world=this.root.computeWorldMatrix(true),n=Vector3.TransformNormal(this.normal,world),up=Vector3.TransformNormal(this.v,world),target=Vector3.TransformCoordinates(this.u.scale(this.currentPan.x).add(this.v.scale(this.currentFocus+this.currentPan.y)),world);
    const position=target.subtract(n.scale(this.globe.radius));
    this.camera.setTarget(Vector3.Lerp(this.globe.target,target,a));
    let cameraUp=Vector3.Lerp(this.globe.up,up,a).normalize();const eye=Vector3.Lerp(this.globe.position,position,a),forward=this.camera.target.subtract(eye).normalize();
    cameraUp=cameraUp.subtract(forward.scale(Vector3.Dot(cameraUp,forward)));
    if(cameraUp.lengthSquared()<1e-8)cameraUp=Vector3.Cross(Vector3.TransformNormal(this.u,world),forward);
    this.camera.upVector=cameraUp.normalize();this.camera.setPosition(eye);
    const engine=this.camera.getEngine(),aspect=engine.getAspectRatio(this.camera),vertical=this.camera.fovMode===Camera.FOVMODE_VERTICAL_FIXED;
    const fov=vertical?this.camera.fov:2*Math.atan(Math.tan(this.camera.fov/2)/aspect),half=this.globe.radius*Math.tan(fov/2)*this.currentScale;
    const perspective=Matrix.PerspectiveFovLH(fov,aspect,this.camera.minZ,this.camera.maxZ,engine.isNDCHalfZRange);
    const ortho=Matrix.OrthoLH(half*2*aspect,half*2,this.camera.minZ,this.camera.maxZ,engine.isNDCHalfZRange);
    this.camera.freezeProjectionMatrix(blendedProjection(perspective,ortho,a));
    if(!this.active){this.camera.upVector=this.globe.up;this.camera.setTarget(this.globe.target);this.camera.setPosition(this.globe.position);this.camera.unfreezeProjectionMatrix();this.globe=null;}
    return true;
  }
  get viewScale(){return this.currentScale;}
  get angleDegrees(){return this.angle;}
  get tiltDegrees(){return this.tilt;}
}
