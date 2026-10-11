import {describe,it,expect,vi} from 'vitest';
import {AnimalNavigation,animalLand} from '../src/sim/animalNavigation';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,seedPlanet,totalMass,totalEnthalpy,react} from '../src/sim/model';
import {REFERENCE_EDGE} from '../src/sim/materialPhysics';
import {INVALID,NEIGHBORS,createSphere,type SphereGrid} from '../src/sim/sphere';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import {LandAnimals} from '../src/render/animals';
const environment={ambient:22,sunlight:0,sun:[0,1,0]};
function graph(count:number,edges:number[][]):SphereGrid {
 const neighbors=new Uint32Array(count*NEIGHBORS).fill(INVALID),distances=new Float32Array(count*NEIGHBORS),directions=new Float32Array(count*3),geometry=new Float32Array(count*4),adj=Array.from({length:count},()=>[] as number[]);
 for(const [a,b] of edges){adj[a].push(b);adj[b].push(a);}
 for(let i=0;i<count;i++){directions.set([Math.sin(i*.1),Math.cos(i*.1),0],i*3);geometry.set([...directions.subarray(i*3,i*3+3),0],i*4);adj[i].forEach((j,k)=>{neighbors[i*NEIGHBORS+k]=j;distances[i*NEIGHBORS+k]=REFERENCE_EDGE;});}
 return {count,neighbors,distances,directions,geometry,indices:new Uint32Array()};
}
function world(grid:SphereGrid){const s=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++){s[i*STRIDE+F.temperature]=22;s[i*STRIDE+F.soil]=1;s[i*STRIDE+F.water]=.02;}return s;}
function path(nav:AnimalNavigation,kind:number,from:number){const result=[from];for(let n=0;n<nav.grid.count;n++){const next=nav.next[kind][from];if(next<0)return result;expect(result).not.toContain(next);result.push(next);from=next;}throw Error('Navigation cycle');}

describe('land guild navigation and conservative movement',()=>{
 it('routes grazers around water and distinguishes retained moisture from a sea',()=>{
  const grid=graph(5,[[0,1],[1,2],[2,4],[0,3],[3,4]]),s=world(grid),nav=new AnimalNavigation(grid);s[F.herbivore]=1;s[4*STRIDE+F.plant]=4;s[3*STRIDE+F.water]=3;
  nav.plan(s);expect(path(nav,0,0)).toEqual([0,1,2,4]);expect(animalLand(.3,10,0)).toBe(true);expect(animalLand(.3,0,0)).toBe(false);expect(animalLand(0,0,.1)).toBe(false);
 });
 it('chooses a safer grazer route when both paths lead to the same food',()=>{
  const grid=graph(4,[[0,1],[1,3],[0,2],[2,3]]),s=world(grid),nav=new AnimalNavigation(grid);s[F.herbivore]=1;s[3*STRIDE+F.plant]=4;s[STRIDE+F.carnivore]=10;
  nav.plan(s);expect(path(nav,0,0)).toEqual([0,2,3]);
 });
 it('hunts reachable prey, without selecting a larger herd on an isolated island',()=>{
  const grid=graph(6,[[0,1],[1,2],[0,3],[3,4],[4,5]]),s=world(grid),nav=new AnimalNavigation(grid);s[F.carnivore]=1;s[2*STRIDE+F.herbivore]=1;s[5*STRIDE+F.herbivore]=50;s[3*STRIDE+F.water]=3;
  nav.plan(s);expect(nav.goals[1][0]).toBe(2);expect(path(nav,1,0)).toEqual([0,1,2]);
 });
 it('keeps isolated animals on their island and recalculates after a land bridge opens',()=>{
  const grid=graph(3,[[0,1],[1,2]]),s=world(grid),nav=new AnimalNavigation(grid);s[F.herbivore]=2;s[2*STRIDE+F.plant]=5;s[STRIDE+F.water]=3;
  const before=s.slice();nav.move(s,1,environment,new Float32Array(grid.count*4));expect(s).toEqual(before);expect(nav.next[0][0]).toBe(-1);
  s[STRIDE+F.water]=.02;nav.plan(s);expect(path(nav,0,0)).toEqual([0,1,2]);
 });
 it('moves both guilds toward food with nonnegative stocks, preserved mass and transported heat',()=>{
  const grid=graph(5,[[0,1],[0,2],[1,3],[2,3],[3,4]]),s=world(grid),nav=new AnimalNavigation(grid),energy=new Float32Array(grid.count*4);
  s[F.herbivore]=10;s[F.carnivore]=2;s[4*STRIDE+F.plant]=4;s[3*STRIDE+F.herbivore]=2;for(let i=0;i<grid.count;i++)s[i*STRIDE+F.temperature]=18+i*2;
  const mass=totalMass(s),heat=totalEnthalpy(s);nav.move(s,100,environment,energy);
  expect(s[F.herbivore]).toBeLessThan(10);expect(s[STRIDE+F.herbivore]).toBeGreaterThan(0);expect(s[STRIDE+F.carnivore]).toBeGreaterThan(0);expect(s.every(Number.isFinite)).toBe(true);
  for(let i=0;i<grid.count;i++)for(const f of [F.herbivore,F.carnivore])expect(s[i*STRIDE+f]).toBeGreaterThanOrEqual(0);
  expect(totalMass(s)).toBeCloseTo(mass,5);expect(totalEnthalpy(s)-heat).toBeCloseTo(energy.reduce((a,b)=>a+b,0),5);
  const paused=s.slice();nav.move(s,0,environment,energy);expect(s).toEqual(paused);
 });
 it('keeps real solver movement off water and fatal-temperature destinations',()=>{
  const grid=createSphere(2),s=seedPlanet(grid,'rock',22,'none');grid.geometry.fill(0);for(let i=0;i<grid.count;i++){s[i*STRIDE+F.rock]=10;s[i*STRIDE+F.soil]=1;s[i*STRIDE+F.water]=.02;}
  s[F.herbivore]=2;s[F.carnivore]=1;const neighbors=[...grid.neighbors.subarray(0,6)].filter(i=>i!==INVALID),wet=neighbors[0],fatal=neighbors[1],land=neighbors[2];s[wet*STRIDE+F.water]=100;s[fatal*STRIDE+F.temperature]=1000;s[land*STRIDE+F.plant]=5;
  const solver=new CpuSolver(grid,s),mass=totalMass(s);solver.advance(.1,new Float32Array(grid.count*COMMAND_STRIDE),environment);
  expect(solver.state[wet*STRIDE+F.herbivore]).toBe(0);expect(solver.state[wet*STRIDE+F.carnivore]).toBe(0);expect(solver.state[fatal*STRIDE+F.herbivore]).toBe(0);expect(solver.state[land*STRIDE+F.herbivore]).toBeGreaterThan(0);expect(totalMass(solver.state)).toBeCloseTo(mass,4);
 });
});

