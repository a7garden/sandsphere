import {it,expect} from 'vitest';
import {saturationPressure,type WaterPhase} from '../src/sim/waterPhysics';
import {saturationPressure as originalPressure} from './helpers/preOptimizationAtmosphere/waterPhysics';

it('keeps the original ice curve and the pressure fits outside the melting join',()=>{
 for(const t of [-240,-150,-100,-20,-.02,-.01,0])expect(saturationPressure(t,'ice')).toBe(originalPressure(t,'ice'));
 for(const t of [-240,-100,-20,-.02,-.01,.02,20,100,365,400])for(const phase of ['water','ice'] as WaterPhase[])expect(saturationPressure(t,phase)).toBe(originalPressure(t,phase));
});

it('joins both phases continuously at -0.01, 0 and the physical triple point',()=>{
 expect(saturationPressure(0,'water')).toBe(saturationPressure(0,'ice'));
 const triple=273.16-273.15;
 expect(saturationPressure(triple,'water')).toBe(originalPressure(triple,'water'));
 expect(saturationPressure(triple,'ice')).toBe(saturationPressure(triple,'water'));
 expect(saturationPressure(triple)).toBeCloseTo(611.6570697405119,8);
 for(const t of [-.01,0,.01])for(const phase of ['water','ice'] as WaterPhase[]){
  const center=saturationPressure(t,phase);
  expect(Math.abs(saturationPressure(t-1e-10,phase)-center)).toBeLessThan(1e-7);
  expect(Math.abs(saturationPressure(t+1e-10,phase)-center)).toBeLessThan(1e-7);
 }
});

it('keeps the bounded approximation monotone with the expected phase ordering',()=>{
 let water=0,ice=0;
 for(let n=0;n<=4000;n++){
  const t=-.02+n*.00001,w=saturationPressure(t,'water'),i=saturationPressure(t,'ice');
  expect(w).toBeGreaterThan(water);expect(i).toBeGreaterThan(ice);
  if(t<0)expect(w).toBeGreaterThanOrEqual(i);else expect(w).toBe(i);
  expect(Math.abs(w/originalPressure(t,'water')-1)).toBeLessThan(1.1e-4);
  water=w;ice=i;
 }
});
