import {describe,expect,it} from 'vitest';
import {advanceProgress,expeditionStates,freshProgress,restockLifeSamples} from '../src/sim/progress';
import {F,STRIDE,COMMAND_STRIDE,COMMAND_FIELD,emptyStock,CpuSolver,seedPlanet,totals,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {orbitalEnvironment} from '../src/sim/orbit';
import {snapshotSurface} from '../src/sim/session';
import {heatForTarget} from '../src/sim/toolHeat';
import type {PlanetRecord} from '../src/sim/system';
const grid=createSphere(0);
function planet(id='planet-1'):PlanetRecord{
 const snapshot:Snapshot={version:3,preset:'coast',time:0,state:[...seedPlanet(grid,'rock',22,'none')],discoveries:[],supplied:0,removed:0,environment:orbitalEnvironment(1)};
 return {id,name:id,snapshot};
}
describe('campaign goals and supply',()=>{
 it('accepts exact water thresholds and includes cloud ice on the same planet',()=>{
  const p=planet(),progress=freshProgress();p.snapshot.state[F.vapor]=1;p.snapshot.state[F.cloudIce]=.1;
  expect(advanceProgress(progress,[p],emptyStock())).toContain('water');
 });
 it('never combines separate planets for water, garden, grazer, or the food web',()=>{
  const a=planet(),b=planet('planet-2'),progress=freshProgress();
  a.snapshot.state[F.vapor]=2;b.snapshot.state[F.cloud]=1;
  a.snapshot.state[F.plant]=5;b.snapshot.state[F.plant]=5;
  a.snapshot.state[F.herbivore]=3;b.snapshot.state[F.herbivore]=2;
  b.snapshot.state[F.carnivore]=.2;b.snapshot.state[F.plant]=1;
  expect(advanceProgress(progress,[a,b],emptyStock())).toEqual([]);
  const water=expeditionStates(progress,[a,b],emptyStock()).find(s=>s.id==='water')!;
  expect(water.metrics.every(m=>m.current>=m.target)).toBe(false);
 });
 it('combines crafted products in worlds and the shared inventory',()=>{
  const p=planet(),stock=emptyStock();p.snapshot.state[F.ceramic]=.6;stock.ceramic=.4;stock.glass=1;
  expect(advanceProgress(freshProgress(),[p],stock)).toEqual(['kiln','glass']);
 });
 it('gates animal goals behind sample rewards and grants each reward once',()=>{
  const p=planet(),progress=freshProgress(),stock=emptyStock();p.snapshot.state[F.herbivore]=5;p.snapshot.state[F.carnivore]=1;
  expect(advanceProgress(progress,[p],stock)).toEqual([]);
  p.snapshot.state[F.plant]=9;
  expect(advanceProgress(progress,[p],stock)).toEqual(['garden','grazer','web']);
  expect(stock.herbivore).toBe(4);expect(stock.carnivore).toBe(1);
  p.snapshot.state[F.plant]=0;p.snapshot.state[F.herbivore]=0;
  expect(advanceProgress(progress,[p],stock)).toEqual([]);expect(stock.herbivore).toBe(4);expect(stock.carnivore).toBe(1);
 });
 it('recognizes a warehouse transfer to the third planet but not the first',()=>{
  const a=planet(),b=planet('planet-2'),c=planet('planet-3'),stock=emptyStock();a.snapshot.transferredIn=8;
  expect(advanceProgress(freshProgress(),[a,b,c],stock)).not.toContain('transfer');
  c.snapshot.transferredIn=.2;
  expect(advanceProgress(freshProgress(),[a,b,c],stock)).toContain('transfer');
 });
 it('requires meteor impact and actual collected iron',()=>{
  const p=planet(),progress=freshProgress(),stock=emptyStock();stock.iron=1;
  expect(advanceProgress(progress,[p],stock)).not.toContain('meteor');
  progress.meteorCount=1;stock.iron=0;p.snapshot.state[F.iron]=36;
  expect(advanceProgress(progress,[p],stock)).not.toContain('meteor');
  stock.iron=1;expect(advanceProgress(progress,[p],stock)).toContain('meteor');
 });
 it('retains legacy completion without reissuing rewards',()=>{
  const progress={completed:['web','grazer','garden'],meteorCount:0},stock=emptyStock();
  advanceProgress(progress,[],stock);expect(progress.completed).toEqual(['web','grazer','garden']);expect(stock).toEqual(emptyStock());
 });
 it('restocks only depleted unlocked life, including every inactive planet',()=>{
  const p=planet(),q=planet('planet-2'),progress=freshProgress(),stock=emptyStock();q.snapshot.state[F.plant]=.01;
  expect(restockLifeSamples(progress,[p,q],stock)).toEqual([]);
  q.snapshot.state[F.plant]=0;
  expect(restockLifeSamples(progress,[p,q],stock)).toEqual(['plant']);expect(stock.plant).toBe(8);
  expect(restockLifeSamples(progress,[p,q],stock)).toEqual([]);
  progress.completed.push('garden','grazer');stock.herbivore=.005;q.snapshot.state[F.herbivore]=.006;
  expect(restockLifeSamples(progress,[p,q],stock)).toEqual(['carnivore']);expect(stock.carnivore).toBe(1);expect(stock.herbivore).toBe(.005);
 });
});

describe('campaign recipe reachability with the CPU solver',()=>{
 const environment={...orbitalEnvironment(1),sun:[...grid.directions.slice(0,3)] as [number,number,number]};
 function heatStep(solver:CpuSolver,target:number,dt=.1,climate=false){
  const commands=new Float32Array(grid.count*COMMAND_STRIDE);
  commands[4]=heatForTarget(solver.state,0,target,target>solver.state[F.temperature]?'heat':'cool',commands,undefined,climate);
  solver.advance(dt,commands,{...environment,climate});
 }
 it('reaches the water-cycle goal by boiling supplied water in layered atmosphere',()=>{
  const waterGrid=createSphere(2),state=seedPlanet(waterGrid,'rock',22,'nitrogen');for(let i=0;i<waterGrid.count;i++)state[i*STRIDE+F.water]=5;
  const solver=new CpuSolver(waterGrid,state),p=planet(),progress=freshProgress(),stock=emptyStock(),e={...orbitalEnvironment(1),climate:true};
  for(let n=0;n<240&&!progress.completed.includes('water');n++){
   const commands=new Float32Array(waterGrid.count*COMMAND_STRIDE);
   for(let i=0;i<waterGrid.count;i++)commands[i*COMMAND_STRIDE+4]=heatForTarget(solver.state,i,150,'heat',commands,undefined,true);
   solver.advance(.05,commands,e);p.snapshot.state=[...solver.state];advanceProgress(progress,[p],stock);
  }
  expect(progress.completed).toContain('water');
 });
 it('fires supplied dry clay after 30 planet minutes and collects real ceramic',()=>{
  const state=seedPlanet(grid,'rock',22,'none');state[F.clay]=3;const solver=new CpuSolver(grid,state);
  heatStep(solver,950,0);expect(solver.state[F.ceramic]).toBe(0);expect(solver.state[F.firing]).toBe(0);
  for(let n=0;n<310;n++)heatStep(solver,950);
  expect(totals(solver.state)[F.ceramic]).toBeGreaterThanOrEqual(1);
  const commands=new Float32Array(grid.count*COMMAND_STRIDE);commands[6]=1;
  expect(snapshotSurface(solver.state,commands,[]).collected.ceramic).toBeGreaterThanOrEqual(1);
 });
 it('melts supplied sand and cools it into collectible glass',()=>{
  const state=seedPlanet(grid,'rock',22,'none');state[F.sand]=3;const solver=new CpuSolver(grid,state);
  for(let n=0;n<20;n++)heatStep(solver,1900);
  expect(totals(solver.state)[F.molten]).toBeGreaterThanOrEqual(1);
  for(let n=0;n<20;n++)heatStep(solver,1000);
  const commands=new Float32Array(grid.count*COMMAND_STRIDE);commands[6]=1;
  expect(snapshotSurface(solver.state,commands,[]).collected.glass).toBeGreaterThanOrEqual(1);
 });
 it.each([false,true])('grows the initial vegetation and herbivore samples to their goals (layered climate %s)',climate=>{
  const state=seedPlanet(grid,'rock',22,'none');
  const lit=Array.from({length:grid.count},(_,i)=>i).filter(i=>[0,1,2].reduce((sum,k)=>sum+grid.directions[i*3+k]*environment.sun[k],0)>.4);
  for(const i of lit){state[i*STRIDE+F.plant]=8/lit.length;state[i*STRIDE+F.soil]=30/lit.length;state[i*STRIDE+F.water]=.12;}
  const solver=new CpuSolver(grid,state),progress=freshProgress(),stock=emptyStock(),p=planet();
  const sync=()=>{p.snapshot.state=[...solver.state];return advanceProgress(progress,[p],stock);};
  // Finite photons limit growth; the old three-second unlimited-growth recipe is gone.
  for(let n=0;n<800&&totals(solver.state)[F.plant]<9.01;n++){
   const heat=new Float32Array(grid.count*COMMAND_STRIDE);for(const i of lit){heat[i*COMMAND_STRIDE+COMMAND_FIELD.water]=Math.max(0,.12-solver.state[i*STRIDE+F.water]);heat[i*COMMAND_STRIDE+4]=heatForTarget(solver.state,i,22,22>solver.state[i*STRIDE+F.temperature]?'heat':'cool',heat,undefined,climate);}
   solver.advance(.1,heat,{...environment,climate});
  }
  expect(totals(solver.state)[F.plant]).toBeGreaterThanOrEqual(9);expect(sync()).toContain('garden');expect(stock.herbivore).toBe(4);
  const commands=new Float32Array(grid.count*COMMAND_STRIDE);for(const i of lit)commands[i*COMMAND_STRIDE+COMMAND_FIELD.herbivore]=4/lit.length;solver.advance(0,commands,{...environment,climate});stock.herbivore=0;
  for(let n=0;n<200;n++)heatStep(solver,22,.03,climate);
  expect(sync()).toContain('grazer');expect(stock.carnivore).toBe(1);
  commands.fill(0);commands[COMMAND_FIELD.carnivore]=.2;solver.advance(0,commands,{...environment,climate});stock.carnivore-=.2;
  expect(sync()).toContain('web');
 });
});
