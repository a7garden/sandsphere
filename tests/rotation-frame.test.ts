import {describe,it,expect} from 'vitest';
import {RotationFrame} from '../src/render/rotationFrame';
import {localSun,orbitalSun} from '../src/sim/orbit';

describe('fixed observation frame',()=>{
 it('moves the rendered sun while the planet display is frozen',()=>{
  const frame=new RotationFrame();frame.update(0);frame.frozen=true;
  const before=frame.sun(orbitalSun(0),0);frame.update(Math.PI/2);
  const after=frame.sun(orbitalSun(0),0);
  expect(frame.displayAngle).toBe(0);expect(after).not.toEqual(before);
  expect(Math.hypot(...after)).toBeCloseTo(1);
 });
 it('holds only the displayed angle while physical rotation advances, then resumes without a jump',()=>{
  const frame=new RotationFrame();frame.update(1);frame.frozen=true;frame.update(2);
  expect(frame.displayAngle).toBe(1);expect(frame.physicalAngle).toBe(2);
  frame.frozen=false;frame.update(2);expect(frame.displayAngle).toBe(1);
  frame.update(2.1);expect(frame.displayAngle).toBeCloseTo(1.1,12);
 });
 it('continues across the angle wrap and resets to a newly selected planet',()=>{
  const frame=new RotationFrame();frame.update(6.2);frame.frozen=true;frame.update(.05);
  frame.frozen=false;frame.update(.15);expect(frame.displayAngle).toBeCloseTo((6.3)%(Math.PI*2),12);
  frame.frozen=true;frame.reset(2);expect(frame.displayAngle).toBe(2);expect(frame.frozen).toBe(true);
 });
 it('preserves the modeled sunlight at every cell for tilted, frozen and resumed views',()=>{
  for(const tilt of [0,23.5,90,170])for(const angle of [.1,1.7,5.8]){
   const frame=new RotationFrame();frame.update(.7);frame.frozen=true;frame.update(angle);
   const sun=frame.sun(orbitalSun(1.2),tilt),display=frame.displayAngle;
   const t=tilt*Math.PI/180,x=Math.cos(t)*sun[0]+Math.sin(t)*sun[1],y=-Math.sin(t)*sun[0]+Math.cos(t)*sun[1];
   const local=[Math.cos(display)*x-Math.sin(display)*sun[2],y,Math.sin(display)*x+Math.cos(display)*sun[2]];
   const physical=localSun(angle,tilt,1.2);
   local.forEach((v,i)=>expect(v).toBeCloseTo(physical[i],12));
  }
 });
});
