/** Opt-in before/after numerical and throughput audit. Run with
 * SANDSPHERE_PERF_AUDIT=record, then compare after changing the kernel. */
import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import process from 'node:process';
import {CpuSolver,COMMAND_STRIDE,seedPlanet,seedWorld} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {PHYSICS_DT} from '../src/sim/clock';
import {orbitalEnvironment} from '../src/sim/orbit';

const mode=process.env.SANDSPHERE_PERF_AUDIT,path='artifacts/atmosphere-performance/cpu-before.json';
it.skipIf(!mode)('keeps complete atmosphere results identical while reducing kernel work',()=>{
 const grid=createSphere(2),results=[];
 for(const kind of ['dry','wet','methane'] as const){
  const state=kind==='wet'?seedWorld(grid,'coast',22):seedPlanet(grid,'sand',22,kind==='methane'?'methane':'nitrogen');
  const solver=new CpuSolver(grid,state),commands=new Float32Array(grid.count*COMMAND_STRIDE),e={...orbitalEnvironment(1),climate:true,gravity:kind==='methane'?.3:1};
  const hash=createHash('sha256'),times:number[]=[];
  for(let n=0;n<24;n++){
   commands.fill(0);if(n===2)commands[1]=7;if(n===5)commands[8]=.2;if(n===9)commands[4]=20;
   const start=performance.now();solver.advance(n===9?0:PHYSICS_DT,commands,e);if(n>2)times.push(performance.now()-start);
   const c=solver.climate.checkpoint();
   for(const a of [solver.state,solver.energyChanges,solver.escapeCells,solver.condensedCells,solver.precipitatedCells,solver.climate.lift,c.wind,c.currents,c.seeds,c.air.mass,c.air.temperature,c.air.velocity,c.air.updraft,c.air.roundoff,c.air.radiationCache])hash.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
  }
  results.push({kind,digest:hash.digest('hex'),meanStepMs:times.reduce((a,b)=>a+b,0)/times.length});
 }
 if(mode==='record'){mkdirSync('artifacts/atmosphere-performance',{recursive:true});writeFileSync(path,JSON.stringify(results,null,2));}
 else {const before=JSON.parse(readFileSync(path,'utf8'));expect(results.map(({kind,digest})=>({kind,digest}))).toEqual(before.map(({kind,digest}:{kind:string;digest:string})=>({kind,digest})));writeFileSync('artifacts/atmosphere-performance/cpu-after.json',JSON.stringify({before,after:results},null,2));}
},20000);
