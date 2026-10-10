import {describe,it,expect} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {dualSurface} from '../src/render/surface';
describe('dual-cell rendering',()=>{
 it.each([0,1,2])('covers refinement %i with twelve pentagons and no open edges',(level)=>{
  const grid=createSphere(2),surface=dualSurface(grid,level),sizes=new Uint32Array(surface.tileCount),edges=new Map<string,number>();
  expect(surface.tileCount).toBe(10*4**(2+level)+2);expect(grid.count).toBe(162);
  for(const owner of surface.owners)sizes[owner]++;
  expect([...sizes].filter(n=>n===5).length).toBe(12);expect([...sizes].every(n=>n===5||n===6)).toBe(true);
  for(let p=0;p<surface.indices.length;p+=3)for(let k=0;k<3;k++){
   const a=surface.indices[p+k],b=surface.indices[p+(k+1)%3],key=a<b?a+':'+b:b+':'+a;edges.set(key,(edges.get(key)??0)+1);
  }
  expect([...edges.values()].every(n=>n===2)).toBe(true);
  expect(surface.owners.length*3).toBe(surface.indices.length);
 });
 it('uses the existing simulation cells and samples each face centre from three parents',()=>{
  const grid=createSphere(2),surface=dualSurface(grid);
  expect([...surface.directions.slice(0,grid.count*3)]).toEqual([...grid.directions]);
  for(let i=grid.count;i<surface.count;i++){
   expect(surface.parents[i*2]).toBeLessThan(grid.count);expect(surface.parents[i*2+1]).toBeLessThan(grid.count);expect(surface.third[i]).toBeGreaterThanOrEqual(0);expect(surface.third[i]).toBeLessThan(grid.count);
  }
 });
});

it('interpolates finer tile fields recursively without changing simulation data',()=>{
 const grid=createSphere(2),before=grid.directions.slice(),surface=dualSurface(grid,2);
 const field=new Float32Array(surface.count);field.fill(12,0,grid.count);
 for(let i=grid.count;i<surface.count;i++){
  const a=surface.parents[i*2],b=surface.parents[i*2+1],c=surface.third[i];
  expect(a).toBeLessThan(i);expect(b).toBeLessThan(i);if(c>=0)expect(c).toBeLessThan(i);
  field[i]=(field[a]+field[b]+(c>=0?field[c]:0))/(c>=0?3:2);
 }
 expect([...field].every(value=>value===12)).toBe(true);expect(grid.directions).toEqual(before);
});
