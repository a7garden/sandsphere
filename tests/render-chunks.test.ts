import {describe,it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE} from '../src/sim/model';
import {CloudBanks} from '../src/render/cloudBanks';
import {CloudEnvelopeField,cloudComponents} from '../src/render/cloudEnvelope';
import {CloudEnvelopeGeometry,cloudRadius,cloudCoverage,cloudLobe} from '../src/render/cloudEnvelopeGeometry';
import {CLOUD_PROFILES} from '../src/render/cloudProfiles';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import {CloudRegionField} from '../src/render/cloudRegions';
import {Biosphere} from '../src/render/biosphere';
import {softHull} from '../src/render/softHull';

describe('stylized population rendering',()=>{
 it('tracks localized water and ice, position and footprint without diluting isolated clouds',()=>{
  const grid=createSphere(4),field=new CloudRegionField(grid),state=new Float32Array(grid.count*STRIDE),radii=new Float32Array(grid.count).fill(5);
  state[17*STRIDE+F.cloud]=.002;state[18*STRIDE+F.cloudIce]=.2;radii[17]=6;
  const before=state.slice(),samples=field.sample(state,radii),wet=samples.filter(r=>r.mass>0);
  expect(samples.reduce((n,r)=>n+r.cells,0)).toBe(grid.count);expect(samples.reduce((n,r)=>n+r.mass,0)).toBeCloseTo(.202,7);
  const isolated=wet.find(r=>r.ice===0)!;
  expect(isolated.mass).toBeCloseTo(.002,7);expect(isolated.density).toBeGreaterThan(.16);expect(isolated.coverage).toBeGreaterThan(0);expect(isolated.ground).toBe(6);
  for(let k=0;k<3;k++)expect(isolated.direction[k]).toBeCloseTo(grid.directions[17*3+k],6);
  state[17*STRIDE+F.cloud]=.2;
  const increased=field.sample(state,radii)[isolated.id];expect(increased.coverage).toBeGreaterThan(isolated.coverage);expect(increased.density).toBeGreaterThan(isolated.density);
  state[17*STRIDE+F.cloud]=0;state[1000*STRIDE+F.cloud]=.002;
  const moved=field.sample(state,radii);expect(moved[isolated.id].mass).toBe(0);
  const destination=moved.find(r=>r.mass>0&&r.ice===0)!;expect(destination.id).not.toBe(isolated.id);
  for(let k=0;k<3;k++)expect(destination.direction[k]).toBeCloseTo(grid.directions[1000*3+k],6);
  state.set(before);expect(field.sample(state,radii).reduce((n,r)=>n+r.ice,0)).toBeCloseTo(.2,7);expect(state).toEqual(before);
 });
 it('joins dense neighboring clouds into one shared envelope without changing stock',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),grid=createSphere(4),root=new TransformNode('root',scene);
  try{
   const clouds=new CloudBanks(scene,root,grid),state=new Float32Array(grid.count*STRIDE),radii=new Float32Array(grid.count).fill(5);
   for(let i=0;i<grid.count;i++)state[i*STRIDE+F.cloud]=.2;
   const before=state.slice();clouds.update(state,radii);
   expect(clouds.stats().cloudRenderer).toBe('connected-cloud-envelope');expect(clouds.stats().cloudBanks).toBe(1);expect(clouds.stats().cloudConnectedCells).toBe(grid.count);
   expect(clouds.stats().cloudDraws).toBe(1);expect(scene.meshes).toHaveLength(1);
   const mesh=scene.meshes[0],indices=mesh.getIndices()!;
   const geometry=new CloudEnvelopeGeometry(grid);
   expect(mesh.getTotalVertices()).toBe(geometry.surface.count*2);expect(mesh.getTotalIndices()).toBe(grid.indices.length*8);
   // Refined neighboring faces still share their vertex IDs; there are no object rims.
   expect(Array.from(indices)).toEqual(Array.from(geometry.indices));
   expect(mesh.getVerticesData('cloudNextNormal')!.every(Number.isFinite)).toBe(true);
   const data=mesh.getVerticesData('cloudNext')!;
   for(let i=0;i<grid.count;i++)expect(data[i*4+3]).toBe(state[i*STRIDE+F.cloud]);
   for(const style of ['stratus','faceted','cumulus'] as const){clouds.setStyle(style);clouds.setAppearance(true,.84);expect(clouds.stats().cloudRenderedMass).toBeCloseTo(grid.count*.2,4);expect(state).toEqual(before);}
   clouds.setVisible(false);expect(clouds.stats().cloudDraws).toBe(0);clouds.setVisible(true);expect(clouds.stats().cloudDraws).toBe(1);
   state.fill(0);clouds.update(state,radii);clouds.animate(1);expect(clouds.stats().cloudBanks).toBe(0);expect(clouds.stats().cloudDraws).toBe(0);
  }finally{scene.dispose();engine.dispose();}
 });
 it('preserves mass differences and clear gaps while softening cell-scale height steps',()=>{
  const grid=createSphere(4),field=new CloudEnvelopeField(grid),state=new Float32Array(grid.count*STRIDE),radii=new Float32Array(grid.count).fill(5);
  const adjacent=grid.neighbors[0];state[F.cloud]=.6;state[adjacent*STRIDE+F.cloud]=.02;state[1000*STRIDE+F.cloudIce]=.4;radii[0]=5.3;
  const before=state.slice(),result=field.sample(state,radii);
  expect(result[0]+result[1]).toBeGreaterThan(result[adjacent*4]+result[adjacent*4+1]);
  expect(result[3]).toBe(state[F.cloud]);expect(result[adjacent*4+3]).toBe(state[adjacent*STRIDE+F.cloud]);
  expect(result.reduce((sum,v,i)=>sum+(i%4<2?v:0),0)).toBeCloseTo(1.02,6);expect(result[2]).toBeGreaterThanOrEqual(radii[0]);
  expect(cloudComponents(grid,result).count).toBe(2);expect(state).toEqual(before);
  state[1000*STRIDE+F.cloudIce]=0;expect(cloudComponents(grid,field.sample(state,radii)).count).toBe(1);
 });
 it('lifts and rounds the envelope while keeping amount-driven relief and a shared smooth silhouette',()=>{
  const grid=createSphere(2),geometry=new CloudEnvelopeGeometry(grid),field=new Float32Array(grid.count*4),expanded=new Float32Array(geometry.layers.length*4),normals=new Float32Array(geometry.positions.length);
  for(let i=0;i<grid.count;i++)field.set([.2,0,5,.2],i*4);
  const before=field.slice();geometry.expand(field,expanded);geometry.normals(expanded,.65,normals);
  expect(field).toEqual(before);expect(normals.every(Number.isFinite)).toBe(true);
  for(let i=grid.count;i<geometry.surface.count;i++){const a=geometry.surface.parents[i*2],b=geometry.surface.parents[i*2+1];expect(expanded[i*4]).toBeCloseTo((field[a*4]+field[b*4])*.5,7);}
  const bottom=cloudRadius(5,.6,1,0,0,0,.65),thin=cloudRadius(5,.02,1,0,0,1,.65),dense=cloudRadius(5,.6,1,0,0,1,.65);
  expect(bottom-5).toBeCloseTo(.24);expect(dense).toBeGreaterThan(thin);expect(dense-bottom).toBeGreaterThan(.1);
  expect(cloudRadius(5,0,1,0,0,1,.65)).toBe(bottom);
  // Smooth vertex normals face outwards and are shared across adjacent triangles.
  for(let i=0;i<geometry.surface.count;i++){const p=i*3;expect(normals[p]*geometry.positions[p]+normals[p+1]*geometry.positions[p+1]+normals[p+2]*geometry.positions[p+2]).toBeGreaterThan(.7);}
 });
 it('concentrates visible stock into connected lobes instead of a uniform veil, with monotonic amount response',()=>{
  const grid=createSphere(4),geometry=new CloudEnvelopeGeometry(grid);let thin=0,dense=0,min=Infinity,max=-Infinity;
  for(let i=0;i<geometry.surface.count;i++){
   const p=i*3,x=geometry.positions[p],y=geometry.positions[p+1],z=geometry.positions[p+2],lobe=geometry.lobes[i];
   expect(cloudCoverage(0,lobe)).toBe(0);
   let previous=0,previousRadius=5.24;
   for(const mass of [.01,.05,.15,.3,.6]){const cover=cloudCoverage(mass,lobe),radius=cloudRadius(5,mass,x,y,z,1,.65,lobe);expect(cover).toBeGreaterThanOrEqual(previous);expect(radius).toBeGreaterThanOrEqual(previousRadius);previous=cover;previousRadius=radius;}
   thin+=cloudCoverage(.05,lobe);dense+=cloudCoverage(.3,lobe);const height=cloudRadius(5,.3,x,y,z,1,.65,lobe)-5.24;min=Math.min(min,height);max=Math.max(max,height);
  }
  expect(thin/geometry.surface.count).toBeLessThan(.3);expect(dense/geometry.surface.count).toBeGreaterThan(.95);
  expect(max-min).toBeGreaterThan(.01);expect(max-min).toBeLessThan(.09);
  expect(Math.min(...geometry.lobes)).toBeLessThan(.3);expect(Math.max(...geometry.lobes)).toBeGreaterThan(.7);
  // Static shared vertices keep bank relief stable when the simulation is paused.
  expect(new CloudEnvelopeGeometry(grid).lobes).toEqual(geometry.lobes);
 });
 it('offers distinct styles with the same actual stocks and monotonic cloud amount',()=>{
  const grid=createSphere(2),geometry=new CloudEnvelopeGeometry(grid),field=new Float32Array(grid.count*4),expanded=new Float32Array(geometry.layers.length*4),normals=new Float32Array(geometry.positions.length);
  for(let i=0;i<grid.count;i++)field.set([.2,.03,5,.23],i*4);
  const before=field.slice(),radii:number[]=[];
  for(const profile of [CLOUD_PROFILES.stratus,CLOUD_PROFILES.cumulus,CLOUD_PROFILES.faceted]){
   geometry.setProfile(profile);geometry.expand(field,expanded);geometry.normals(expanded,.65,normals);
   expect(normals.every(Number.isFinite)).toBe(true);expect(field).toEqual(before);
   const lobe=cloudLobe(1,0,0,profile);let cover=0,radius=5+profile.lift;
   for(const mass of [0,.01,.05,.15,.3,.6]){const nextCover=cloudCoverage(mass,lobe,profile),nextRadius=cloudRadius(5,mass,1,0,0,1,.65,lobe,profile);expect(nextCover).toBeGreaterThanOrEqual(cover);expect(nextRadius).toBeGreaterThanOrEqual(radius);cover=nextCover;radius=nextRadius;}
   radii.push(radius);
   expect(geometry.setProfile(profile)).toBe(false);
  }
  expect(radii[1]-radii[0]).toBeGreaterThan(.1);expect(new Set(radii).size).toBe(3);
 });
 it('interpolates from the displayed field and fades disappearing connected clouds',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),grid=createSphere(2),root=new TransformNode('root',scene);
  try{
   const clouds=new CloudBanks(scene,root,grid),state=new Float32Array(grid.count*STRIDE),radii=new Float32Array(grid.count).fill(5);
   clouds.update(state,radii);state[F.cloud]=.2;clouds.update(state,radii);clouds.animate(.06);
   const mesh=scene.meshes[0],targets=mesh.getVerticesData('cloudNext')!.slice();state[F.cloud]=.4;clouds.update(state,radii);
   const previous=mesh.getVerticesData('cloudPrevious')!;
   for(let i=0;i<targets.length;i++)if(i%4!==2)expect(previous[i]).toBeCloseTo(targets[i]*.5,6);
   clouds.animate(1);state.fill(0);clouds.update(state,radii);expect(clouds.stats().cloudDraws).toBe(1);
   clouds.animate(1);expect(clouds.stats().cloudDraws).toBe(0);
  }finally{scene.dispose();engine.dispose();}
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
