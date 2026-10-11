import {describe,it,expect} from 'vitest';
import {AnimalNavigation,animalLand} from '../src/sim/animalNavigation';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,seedPlanet,totalMass,totalEnthalpy} from '../src/sim/model';
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
   for(const name of ['walking legs 0','walking legs 1'])expect((scene.getMeshByName(name)! as Mesh).thinInstanceCount).toBe(1024);
  }finally{scene.dispose();engine.dispose();}
 });
});
