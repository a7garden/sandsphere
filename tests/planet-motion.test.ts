import {describe,it,expect} from 'vitest';
import {OrbitDisplay,type MotionSnapshot} from '../src/render/orbitDisplay';
import {RotationFrame} from '../src/render/rotationFrame';
import {orbitalEnvironment,orbitalSun} from '../src/sim/orbit';

const sample=():MotionSnapshot=>({time:0,paused:false,environment:{...orbitalEnvironment(1),orbitAngle:0},spin:{angle:0,running:true,period:120,tilt:23.5}});

describe('planet render motion independent of physics',()=>{
 it.each([1,2,4])('moves on every 60 Hz frame while physics advances at 30 Hz, at %sx',speed=>{
  const s=sample(),display=new OrbitDisplay(s),steps:number[]=[],rate=Math.PI*2/120;
  for(let frame=1;frame<=120;frame++){
   if(frame%2===0){s.time+=speed/30;s.spin!.angle=s.time*rate;s.environment.orbitAngle=s.time*Math.PI*2/240;}
   const physical=structuredClone(s),before=display.spin;display.update(s,1/60,speed);steps.push(display.spin-before);
   expect(s).toEqual(physical);
  }
  expect(Math.min(...steps)).toBeGreaterThan(rate*speed/60*.85);
  expect(Math.max(...steps)).toBeLessThan(rate*speed/60*1.15);
 });
 it('stops immediately on pause or zero spin speed, and honors a physical single step',()=>{
  const s=sample(),display=new OrbitDisplay(s);display.update(s,1/60,1);s.paused=true;
  const spin=display.spin,orbit=display.angle;for(let i=0;i<30;i++)display.update(s,1/60,1);
  expect(display.spin).toBe(spin);expect(display.angle).toBe(orbit);
  s.time=1/30;s.spin!.angle=.01;s.environment.orbitAngle=.005;display.update(s,1/60,1);
  expect(display.spin).toBe(.01);expect(display.angle).toBe(.005);
  s.paused=false;s.spin!.running=false;for(let i=0;i<30;i++)display.update(s,1/60,1);
  expect(display.spin).toBe(.01);expect(display.angle).toBeGreaterThan(.005);
 });
 it('keeps the viewing frame fixed while smooth sunlight moves, then resumes continuously',()=>{
  const s=sample(),display=new OrbitDisplay(s),frame=new RotationFrame();frame.reset(0);frame.frozen=true;
  const sun=frame.sun(orbitalSun(display.angle),23.5);
  for(let i=1;i<=12;i++){if(i%2===0){s.time=i/60;s.spin!.angle=s.time*Math.PI*2/120;s.environment.orbitAngle=s.time*Math.PI*2/240;}display.update(s,1/60,1);frame.update(display.spin);}
  expect(frame.displayAngle).toBe(0);expect(frame.sun(orbitalSun(display.angle),23.5)).not.toEqual(sun);
  frame.frozen=false;frame.update(display.spin);expect(frame.displayAngle).toBe(0);
  display.update(s,1/60,1);frame.update(display.spin);expect(frame.displayAngle).toBeGreaterThan(0);expect(frame.displayAngle).toBeLessThan(.002);
 });
});
