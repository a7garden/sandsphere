import {describe,it,expect} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {clipWater,facetWater,refineSurface,type WetVertex} from '../src/render/surface';

function area(polygon:WetVertex[]) {
  return Math.abs(polygon.reduce((sum,v,i)=>{
    const next=polygon[(i+1)%polygon.length];return sum+v.x*next.y-next.x*v.y;
  },0))/2;
}
const triangle=(depths:number[])=>depths.map((depth,i)=>({x:i===1?1:0,y:i===2?1:0,z:0,depth}));

describe('crisp surface geometry',()=>{
  it('keeps low-poly shores on complete faces without altering source water',()=>{
    const vertices=[{x:6,y:0,z:0,depth:.3,ice:.6},{x:0,y:6,z:0,depth:-.05,ice:0},{x:0,y:0,z:6,depth:-.05,ice:0}];
    const before=structuredClone(vertices),ground=[5.9,6.1,6.2];
    const face=facetWater(vertices,ground);
    expect(face).toHaveLength(3);
    face.forEach((v,i)=>{
      const radius=Math.hypot(v.x,v.y,v.z);
      expect(radius).toBeGreaterThanOrEqual(ground[i]+.008);
      expect([v.x/radius,v.y/radius,v.z/radius]).toEqual([vertices[i].x/6,vertices[i].y/6,vertices[i].z/6]);
      expect(v.depth).toBeCloseTo(.2/3);expect(v.ice).toBeCloseTo(.2);
    });
    expect(vertices).toEqual(before);
    expect(facetWater(vertices.map(v=>({...v,depth:-.01})),ground)).toEqual([]);
  });
  it('leaves dry land uncovered and keeps fully wet faces',()=>{
    expect(clipWater(triangle([0,0,0]))).toHaveLength(0);
    expect(area(clipWater(triangle([1,1,1])))).toBeCloseTo(0.5,8);
  });
  it('cuts the shoreline at a geometric boundary with no transparent fringe',()=>{
    const one=clipWater(triangle([1,0,0]),0.5);
    const two=clipWater(triangle([0,1,1]),0.5);
    expect(one).toHaveLength(3);expect(two).toHaveLength(4);
    expect(area(one)).toBeCloseTo(0.125,8);
    expect(area(two)).toBeCloseTo(0.375,8);
    for(const vertex of [...one,...two])expect(vertex.depth).toBeGreaterThanOrEqual(0.5);
  });
  it('refines visual detail without a seam or changing simulation cells',()=>{
    const grid=createSphere(2),before=grid.directions.slice(),surface=refineSurface(grid);
    expect(surface.count).toBe(642);expect(grid.count).toBe(162);
    expect(grid.directions).toEqual(before);
    const edges=new Map<string,number>();
    for(let p=0;p<surface.indices.length;p+=3) {
      const a=surface.indices[p],b=surface.indices[p+1],c=surface.indices[p+2];
      for(const [u,v] of [[a,b],[b,c],[c,a]]) {
        const key=u<v?u+':'+v:v+':'+u;edges.set(key,(edges.get(key)??0)+1);
      }
    }
    for(const uses of edges.values())expect(uses).toBe(2);
    for(let i=0;i<surface.count;i++) {
      expect(Math.hypot(...surface.directions.slice(i*3,i*3+3))).toBeCloseTo(1,6);
      expect(surface.parents[i*2]).toBeLessThan(grid.count);
      expect(surface.parents[i*2+1]).toBeLessThan(grid.count);
    }
  });
});

it('keeps recursive subdivision parents ordered and preserves a constant lake head',()=>{
  const grid=createSphere(1),surface=refineSurface(grid,2);
  expect(surface.count).toBe(642);
  const head=new Float32Array(surface.count);head.fill(12,0,grid.count);
  for(let i=grid.count;i<surface.count;i++){
    const a=surface.parents[i*2],b=surface.parents[i*2+1];
    expect(a).toBeLessThan(i);expect(b).toBeLessThan(i);
    head[i]=(head[a]+head[b])*.5;
  }
  expect([...head].every(v=>v===12)).toBe(true);
});
