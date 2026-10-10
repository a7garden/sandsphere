import {describe,it,expect} from 'vitest';
import {renderScaling,SurfaceRefreshClock} from '../src/render/budget';

describe('rendering budget',()=>{
 it('caps large Retina render buffers while retaining detail on small scenes',()=>{
  for(const [width,height,ratio] of [[1500,1600,2],[2200,1700,2],[360,356,2],[800,810,1]]){
   const scale=renderScaling(width,height,ratio);
   expect(width*height/(scale*scale)).toBeLessThanOrEqual(2_000_001);
  }
  expect(renderScaling(360,356,2)).toBe(1/1.6);
 });
 it('coalesces uploads and preserves elapsed simulation time at every playback speed',()=>{
  for(const speed of [1,2,4]){
   const clock=new SurfaceRefreshClock();let uploaded=0,updates=0;
   for(let frame=0;frame<60;frame++){
    clock.mark(speed/60);const dt=clock.take(frame*1000/60);
    if(dt!==null){uploaded+=dt;updates++;}
   }
   uploaded+=clock.take(1100)!;
   expect(uploaded).toBeCloseTo(speed,12);expect(updates).toBeLessThanOrEqual(15);
   expect(clock.take(1200)).toBeNull();
  }
 });
 it('refreshes paused edits immediately and discards pending visuals on a planet switch',()=>{
  const clock=new SurfaceRefreshClock();clock.mark(.03);expect(clock.take(0)).toBe(.03);
  clock.mark(0);expect(clock.take(1)).toBe(0);
  clock.mark(.03);clock.reset();expect(clock.take(100)).toBeNull();
 });
});