describe('walking guild representatives',()=>{
 it('reports actual consumption without changing the food web and animates feeding only while running',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),grid=graph(1,[]),root=new TransformNode('root',scene),s=world(grid);
  try{
   s[F.plant]=4;s[F.herbivore]=1;s[F.carnivore]=.5;s[F.water]=.3;s[F.soil]=10;s[F.nitrogen]=.3;
   const expected=s.slice(),fed=s.slice(),feeding=new Float32Array(2);react(expected,0,.1,environment,grid);react(fed,0,.1,environment,grid,undefined,undefined,undefined,undefined,feeding);
   expect(fed).toEqual(expected);expect(feeding[0]).toBeGreaterThan(0);expect(feeding[1]).toBeGreaterThan(0);
   const animals=new LandAnimals(scene,root,grid);animals.update(s,new Float32Array(1).fill(1));const original=s.slice();
   const matrices=()=>scene.meshes.map(mesh=>[...(mesh as unknown as {_thinInstanceDataStorage:{matrixData:Float32Array}})._thinInstanceDataStorage.matrixData.slice(0,16)]),before=matrices();
   animals.feed(feeding,0);animals.animate(.05,1);expect(matrices()).toEqual(before);
   animals.feed(feeding,.1);animals.animate(.05,1);expect(matrices()).not.toEqual(before);expect(s).toEqual(original);
   const eating=matrices();for(let n=0;n<20;n++)animals.animate(.05,0);expect(matrices()).toEqual(eating);
   for(let n=0;n<100;n++)animals.animate(.05,1);expect(matrices()[0][13]).toBeCloseTo(before[0][13],5);
   const empty=s.slice(),noFood=new Float32Array(2);empty[F.plant]=0;react(empty,0,.1,environment,grid,undefined,undefined,undefined,undefined,noFood);expect(noFood[0]).toBe(0);expect(noFood[1]).toBeGreaterThan(0);
  }finally{scene.dispose();engine.dispose();}
 });
 it('walks across dry cells, pauses, and removes flooded or erased representatives without changing stock',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),grid=createSphere(2),root=new TransformNode('root',scene),s=world(grid),radii=new Float32Array(grid.count).fill(5);
  try{
   const animals=new LandAnimals(scene,root,grid);s[F.herbivore]=1;s[F.carnivore]=1;s[grid.neighbors[0]*STRIDE+F.plant]=4;const before=s.slice();animals.update(s,radii);
   const bodies=['grazing populations','predator populations'].map(name=>scene.getMeshByName(name)! as Mesh),positions=()=>bodies.map(m=>Vector3.FromArray((m as unknown as {_thinInstanceDataStorage:{matrixData:Float32Array}})._thinInstanceDataStorage.matrixData,12));
   const start=positions();for(let n=0;n<80;n++)animals.animate(.05,1);const moved=positions();for(let k=0;k<2;k++)expect(moved[k].subtract(start[k]).length()).toBeGreaterThan(.05);
   animals.animate(.05,0);const paused=positions();for(let n=0;n<20;n++)animals.animate(.05,0);expect(positions()).toEqual(paused);expect(s).toEqual(before);
   s[F.water]=3;animals.update(s,radii);expect(bodies.every(m=>!m.isEnabled())).toBe(true);s[F.water]=.02;s[F.herbivore]=0;s[F.carnivore]=0;animals.update(s,radii);expect(bodies.every(m=>m.thinInstanceCount===0)).toBe(true);
  }finally{scene.dispose();engine.dispose();}
 });
 it('bounds dense animal draw buffers independently of the number of populated cells',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),grid=createSphere(4),root=new TransformNode('root',scene),s=world(grid);
  try{
   const animals=new LandAnimals(scene,root,grid);for(let i=0;i<grid.count;i++){s[i*STRIDE+F.herbivore]=1;s[i*STRIDE+F.carnivore]=1;}
   animals.update(s,new Float32Array(grid.count).fill(5));animals.animate(.05,1);
   for(const name of ['grazing populations','predator populations'])expect((scene.getMeshByName(name)! as Mesh).thinInstanceCount).toBe(256);
   expect(scene.meshes).toHaveLength(2);
   const triangles=scene.meshes.map(m=>m.getTotalIndices()/3);expect(triangles).toEqual([120,8]);
   for(let kind=0;kind<2;kind++){
    const positions=scene.meshes[kind].getVerticesData('position')!,normals=scene.meshes[kind].getVerticesData('normal')!;let outward=0;
    for(let i=0;i<positions.length;i+=3)outward+=positions[i]*normals[i]+(positions[i+1]-(kind===0?.24:.19))*normals[i+1]+positions[i+2]*normals[i+2];
    expect(outward).toBeGreaterThan(0);
   }
   for(const mesh of scene.meshes){const data=(mesh as unknown as {_thinInstanceDataStorage:{matrixData:Float32Array}})._thinInstanceDataStorage.matrixData;expect(data.byteLength).toBe(256*16*4);}
  }finally{scene.dispose();engine.dispose();}
 });
 it('keeps the nose aligned with travel, turns gradually, and holds its heading on arrival',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),grid=graph(2,[[0,1]]),root=new TransformNode('root',scene),s=world(grid),radii=new Float32Array(2).fill(1);
  try{
   const animals=new LandAnimals(scene,root,grid);s[F.herbivore]=1;s[STRIDE+F.plant]=4;animals.update(s,radii);
   const mesh=scene.getMeshByName('grazing populations')! as Mesh,data=()=> (mesh as unknown as {_thinInstanceDataStorage:{matrixData:Float32Array}})._thinInstanceDataStorage.matrixData;
   const nose=()=>Vector3.FromArray(data(),8).normalize(),position=()=>Vector3.FromArray(data(),12);let previous=nose(),oldPosition=position(),movedAligned=false;
   for(let n=0;n<100;n++){
    animals.animate(.05,1);const current=nose(),nextPosition=position(),delta=nextPosition.subtract(oldPosition);
    expect(Vector3.Dot(previous,current)).toBeGreaterThan(Math.cos(.16));
    if(delta.length()>.0001){const alignment=Vector3.Dot(current,delta.normalize());expect(alignment).toBeGreaterThan(.75);if(alignment>.97)movedAligned=true;}
    previous=current;oldPosition=nextPosition;
   }
   expect(movedAligned).toBe(true);
   animals.animate(.05,0);const paused=[...data()],upload=vi.spyOn(mesh,'thinInstanceBufferUpdated');for(let n=0;n<20;n++)animals.animate(.05,0);
   expect([...data()]).toEqual(paused);expect(upload).not.toHaveBeenCalled();
   animals.update(s,radii);expect([...data()]).toEqual(paused);
  }finally{scene.dispose();engine.dispose();}
 });
 it('does not visually wander into fatal or salt-blocked land when food routes are absent',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),grid=graph(3,[[0,1],[0,2]]),root=new TransformNode('root',scene),s=world(grid);
  try{
   const animals=new LandAnimals(scene,root,grid);s[F.herbivore]=1;s[F.carnivore]=1;s[STRIDE+F.temperature]=1000;s[2*STRIDE+F.dissolved]=1;animals.update(s,new Float32Array(3).fill(1));
   const positions=()=>scene.meshes.map(mesh=>[...(mesh as unknown as {_thinInstanceDataStorage:{matrixData:Float32Array}})._thinInstanceDataStorage.matrixData.slice(12,15)]),start=positions();
   for(let n=0;n<100;n++)animals.animate(.05,1);expect(positions()).toEqual(start);
  }finally{scene.dispose();engine.dispose();}
 });
});
