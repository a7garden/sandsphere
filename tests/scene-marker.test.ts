import {describe,it,expect} from 'vitest';
import {sceneMarker} from '../src/render/sceneMarker';
describe('sun direction marker',()=>{
 it('keeps a visible sun at its projected location',()=>expect(sceneMarker(200,150,true,800,600)).toEqual({x:200,y:150,onScreen:true}));
 it('keeps offscreen and behind-camera directions on the edge without changing direction',()=>{
  for(const [x,y,front] of [[1000,500,true],[-100,100,true],[430,340,false]] as const){
   const p=sceneMarker(x,y,front,800,600);
   expect(p.onScreen).toBe(false);expect(p.x).toBeGreaterThanOrEqual(28);expect(p.x).toBeLessThanOrEqual(772);
   expect(p.y).toBeGreaterThanOrEqual(28);expect(p.y).toBeLessThanOrEqual(572);
   expect((p.x-400)*(y-300)-(p.y-300)*(x-400)).toBeCloseTo(0);
  }
 });
 it('has a finite fallback for a sun directly behind the viewer',()=>expect(sceneMarker(400,300,false,800,600)).toEqual({x:400,y:28,onScreen:false}));
});
