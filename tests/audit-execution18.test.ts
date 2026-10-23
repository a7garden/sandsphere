import {describe,expect,it} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,COMMAND_FIELD,seedPlanet,emptyStock,totals,type Environment,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {orbitalEnvironment} from '../src/sim/orbit';
import {createCommandBatch} from '../src/sim/supply';
import {PHYSICS_DT} from '../src/sim/clock';
import {validSnapshot} from '../src/sim/storage';
import {prepareSystemSave,type PlanetRecord} from '../src/sim/system';
import {advanceProgress,expeditionStates,freshProgress,observeCampaignPlanets} from '../src/sim/progress';
import {heatForTarget} from '../src/sim/toolHeat';

const root='artifacts/regressions-alpha18';
function evidence(name:string,value:unknown){mkdirSync(root,{recursive:true});writeFileSync(`${root}/${name}.json`,JSON.stringify(value,null,2));}
function snapshot(solver:CpuSolver,environment:Environment,time=0):Snapshot{return {version:11,preset:'coast',state:[...solver.state],climate:solver.climate.snapshot(),time,environment,planet:{primary:'rock'},supplied:0,removed:0,discoveries:[]};}

describe.skipIf(process.env.AUDIT_ALPHA17!=='1')('alpha.18 execution regressions from the alpha.17 audit',()=>{
 it('accepts normal supply across the save-only per-material ceiling',()=>{
  const grid=createSphere(0),state=seedPlanet(grid,'rock',20,'none'),environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true,body:sandboxDefinition('rock')};
  state[F.sand]=99999;const solver=new CpuSolver(grid,state),empty=createCommandBatch(grid.count);
  // A valid persisted state just below the ceiling, followed by one ordinary
  // maximum-rate paused pour (200 kg / planet minute * 1/30 minute).
  solver.advance(0,empty,environment);const before=snapshot(solver,environment);
  expect(validSnapshot(before,grid.count)).toBe(true);
  const commands=createCommandBatch(grid.count);commands[COMMAND_FIELD.sand]=200*PHYSICS_DT;
  solver.advance(0,commands,environment);const after=snapshot(solver,environment),physical=solver.climate.physicalSurface(solver.state)[F.sand];
  expect(physical).toBeCloseTo(100005.66666666667,8);expect(validSnapshot(after,grid.count)).toBe(true);
  const system={version:3 as const,mode:'sandbox' as const,activeId:'planet-audit',planets:[{id:'planet-audit',name:'Audit',snapshot:after}],stock:emptyStock(),savedAt:1};
  expect(()=>prepareSystemSave(system,grid.count)).not.toThrow();
  evidence('execution-save-ceiling',{beforeValid:validSnapshot(before,grid.count),afterValid:validSnapshot(after,grid.count),beforeSand:before.state[F.sand],normalPausedPour:commands[COMMAND_FIELD.sand],afterProjection:after.state[F.sand],afterPhysical:physical,finite:solver.state.every(Number.isFinite),applicationPath:'main.ts:306,342,415-424 -> system.ts:39 -> storage.ts:58,66'});
 });

 it('completes the active campaign from the coherent live inventory when its persisted snapshot is old',()=>{
  const grid=createSphere(2),state=seedPlanet(grid,'rock',22,'nitrogen');
  for(let i=0;i<grid.count;i++)state[i*STRIDE+F.water]=5;
  const solver=new CpuSolver(grid,state),environment:Environment={...orbitalEnvironment(1),body:sandboxDefinition('rock'),climate:true};
  // Initialize canonical air exactly as the application has at a stashed state.
  const init=createCommandBatch(grid.count);init[COMMAND_FIELD.water]=1e-10;solver.advance(0,init,environment);
  const p:PlanetRecord={id:'planet-audit',name:'Audit',snapshot:snapshot(solver,environment)},progress=freshProgress(),stock=emptyStock();
  let steps=0,reached=false;
  for(;steps<240;steps++){
   const commands=createCommandBatch(grid.count);
   for(let i=0;i<grid.count;i++)commands[i*COMMAND_STRIDE+4]=heatForTarget(solver.state,i,150,'heat',commands,undefined,true);
   solver.advance(.05,commands,environment);
   // Production publishes only a small totals vector from the committed
   // state/climate pair. Persistence is allowed to retain its old snapshot.
   advanceProgress(progress,observeCampaignPlanets([p],p.id,solver,0),stock);
   const fresh={...p,snapshot:snapshot(solver,environment,(steps+1)*.05)};
   if(advanceProgress(freshProgress(),[fresh],emptyStock()).includes('water')){reached=true;break;}
  }
  const fresh={...p,snapshot:snapshot(solver,environment,(steps+1)*.05)},observed=observeCampaignPlanets([p],p.id,solver,0),publishedMetrics=expeditionStates(progress,observed,stock).find(s=>s.id==='water')!.metrics,freshMetrics=expeditionStates(freshProgress(),[fresh],emptyStock()).find(s=>s.id==='water')!.metrics;
  evidence('execution-campaign-coherent-climate',{steps:steps+1,time:fresh.snapshot.time,reachedLiveGoal:reached,liveTotals:{vapor:totals(solver.state,solver.climate)[F.vapor],cloud:totals(solver.state,solver.climate)[F.cloud]+totals(solver.state,solver.climate)[F.cloudIce]},publishedMetrics,freshMetrics,publishedCompleted:progress.completed,freshCompleted:advanceProgress(freshProgress(),[fresh],emptyStock()),applicationPath:'main.ts committed observer -> observeCampaignPlanets -> advanceProgress -> totals(state,climate)'});
  expect(reached).toBe(true);expect(progress.completed).toContain('water');expect(publishedMetrics).toEqual(freshMetrics);expect(advanceProgress(freshProgress(),[fresh],emptyStock())).toContain('water');
 },60000);
});
