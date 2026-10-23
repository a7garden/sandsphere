import {describe,it,expect,vi} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {F,STRIDE,seedWorld,totals} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {SurfaceChangeTracker} from '../src/render/surfaceChanges';
import {shorelineDepths} from '../src/render/surface';
import {SectionView} from '../src/render/sectionView';
import {observationSummary} from '../src/ui/observationSummary';

it('separates thermal/atmospheric updates from geometry while observing in-place edits',()=>{
 const state=new Float32Array(STRIDE*2),tracker=new SurfaceChangeTracker();
 expect(Object.values(tracker.read(state)).every(Boolean)).toBe(true);
 expect(Object.values(tracker.read(state)).some(Boolean)).toBe(false);
 state[F.temperature]=800;
 expect(tracker.read(state)).toEqual({geometry:false,water:false,appearance:false,temperature:true,biosphere:true,section:false});
 state[F.cloud]=2;state[F.vapor]=1;
 expect(Object.values(tracker.read(state)).some(Boolean)).toBe(false);
 state[F.water]=2;
 expect(tracker.read(state)).toEqual({geometry:false,water:true,appearance:true,temperature:false,biosphere:true,section:true});
 state[F.rock]=3;expect(tracker.read(state).geometry).toBe(true);
 tracker.reset();expect(Object.values(tracker.read(state)).every(Boolean)).toBe(true);
});

it('overwrites reusable shoreline storage including wet-to-dry changes',()=>{
 const grid=createSphere(1),heights=new Float32Array(grid.count),water=new Float32Array(grid.count),scratch=new Float32Array(grid.count).fill(NaN);
 water[0]=2;heights[grid.neighbors[0]]=3;
 expect(shorelineDepths(grid,heights,water,scratch)).toBe(scratch);
 expect(scratch).toEqual(shorelineDepths(grid,heights,water));
 water.fill(0);shorelineDepths(grid,heights,water,scratch);
 expect([...scratch].every(v=>v===-.25)).toBe(true);
});

describe('retained section topology',()=>{
 it('updates interpolated sample temperatures and precipitation without geometry writes',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('root',scene),grid=createSphere(1),view=new SectionView(scene,root,grid);
  try{
   // Render sample 2 belongs to simulation cell 3. Picking must retain that owner,
   // while the temperature comes from the rendered sample rather than cell 3.
   const state=seedWorld(grid),terrain=new Float32Array([5,0,-1,5,1,1,5,-1,1]),water=new Float32Array(18),owners=new Uint32Array([2]);
   const samples={cellOwners:new Uint32Array([0,1,3]),baseHeights:new Float32Array(3),solidRadii:new Float32Array(3).fill(5),mobileWater:new Float32Array(3)};
   view.update(terrain,water,owners,state,Vector3.Forward(),.22,samples);
   const positions=Array.from(view.mesh.getVerticesData(VertexBuffer.PositionKind)!),indices=Array.from(view.mesh.getIndices()!),ownerBefore=view.cellIds;
   const update=vi.spyOn(view.mesh,'updateVerticesData'),set=vi.spyOn(view.mesh,'setVerticesData');
   state[2*STRIDE+F.temperature]=950;state[3*STRIDE+F.temperature]=-50;
   const precipitation=new Float32Array(grid.count*2);precipitation[3*2+1]=.2;
   view.showRain(true);view.setPrecipitation(precipitation,1/30);view.updateReadings(state);
   expect(update.mock.calls.map(call=>call[0])).toEqual(['sectionData','snowFraction']);expect(set).not.toHaveBeenCalled();
   const readings=view.mesh.getVerticesData('sectionData')!;
   for(let v=0;v<readings.length/4;v++)if(readings[v*4+1]>=0){expect(readings[v*4]).toBe(950);expect(readings[v*4+3]).toBeGreaterThan(0);}
   expect(view.mesh.getVerticesData('snowFraction')!.some(v=>v===1)).toBe(true);
   expect(Array.from(view.mesh.getVerticesData(VertexBuffer.PositionKind)!)).toEqual(positions);expect(Array.from(view.mesh.getIndices()!)).toEqual(indices);expect(view.cellIds).toEqual(ownerBefore);
   update.mockClear();view.updateReadings(state);expect(update).not.toHaveBeenCalled();
   view.setClimateColors(null);update.mockClear();set.mockClear();view.setClimateColors(null);expect(update).not.toHaveBeenCalled();expect(set).not.toHaveBeenCalled();
  }finally{scene.dispose();engine.dispose();}
 });
});

it('shares one summary per explicit physical revision and never caches legacy mutable callers',()=>{
 const grid=createSphere(1),state=seedWorld(grid),before=state.slice(),first=observationSummary(state,undefined,1);
 expect(first.stock).toEqual(totals(state));expect(observationSummary(state,undefined,1)).toBe(first);expect(state).toEqual(before);
 state[F.water]+=2;state[F.temperature]=1234;
 const next=observationSummary(state,undefined,2);expect(next).not.toBe(first);expect(next.stock[F.water]-first.stock[F.water]).toBeCloseTo(2,5);expect(next.max).toBe(1234);
 const legacy=observationSummary(state);state[F.water]+=1;expect(observationSummary(state).stock[F.water]-legacy.stock[F.water]).toBeCloseTo(1,5);
});
