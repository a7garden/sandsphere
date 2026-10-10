import {describe,it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {Matrix,Vector3,Viewport} from '@babylonjs/core/Maths/math';
import {AxisAlignment,cameraFrameDirection,spinAxisDirection} from '../src/render/axisAlignment';
import {orbitAngles} from '../src/render/orbitAngles';

describe('spin-axis camera alignment',()=>{
 it.each([0,23.5,90,180])('places north vertically at %s° without moving the viewpoint',tilt=>{
  const engine=new NullEngine(),scene=new Scene(engine),camera=new ArcRotateCamera('camera',-1.01,1.17,18,Vector3.Zero(),scene),alignment=new AxisAlignment(camera);
  try{
   const position=camera.position.clone(),target=camera.target.clone();alignment.align(tilt);
   for(let i=0;i<30;i++)alignment.update(1/60);
   camera.getViewMatrix(true);expect(camera.position.subtract(position).length()).toBeLessThan(1e-5);expect(camera.target).toEqual(target);expect(camera.radius).toBeCloseTo(18,5);
   const axis=spinAxisDirection(tilt);expect(camera.upVector.subtract(axis).length()).toBeLessThan(1e-6);
   const transform=camera.getViewMatrix().multiply(camera.getProjectionMatrix()),viewport=new Viewport(0,0,1000,800),center=Vector3.Project(Vector3.Zero(),Matrix.Identity(),transform,viewport),north=Vector3.Project(axis.scale(6),Matrix.Identity(),transform,viewport);
   expect(north.x).toBeCloseTo(center.x,4);expect(north.y).toBeLessThan(center.y);
   alignment.reset();camera.getViewMatrix(true);expect(camera.upVector).toEqual(Vector3.Up());expect(camera.position.subtract(position).length()).toBeLessThan(1e-5);
  }finally{scene.dispose();engine.dispose();}
 });
 it('aligns again to the requested axis and supports pin navigation in the resulting camera frame',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),camera=new ArcRotateCamera('camera',-1,1.1,18,Vector3.Zero(),scene),alignment=new AxisAlignment(camera);
  try{
   alignment.align(23.5);alignment.update(1);alignment.align(90);alignment.update(1);expect(camera.upVector.subtract(spinAxisDirection(90)).length()).toBeLessThan(1e-6);
   const direction=new Vector3(.3,.4,.8).normalize(),angles=orbitAngles(cameraFrameDirection(direction,camera.upVector).asArray(),camera.alpha);
   camera.alpha=angles.alpha;camera.beta=angles.beta;camera.getViewMatrix(true);
   expect(camera.position.normalizeToNew().subtract(direction).length()).toBeLessThan(1e-5);
  }finally{scene.dispose();engine.dispose();}
 });
 it('finishes once and never overrides subsequent camera operations',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),camera=new ArcRotateCamera('camera',-1,1.1,18,Vector3.Zero(),scene),alignment=new AxisAlignment(camera);
  try{
   alignment.align(23.5);expect(alignment.moving).toBe(true);alignment.update(1);expect(alignment.moving).toBe(false);
   camera.upVector=Vector3.Up();camera.rebuildAnglesAndRadius();camera.alpha+=.4;camera.beta+=.2;
   const alpha=camera.alpha,beta=camera.beta;
   alignment.update(1);expect(camera.upVector).toEqual(Vector3.Up());expect(camera.alpha).toBe(alpha);expect(camera.beta).toBe(beta);
   alignment.align(23.5);alignment.update(1);expect(camera.upVector.subtract(spinAxisDirection(23.5)).length()).toBeLessThan(1e-6);
   alignment.align(23.5);alignment.update(1);expect(camera.upVector.subtract(spinAxisDirection(23.5)).length()).toBeLessThan(1e-6);
   alignment.reset();alignment.update(1);expect(camera.upVector).toEqual(Vector3.Up());
  }finally{scene.dispose();engine.dispose();}
 });
 it('lets manual navigation interrupt the alignment animation without a later snap',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),camera=new ArcRotateCamera('camera',-1,1.1,18,Vector3.Zero(),scene),alignment=new AxisAlignment(camera);
  try{
   alignment.align(90);alignment.update(.1);alignment.cancel();const up=camera.upVector.clone();
   camera.alpha+=.2;alignment.update(1);expect(alignment.moving).toBe(false);expect(camera.upVector).toEqual(up);
  }finally{scene.dispose();engine.dispose();}
 });
});
