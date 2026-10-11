import {it,expect} from 'vitest';
import {facetWater} from '../src/render/surface';
import {writeHexWater} from '../src/render/surfaceBuffers';
it('writes the same complete hex water faces, ice and coast flags without allocating polygons',()=>{
 for(let n=0;n<120;n++){
  const water=new Float32Array([4+n*.01,1,.2,3,2+n*.01,1,2,1,4]),ground=new Float32Array([4.2,1,.2,3.2,2,1,2.2,1,4]),directions=new Float32Array([1,0,0,0,1,0]);
  const depth=n%3===0?.01:.04+n*.005,ice=(n%11)/10,inset=n%2?.045:0,coast=n%2===0;
  const positions=new Float32Array(18),normals=new Float32Array(18),colors=new Float32Array(24);
  writeHexWater(3,0,1,2,1,water,ground,directions,depth,ice,inset,coast,positions,normals,colors);
  const points=[0,1,2].map(i=>({x:water[i*3],y:water[i*3+1],z:water[i*3+2],depth,ice}));
  const expected=facetWater(points,[0,1,2].map(i=>Math.hypot(ground[i*3],ground[i*3+1],ground[i*3+2])));
  if(!expected.length){expect(positions.every(v=>v===0)).toBe(true);continue;}
  for(let k=0;k<3;k++){
   const v=expected[k],r=Math.hypot(v.x,v.y,v.z),scale=(r-inset)/r;
   for(const [j,value] of [v.x,v.y,v.z].entries())expect(positions[9+k*3+j]).toBeCloseTo(value*scale,5);
   expect([...normals.slice(9+k*3,12+k*3)]).toEqual([0,1,0]);
   expect([...colors.slice(12+k*4,16+k*4)]).toEqual([Math.fround(v.ice!),coast&&k>0?1:0,0,Math.fround(v.depth)]);
  }
 }
});
