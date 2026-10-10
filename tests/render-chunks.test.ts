import {describe,it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE} from '../src/sim/model';
import {CloudBanks} from '../src/render/cloudBanks';
import {Biosphere} from '../src/render/biosphere';
import {softHull} from '../src/render/softHull';
import {cloudComposition} from '../src/render/cloudComposition';

describe('stylized population rendering',()=>{
 it('varies cloud families without multiplying cover or flickering between updates',()=>{
  const layouts=Array.from({length:42},(_,seed)=>cloudComposition(seed,.8));
  expect(new Set(layouts.map(parts=>parts.length)).size).toBe(4);
  layouts.forEach((parts,seed)=>{
   expect(parts).toEqual(cloudComposition(seed,.8));
   expect(parts.reduce((area,part)=>area+part.width*part.depth,0)).toBeCloseTo(1,8);
   expect(parts.every(part=>part.variant>=0&&part.variant<6)).toBe(true);
   expect(cloudComposition(seed,.1)).toHaveLength(1);
  });
 });
 it('merges overcast regions, hides cleanly, and never changes cloud stock',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),grid=createSphere(2),root=new TransformNode('root',scene);
  const clouds=new CloudBanks(scene,root,grid),state=new Float32Array(grid.count*STRIDE),radii=new Float32Array(grid.count).fill(5);
  for(let i=0;i<grid.count;i++)state[i*STRIDE+F.cloud]=.2;
  const before=state.slice();clouds.update(state,radii);
  expect(clouds.stats().cloudBanks).toBeGreaterThan(0);expect(clouds.stats().cloudBanks).toBeLessThan(42);expect(state).toEqual(before);
  const meshes=scene.meshes.filter(m=>m.name.startsWith('cloud bank'));
  const count=clouds.stats().cloudBanks;
  for(const style of ['stratus','faceted','cumulus'] as const){
   clouds.setStyle(style);expect(clouds.stats().cloudBanks).toBe(count);expect(state).toEqual(before);
   const visible=meshes.filter(m=>m.isEnabled());expect(visible.length).toBeGreaterThan(0);
   expect(visible.every(m=>m.name.includes('facets')===(style==='faceted'))).toBe(true);
   expect(visible.reduce((sum,mesh)=>sum+(mesh as Mesh).thinInstanceCount,0)).toBe(clouds.stats().cloudPieces);
   if(style==='faceted')expect(clouds.stats().cloudPieces).toBeGreaterThan(count);
  }
  clouds.setVisible(false);clouds.setStyle('faceted');expect(meshes.every(m=>!m.isEnabled())).toBe(true);
  clouds.update(state,radii);expect(meshes.every(m=>!m.isEnabled())).toBe(true);
  clouds.setVisible(true);expect(meshes.some(m=>m.isEnabled())).toBe(true);
  state.fill(0);clouds.update(state,radii);expect(clouds.stats().cloudBanks).toBe(0);expect(meshes.every(m=>!m.isEnabled())).toBe(true);
  scene.dispose();engine.dispose();
 });
 it('bounds dense forest decoration by chunks, including uniform plant cover',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),grid=createSphere(4),root=new TransformNode('root',scene);
  const trees=new Biosphere(scene,root,grid),state=new Float32Array(grid.count*STRIDE);
  for(let i=0;i<grid.count;i++){state[i*STRIDE+F.plant]=1;state[i*STRIDE+F.soil]=3;}
  const before=state.slice();trees.update(state,new Float32Array(grid.count).fill(5),0);
  const mesh=scene.meshes.find(m=>m.name==='branching grove')! as Mesh;
  expect(mesh.thinInstanceCount).toBeGreaterThan(42);expect(mesh.thinInstanceCount).toBeLessThanOrEqual(42*28);expect(state).toEqual(before);
  state.fill(0);trees.update(state,new Float32Array(grid.count).fill(5),0);expect(mesh.isEnabled()).toBe(false);
  scene.dispose();engine.dispose();
 });
 it('makes finite outward-facing hulls with the attributes needed for tree merging',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),mesh=softHull('test',[[0,0,0,.6,.3,.4],[-.25,.1,0,.3,.35,.3]],scene);
  for(const kind of [VertexBuffer.PositionKind,VertexBuffer.NormalKind,VertexBuffer.UVKind])expect(mesh.getVerticesData(kind)?.every(Number.isFinite)).toBe(true);
  const p=mesh.getVerticesData(VertexBuffer.PositionKind)!,n=mesh.getVerticesData(VertexBuffer.NormalKind)!;
  for(let i=0;i<p.length;i+=3)expect(p[i]*n[i]+p[i+1]*n[i+1]+p[i+2]*n[i+2]).toBeGreaterThan(0);
  scene.dispose();engine.dispose();
 });
});
