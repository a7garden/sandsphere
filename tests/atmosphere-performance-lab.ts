/** Actual browser worker, isolated from application saves. Compare CPU results
 * bit for bit and measure UI frames independently of simulation throughput. */
import {PlanetView} from '../src/render/planet';
import {CpuSolver,COMMAND_STRIDE,seedPlanet,seedWorld,type Solver} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {WorkerSolver} from '../src/sim/workerSolver';
import {GpuSolver} from '../src/sim/gpu';
import {PHYSICS_DT} from '../src/sim/clock';
import {orbitalEnvironment} from '../src/sim/orbit';
import {SurfaceRefreshClock} from '../src/render/budget';

const query=new URLSearchParams(location.search),grid=createSphere(4),kind=query.get('kind')==='wet'?'wet':'dry',gpuRequested=query.get('gpu')==='1';
const state=kind==='wet'?seedWorld(grid,'coast',22):seedPlanet(grid,'sand',22);
const environment={...orbitalEnvironment(1),climate:true},commands=new Float32Array(grid.count*COMMAND_STRIDE);
const button=document.querySelector('button')!,output=document.querySelector('output')!;
const view=await PlanetView.create(document.querySelector('canvas')!,grid,state);
view.setEnvironment(environment);view.setSpin(0,false,0);view.setLayers(true,true);
let active:Solver|null=null,frames:number[]=[],previous=performance.now(),measuring=false,ready=false;
const refresh=new SurfaceRefreshClock();
view.engine.runRenderLoop(()=>{
 const now=performance.now(),gap=now-previous;previous=now;if(measuring)frames.push(gap);
 if(active){const dt=refresh.take(now);if(dt!==null)view.update(active.state,dt,environment);}
 view.animate(Math.min(.05,gap/1000));view.scene.render();
 if(!ready&&view.scene.isReady()){ready=true;button.disabled=false;output.textContent='준비 완료 · '+kind+' · 2,562셀 / 11층';}
});
const nextFrame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const summary=(samples:number[])=>{const sorted=samples.slice().sort((a,b)=>a-b);return {meanMs:+(sorted.reduce((a,b)=>a+b,0)/Math.max(1,sorted.length)).toFixed(2),p95Ms:+(sorted[Math.floor(sorted.length*.95)]??0).toFixed(2),over50ms:sorted.filter(v=>v>50).length};};
button.onclick=async()=>{
 button.disabled=true;
 const cpu=gpuRequested?await GpuSolver.create(grid,state.slice())??new CpuSolver(grid,state.slice()):new CpuSolver(grid,state.slice()),worker=await WorkerSolver.create(grid,state,!gpuRequested);
 if(!worker){output.textContent='Worker unavailable';button.disabled=false;return;}
 const run=async(solver:Solver)=>{
  active=solver;refresh.reset();view.update(state,0,environment);
  // Warm radiation coefficients and renderer before comparing steady frames.
  await solver.step(PHYSICS_DT,commands,environment);view.syncState(solver.state,environment);refresh.mark(PHYSICS_DT);
  await nextFrame();frames=[];const steps:number[]=[];measuring=true;
  for(let n=0;n<20;n++){
   await nextFrame();const start=performance.now();await solver.step(PHYSICS_DT,commands,environment);steps.push(performance.now()-start);
   view.syncState(solver.state,environment);refresh.mark(PHYSICS_DT);
  }
  await nextFrame();measuring=false;return {step:summary(steps),uiFrames:summary(frames)};
 };
 try{
  output.textContent='메인 스레드 기준 측정 중…';const baseline=await run(cpu);
  output.textContent='Worker 계산 측정 중…';const background=await run(worker);
  const equal=(a:ArrayLike<number>,b:ArrayLike<number>)=>a.length===b.length&&Array.from(a).every((v,i)=>Object.is(v,b[i]));
  const a=cpu.climate.checkpoint(),b=worker.climate.checkpoint();
  const exact=equal(cpu.state,worker.state)&&equal(cpu.energyChanges,worker.energyChanges)&&equal(cpu.escapeCells,worker.escapeCells)&&equal(cpu.condensedCells,worker.condensedCells)&&equal(cpu.precipitatedCells,worker.precipitatedCells)&&equal(cpu.climate.lift,worker.climate.lift)
   &&equal(a.wind,b.wind)&&equal(a.currents,b.currents)&&equal(a.seeds,b.seeds)
   &&(['mass','temperature','velocity','updraft','roundoff','radiationCache'] as const).every(key=>equal(a.air[key],b.air[key]));
  output.textContent=JSON.stringify({kind,cells:grid.count,layers:11,steps:21,baselineBackend:cpu.backend,workerBackend:worker.backend,exact,baseline,background},null,2);
 }catch(error){output.textContent=String(error);}
 finally{active=null;cpu.dispose();worker.dispose();button.disabled=false;}
};
