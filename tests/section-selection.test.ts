import {describe,it,expect} from 'vitest';
import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import {arcFromBasis,arcFromEndpoints,clipSectionWindow,snapSectionEndpoint} from '../src/render/sectionArc';
import {buildSectionMesh,triangleSection} from '../src/render/sectionGeometry';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE} from '../src/sim/model';

describe('globe section selection',()=>{
 it('keeps a cut through a cell center when float32 geometry is slightly off the plane',()=>{
  const points=[new Vector3(0,6,1e-7),new Vector3(-1,6,.001),new Vector3(.5,6.2,-.001)],hits=triangleSection(points,Vector3.Forward(),0);
  expect(hits).toHaveLength(2);expect(hits.some(p=>Vector3.Distance(p,points[0])<1e-8)).toBe(true);
 });
 it('snaps the moved endpoint to a real cell while preserving the stationary cell and length limit',()=>{
  const grid=createSphere(2);
  for(const anchor of [0,5,40,grid.count-1])for(const requested of [0,12,80,grid.count-1]){
   const end=snapSectionEndpoint(grid,anchor,requested),a=Vector3.FromArray(grid.directions,anchor*3).normalize(),b=Vector3.FromArray(grid.directions,end*3).normalize();
   expect(end).not.toBe(anchor);expect(Vector3.Dot(a,b)).toBeGreaterThanOrEqual(-.5000001);
   if(requested!==anchor&&Vector3.Dot(a,Vector3.FromArray(grid.directions,requested*3).normalize())>=-.5)expect(end).toBe(requested);
  }
 });
 it('unfolds the complete selected end cell instead of cutting it in half',()=>{
  const grid=createSphere(1),state=new Float32Array(STRIDE*2),terrain=new Float32Array([-2,6,-1,2,6,1,-2,6,1]),arc=arcFromBasis(Vector3.Right(),Vector3.Up(),.05);state[F.sand]=8;
  const partial=buildSectionMesh(terrain,new Float32Array(18),new Uint32Array([0]),state,grid,arc.normal,.22,undefined,1/30,undefined,true,arc);
  const whole=buildSectionMesh(terrain,new Float32Array(18),new Uint32Array([0]),state,grid,arc.normal,.22,undefined,1/30,undefined,true,{...arc,cells:new Set([0]),wholeCells:true});
  const extent=(cap:typeof whole)=>Math.max(...cap.owners.flatMap((owner,i)=>owner<0?[]:[0,1,2].map(k=>Math.abs(Math.atan2(cap.positions[i*9+k*3],cap.positions[i*9+k*3+1])))));
  expect(extent(partial)).toBeCloseTo(.05,6);expect(extent(whole)).toBeGreaterThan(.15);expect(new Set(whole.owners.filter(i=>i>=0))).toEqual(new Set([0]));
 });
 it('preserves endpoint orientation across poles and longitude seams',()=>{
  for(const v of [Vector3.Up(),Vector3.Down(),new Vector3(-1,.05,-.02).normalize()]){
   const basis=arcFromBasis(Vector3.Right(),v,.4),arc=arcFromEndpoints(basis.a,basis.b);
   expect(Vector3.Distance(arc.a,basis.a)).toBeLessThan(1e-7);expect(Vector3.Distance(arc.b,basis.b)).toBeLessThan(1e-7);
   expect(Vector3.Dot(arc.u,arc.v)).toBeCloseTo(0,8);expect(Vector3.Cross(arc.u,arc.v).equalsWithEpsilon(arc.normal)).toBe(true);
  }
 });
 it('keeps the stationary endpoint and bounds coincident and antipodal drags',()=>{
  const prior=arcFromBasis(Vector3.Right(),Vector3.Up(),.3);
  for(const b of [prior.a,prior.a.scale(-1),Vector3.Right()]){
   const arc=arcFromEndpoints(prior.a,b,prior);expect(Vector3.Distance(arc.a,prior.a)).toBeLessThan(1e-7);
   expect(arc.halfRange).toBeGreaterThanOrEqual(.01);expect(arc.halfRange).toBeLessThanOrEqual(Math.PI/3);
   expect([...arc.u.asArray(),...arc.v.asArray(),...arc.normal.asArray()].every(Number.isFinite)).toBe(true);
  }
  expect(()=>arcFromEndpoints(Vector3.Zero(),Vector3.Up())).toThrow();
 });
 it('clips partial end triangles to the selected arc and excludes the opposite hemisphere',()=>{
  const arc=arcFromBasis(Vector3.Right(),Vector3.Up(),.2),poly=clipSectionWindow([new Vector3(-2,5,0),new Vector3(2,5,0),new Vector3(0,6,0)],arc);
  expect(poly.length).toBeGreaterThan(3);for(const p of poly)expect(Math.abs(Math.atan2(p.x,p.y))).toBeLessThanOrEqual(.200000001);
  expect(clipSectionWindow([new Vector3(-1,-5,0),new Vector3(1,-5,0),new Vector3(0,-6,0)],arc)).toHaveLength(0);
 });
 it('preview and cap use the same physical owners, including refined render samples, without changing state',()=>{
  const grid=createSphere(1),state=new Float32Array(STRIDE*2);state[F.sand]=4;state[STRIDE+F.clay]=7;state[F.temperature]=22;state[STRIDE+F.temperature]=30;
  const terrain=new Float32Array([-2,6,-1,2,6,1,-2,6,1, 2,6,-1,2,6,1,-2,6,-1]),owners=new Uint32Array([0,1]),arc=arcFromBasis(Vector3.Right(),Vector3.Up(),.2),before=state.slice();
  const samples={cellOwners:new Uint32Array([8,9]),baseHeights:new Float32Array(2),solidRadii:new Float32Array([5.1,5.1]),mobileWater:new Float32Array(2)};
  const preview=buildSectionMesh(terrain,new Float32Array(36),owners,state,grid,arc.normal,.22,undefined,1/30,samples,true,arc);
  const ids=new Set(preview.owners.filter(i=>i>=0));expect([...ids].sort()).toEqual([8,9]);
  const cap=buildSectionMesh(terrain,new Float32Array(36),owners,state,grid,arc.normal,.22,undefined,1/30,samples,true,{...arc,cells:ids});expect(cap).toEqual(preview);expect(state).toEqual(before);
  const restricted=buildSectionMesh(terrain,new Float32Array(36),owners,state,grid,arc.normal,.22,undefined,1/30,samples,true,{...arc,cells:new Set([8])});expect(restricted.owners.filter(i=>i>=0).every(i=>i===8)).toBe(true);
 });
 it('keeps owner membership when surface radii change independently',()=>{
  const grid=createSphere(1),state=new Float32Array(STRIDE*2),owners=new Uint32Array([0,1]),arc=arcFromBasis(Vector3.Right(),Vector3.Up(),.2);
  state[F.sand]=8;state[STRIDE+F.sand]=8;
  const points=[new Vector3(-2,6,-1),new Vector3(2,6,1),new Vector3(-2,6,1),new Vector3(2,6,-1),new Vector3(2,6,1),new Vector3(-2,6,-1)];
  const terrain=Float32Array.from(points.flatMap(p=>p.asArray())),changed=Float32Array.from(points.flatMap((p,i)=>p.scale([.82,1.4,1.02,1.15,.86,1.33][i]).asArray()));
  const preview=buildSectionMesh(terrain,new Float32Array(36),owners,state,grid,arc.normal,.22,undefined,1/30,undefined,true,arc),ids=new Set(preview.owners.filter(i=>i>=0));
  const edited=buildSectionMesh(changed,new Float32Array(36),owners,state,grid,arc.normal,.22,undefined,1/30,undefined,true,{...arc,cells:ids});
  expect([...new Set(edited.owners.filter(i=>i>=0))].sort()).toEqual([...ids].sort());expect(edited.positions).not.toEqual(preview.positions);
 });
 it('rotation of the whole arc preserves its length and clipping',()=>{
  const arc=arcFromBasis(Vector3.Right(),Vector3.Up(),.4),rotation=Matrix.RotationYawPitchRoll(2,-1,.7),rotated=arcFromEndpoints(Vector3.TransformNormal(arc.a,rotation),Vector3.TransformNormal(arc.b,rotation));
  expect(rotated.halfRange).toBeCloseTo(arc.halfRange,8);
  const points=[new Vector3(-4,6,0),new Vector3(4,6,0),new Vector3(0,7,0)],expected=clipSectionWindow(points,arc).map(p=>Vector3.TransformNormal(p,rotation)),actual=clipSectionWindow(points.map(p=>Vector3.TransformNormal(p,rotation)),rotated);
  expect(actual.length).toBe(expected.length);actual.forEach((p,i)=>expect(Vector3.Distance(p,expected[i])).toBeLessThan(1e-7));
 });
});
