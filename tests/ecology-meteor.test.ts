import {describe,it,expect} from 'vitest';
import {habitat,foodWeb} from '../src/sim/ecology';
import {impactMeteor} from '../src/sim/meteor';
import {freshProgress,advanceProgress} from '../src/sim/progress';
import {F,STRIDE,COMMAND_STRIDE,COMMAND_FIELD,capacity,CpuSolver,seedPlanet,totalMass,totals,emptyStock} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {orbitalEnvironment} from '../src/sim/orbit';
import {upgradeSnapshot,validSnapshot} from '../src/sim/storage';
import {migrateWorld} from '../src/sim/system';
import {clipWater,refineSurface,softenShore} from '../src/render/surface';
const grid=createSphere(2);
describe('biomass ecology',()=>{
 it('requires liquid moisture, light, tolerable temperature and low salt',()=>{
  expect(habitat(22,.3,0,0,1)).toBeGreaterThan(.8);
  for(const args of [[22,0,0,0,1],[22,6,0,0,1],[22,.3,0,0,0],[-30,.3,0,0,1],[22,.3,.3,0,1]] as const)expect(habitat(args[0],args[1],args[2],args[3],args[4])).toBe(0);
  expect(habitat(22,.3,0,4,1)).toBeLessThan(.001);
 });
 it('grows and eats while preserving biomass, returning extinction to soil',()=>{
  let stocks:[number,number,number,number]=[20,8,2,1];
  for(let n=0;n<2000;n++)stocks=[...foodWeb(...stocks,n<500?.9:0,.1)];
  expect(stocks.reduce((a,b)=>a+b,0)).toBeCloseTo(31,9);
  expect(stocks.every(n=>n>=0)).toBe(true);expect(stocks[0]).toBeGreaterThan(20);
 });
 it('moves living populations across cells without losing their total mass',()=>{
  const state=seedPlanet(grid,'rock',22,'nitrogen');for(let i=0;i<grid.count;i++){state[i*STRIDE+F.soil]=10;state[i*STRIDE+F.water]=.3;}state[F.plant]=4;state[F.herbivore]=1;
  const solver=new CpuSolver(grid,state),commands=new Float32Array(grid.count*COMMAND_STRIDE),before=totalMass(state);
  for(let n=0;n<100;n++)solver.advance(.1,commands,{...orbitalEnvironment(1),sun:[...grid.directions.slice(0,3)]});
  expect(totalMass(solver.state)).toBeCloseTo(before,3);
  expect(totals(solver.state)[F.plant]).toBeGreaterThan(solver.state[F.plant]);
 });
 it('retains soil moisture for growth without creating water',()=>{
  const state=seedPlanet(grid,'rock',22,'none');state[F.soil]=8;state[F.water]=.8;state[F.plant]=.5;
  const e={...orbitalEnvironment(1),sun:[...grid.directions.slice(0,3)] as [number,number,number]},solver=new CpuSolver(grid,state),c=new Float32Array(grid.count*COMMAND_STRIDE);
  for(let n=0;n<100;n++)solver.advance(.03,c,e);
  expect(solver.state[F.water]).toBeGreaterThan(.3);expect(totals(solver.state)[F.plant]).toBeGreaterThan(.5);
  expect(totalMass(solver.state)).toBeCloseTo(totalMass(state),3);
 });
 it('grants expedition samples once and never on repeated polling',()=>{
  const s={version:3 as const,preset:'coast' as const,time:0,state:[...seedPlanet(grid,'rock',22)],discoveries:[],supplied:0,removed:0,environment:orbitalEnvironment(1)};
  s.state[F.plant]=9;s.state[F.herbivore]=4.2;
  const system=migrateWorld(s,grid.count),progress=freshProgress(),stock=emptyStock();
  advanceProgress(progress,system.planets,stock);expect(stock.herbivore).toBe(4);expect(stock.carnivore).toBe(1);
  advanceProgress(progress,system.planets,stock);expect(stock.herbivore).toBe(4);expect(stock.carnivore).toBe(1);
 });
});
describe('impact and persisted worlds',()=>{
 it('redistributes crater material and adds exactly the incoming mass',()=>{
  const state=seedPlanet(grid,'sand',18),direction=[...grid.directions.slice(0,3)],before=totalMass(state),rock=totals(state)[F.rock];
  const after=impactMeteor(state,grid,direction,36);
  expect(totalMass(after)-before).toBeCloseTo(36,3);expect(totals(after)[F.rock]).toBeCloseTo(rock,4);
  expect(totals(after)[F.iron]).toBeCloseTo(36,4);expect(after[F.temperature]).toBeGreaterThan(state[F.temperature]);
  expect(after[F.sand]).toBeLessThan(state[F.sand]);expect(state[F.iron]).toBe(0);
 });
 it('carries the excavated material heat into the rim',()=>{
  const state=seedPlanet(grid,'sand',18);for(let i=0;i<grid.count;i++)state[i*STRIDE+F.temperature]=i%3?20:150;
  const energy=(s:Float32Array)=>Array.from({length:grid.count},(_,i)=>capacity(s,i)*s[i*STRIDE+F.temperature]).reduce((a,b)=>a+b,0);
  const after=impactMeteor(state,grid,[...grid.directions.slice(0,3)],0);
  expect(Math.abs(energy(after)-energy(state))).toBeLessThan(.005);
 });
 it('extends each 20-field cell separately with no ecological stocks invented',()=>{
  const s={version:2 as const,preset:'coast' as const,time:10,state:Array(40).fill(0),discoveries:[],supplied:0,removed:0,environment:orbitalEnvironment(1)};
  s.state[5]=3;s.state[20+16]=.2;s.state[8]=-20;s.state[28]=18;
  expect(validSnapshot(s,2)).toBe(true);const migrated=upgradeSnapshot(s,2);
  expect(migrated.state.length).toBe(48);expect(migrated.state[5]).toBe(3);expect(migrated.state[STRIDE+16]).toBeCloseTo(.2);
  expect(migrated.state[STRIDE+8]).toBe(18);expect(migrated.state[F.plant]).toBe(0);expect(s.state.length).toBe(40);
 });
 it('rounds coasts while preserving a flat lake head and simulation data',()=>{
  const surface=refineSurface(grid,1),h=Float32Array.from({length:surface.count},(_,i)=>4+surface.directions[i*3]*.5),d=Float32Array.from(h,v=>4.1-v),before=new Float32Array(h);
  softenShore(h,d,surface.neighbors,new Float32Array(h.length),new Float32Array(h.length));
  expect(h.some((v,i)=>v!==before[i])).toBe(true);
  for(let i=0;i<h.length;i++)expect(h[i]+d[i]).toBeCloseTo(4.1,5);
 });
 it('interpolates ice on the same clipped surface as water',()=>{
  const p=clipWater([{x:0,y:0,z:0,depth:0,ice:1},{x:1,y:0,z:0,depth:1,ice:0},{x:0,y:1,z:0,depth:1,ice:.5}],.5);
  expect(p.length).toBe(4);expect(p.every(v=>v.ice!==undefined&&v.ice>=0&&v.ice<=1)).toBe(true);
  expect(p.some(v=>v.depth===.5&&v.ice===.5)).toBe(true);
 });
});
