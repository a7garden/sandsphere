import {describe,it,expect} from 'vitest';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {sectionProfileCurves} from '../src/render/sectionProfile';
import {buildSectionMesh} from '../src/render/sectionGeometry';
import {createSphere} from '../src/sim/sphere';
import {seedWorld} from '../src/sim/model';

const point=(a:number,r:number)=>new Vector3(Math.sin(a)*r,Math.cos(a)*r,0);
describe('rounded display-only section',()=>{
 it('rounds a shared peak with a continuous tangent and no new extrema',()=>{
  const points=[point(-.3,5),point(-.1,5.5),point(0,6),point(.12,5.6),point(.4,5)];
  const segments=points.slice(1).map((p,i)=>[points[i],p] as const);
  const curves=sectionProfileCurves(segments,Vector3.Forward(),Vector3.Zero());
  for(let i=0;i<curves.length;i++){
   expect(curves[i](0)).toEqual(points[i]);expect(curves[i](1)).toEqual(points[i+1]);
   for(let k=0;k<=100;k++)expect(curves[i](k/100).length()).toBeGreaterThanOrEqual(Math.min(points[i].length(),points[i+1].length())-1e-9);
   for(let k=0;k<=100;k++)expect(curves[i](k/100).length()).toBeLessThanOrEqual(Math.max(points[i].length(),points[i+1].length())+1e-9);
  }
  const epsilon=1e-5;
  for(let i=1;i<curves.length;i++){
   const incoming=curves[i-1](1).subtract(curves[i-1](1-epsilon)).normalize();
   const outgoing=curves[i](epsilon).subtract(curves[i](0)).normalize();
   expect(Vector3.Dot(incoming,outgoing)).toBeGreaterThan(.99999);
  }
 });
 it('handles reversed edges, the angle seam and an offset cut plane',()=>{
  const center=new Vector3(0,0,-.22),points=[point(3,5),point(3.14,5.4),point(-3,5)].map(p=>p.add(center));
  const curves=sectionProfileCurves([[points[1],points[0]],[points[2],points[1]]],Vector3.Forward(),center);
  for(const curve of curves)for(let k=0;k<=16;k++){
   const p=curve(k/16);expect(p.z).toBeCloseTo(-.22,8);expect(p.subtract(center).length()).toBeGreaterThanOrEqual(5-1e-8);expect(p.subtract(center).length()).toBeLessThanOrEqual(5.4+1e-8);
  }
 });
 it('does not join disconnected wet regions',()=>{
  const a:[Vector3,Vector3]=[point(-.4,5),point(-.2,5.2)],b:[Vector3,Vector3]=[point(.2,7),point(.4,5)];
  const together=sectionProfileCurves([a,b],Vector3.Forward(),Vector3.Zero());
  const alone=sectionProfileCurves([a],Vector3.Forward(),Vector3.Zero());
  expect(together[0](.5)).toEqual(alone[0](.5));
 });
 it('softens densely sampled needle tips while keeping shared edges closed',()=>{
  const angles=[-.2,-.01,0,.01,.2],radii=[5,5.9,6,5.9,5];
  const points=angles.map((a,i)=>point(a,radii[i])),bases=angles.map(a=>point(a,4.8));
  const segments=points.slice(1).map((p,i)=>[points[i],p] as const),baseSegments=bases.slice(1).map((p,i)=>[bases[i],p] as const);
  const curves=sectionProfileCurves(segments,Vector3.Forward(),Vector3.Zero(),baseSegments,.05);
  expect(curves[1](1).length()).toBeLessThan(5.95);
  expect(curves[1](1).length()).toBeGreaterThan(5.8);
  for(let i=1;i<curves.length;i++)expect(Vector3.Distance(curves[i-1](1),curves[i](0))).toBeLessThan(1e-8);
  for(const curve of curves)for(let k=0;k<=20;k++)expect(curve(k/20).length()).toBeLessThanOrEqual(6);
 });
 it('ignores decorative globe insets and keeps owners, sources and water beds intact',()=>{
  const grid=createSphere(1),state=seedWorld(grid),before=state.slice();
  const terrain=new Float32Array([5.8,0,-1,6,1,1,5.5,-1,1]);
  const inset=Float32Array.from(terrain,v=>v*.95);
  const water=Float32Array.from(terrain,v=>v*1.08);
  const samples={cellOwners:new Uint32Array([0,1,2]),baseHeights:new Float32Array(3),solidRadii:new Float32Array([6,6,6]),mobileWater:new Float32Array([1,1,1]),triangleVertices:new Uint32Array([0,1,2]),terrainVertices:terrain,waterVertices:water,waterDepths:new Float32Array([1,1,1])};
  const build=(source:Float32Array)=>buildSectionMesh(source,new Float32Array(18),new Uint32Array([0]),state,grid,Vector3.Forward(),.0001,undefined,1/30,samples,true,undefined,true);
  const cap=build(inset);expect(cap).toEqual(build(terrain));expect(state).toEqual(before);
  expect(new Set(cap.owners)).toEqual(new Set([-1,0]));expect(cap.positions.every(Number.isFinite)).toBe(true);
  const surfaceEdges=[];
  for(let t=0;t<cap.owners.length;t+=1)if(cap.data[t*12+2]===1&&cap.owners[t-1]===-1)surfaceEdges.push([Vector3.FromArray(cap.positions,t*9+3),Vector3.FromArray(cap.positions,t*9+6)]);
  let wet=0;
  for(let t=0;t<cap.owners.length;t++)if(cap.data[t*12+2]===2){
   if(wet++%2)continue;
   const bed=Vector3.FromArray(cap.positions,t*9),top=Vector3.FromArray(cap.positions,t*9+3);
   expect(top.length()).toBeGreaterThanOrEqual(bed.length()-1e-7);
   expect(surfaceEdges.some(([a,b])=>Vector3.Cross(b.subtract(a),bed.subtract(a)).length()<1e-5)).toBe(true);
  }
  expect(wet).toBeGreaterThan(0);
 });
});
