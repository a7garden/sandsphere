import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import type {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';

export function spinAxisDirection(tiltDegrees:number){const t=tiltDegrees*Math.PI/180;return new Vector3(-Math.sin(t),Math.cos(t),0);}

/** Roll the camera toward planetary north without moving its eye or target. */
export class AxisAlignment {
 private flight:{from:Vector3;rotation:Quaternion;time:number}|null=null;
 constructor(private camera:ArcRotateCamera){}
 align(tilt:number){this.start(spinAxisDirection(tilt));}
 cancel(){this.flight=null;}
 get moving(){return this.flight!==null;}
 private start(up:Vector3){const from=this.camera.upVector.clone(),rotation=Quaternion.Identity();Quaternion.FromUnitVectorsToRef(from,up,rotation);this.flight={from,rotation,time:0};}
 private setUp(up:Vector3){
  this.camera.getViewMatrix(true);
  this.camera.upVector=up;
  // setPosition with an unchanged eye skips rebuilding the orbit angles.
  this.camera.rebuildAnglesAndRadius();
 }
 update(dt:number){
  const f=this.flight;if(!f)return;
  const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  f.time=reduced?1:Math.min(1,f.time+Math.max(0,dt)/.35);
  const t=f.time*f.time*(3-2*f.time),matrix=Matrix.Identity();Quaternion.Slerp(Quaternion.Identity(),f.rotation,t).toRotationMatrix(matrix);
  this.setUp(Vector3.TransformNormal(f.from,matrix).normalize());if(f.time===1)this.flight=null;
 }
 reset(){this.cancel();this.setUp(Vector3.Up());}
}

/** ArcRotateCamera's angles live in its current up-vector frame. */
export function cameraFrameDirection(direction:Vector3,up:Vector3){const matrix=Matrix.Identity();Matrix.RotationAlignToRef(up,Vector3.Up(),matrix);return Vector3.TransformNormal(direction,matrix);}
