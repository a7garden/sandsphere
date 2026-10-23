// Research-only entry over the current production modules. No application save slots or cloud access.
import {PlanetView} from '../../../src/render/planet';
import {SurfaceRefreshClock} from '../../../src/render/budget';
import {CpuSolver,COMMAND_STRIDE,F,STRIDE,seedPlanet,seedWorld,emptyStock,type Solver,type Environment} from '../../../src/sim/model';
import {createSphere,cellBrushWeights} from '../../../src/sim/sphere';
import {orbitalEnvironment} from '../../../src/sim/orbit';
import {sandboxDefinition} from '../../../src/sim/planetDefinition';
import {WorkerSolver} from '../../../src/sim/workerSolver';
import {PHYSICS_DT} from '../../../src/sim/clock';
import {prepareSystemSave} from '../../../src/sim/system';
import {snapshotSurface} from '../../../src/sim/session';
import {prepareBrowserStorage,saveSnapshot,loadRecord} from '../../../src/sim/browserStorage';

const grid=createSphere(4),query=new URLSearchParams(location.search),kind=query.get('kind')==='wet'?'wet':'dry';
const initial=kind==='wet'?seedWorld(grid,'coast',22):seedPlanet(grid,'sand',22);
const environment:Environment={...orbitalEnvironment(1),climate:true,gravity:1,body:sandboxDefinition('rock',1,1)};
const commands=new Float32Array(grid.count*COMMAND_STRIDE),output=document.querySelector<HTMLPreElement>('#result')!;
const buttons=[...document.querySelectorAll<HTMLButtonElement>('nav button:not(#stop)')];
const view=await PlanetView.create(document.querySelector<HTMLCanvasElement>('canvas')!,grid,initial);
view.setEnvironment(environment);view.setSpin(0,false,0);view.setLayers(true,true);
const refresh=new SurfaceRefreshClock();let active:Solver|null=null,measuring=false,rendering=true,previous=performance.now(),frames:number[]=[],updates:number[]=[],draws:number[]=[],longTasks:number[]=[];
const observer=new PerformanceObserver(entries=>{if(measuring)for(const item of entries.getEntries())longTasks.push(item.duration);});
try{observer.observe({type:'longtask',buffered:false});}catch{}
const summary=(samples:number[])=>{const a=[...samples].sort((x,y)=>x-y);return {n:a.length,meanMs:a.reduce((x,y)=>x+y,0)/Math.max(1,a.length),p50Ms:a[Math.floor(a.length*.5)]??null,p95Ms:a[Math.floor(a.length*.95)]??null,p99Ms:a[Math.floor(a.length*.99)]??null,over50ms:a.filter(x=>x>50).length};};
const nextFrame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const meta=()=>({kind,cells:grid.count,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,drawingBuffer:[view.engine.getRenderWidth(),view.engine.getRenderHeight()],renderer:view.engine.constructor.name,drawCalls:view.engine._drawCalls?.current,activeIndices:view.scene.getActiveIndices(),meshCount:view.scene.meshes.length,quality:'PlanetView constructor smooth defaults for physics; surface test enables faceted hex; atmosphere/clouds enabled; spin stopped',wallClock:new Date().toISOString()});
const present=async(name:string,result:unknown)=>{output.textContent=JSON.stringify(result,null,2);await fetch('/__performance/result/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});};
const loop=()=>{const now=performance.now(),gap=now-previous;previous=now;if(measuring)frames.push(gap);if(active){const dt=refresh.take(now);if(dt!==null){const start=performance.now();view.update(active.state,dt,environment);if(measuring)updates.push(performance.now()-start);}}view.animate(Math.min(.05,gap/1000));const start=performance.now();view.scene.render();if(measuring)draws.push(performance.now()-start);};
view.engine.runRenderLoop(loop);
while(!view.scene.isReady())await nextFrame();buttons.forEach(b=>b.disabled=false);output.textContent='준비 완료 · '+kind+' · 2,562셀';
document.querySelector<HTMLButtonElement>('#stop')!.onclick=()=>{rendering=!rendering;if(rendering)view.engine.runRenderLoop(loop);else view.engine.stopRenderLoop(loop);document.querySelector('#stop')!.textContent=rendering?'렌더 중지':'렌더 시작';};
const locked=async(run:()=>Promise<void>)=>{buttons.forEach(b=>b.disabled=true);try{await run();}catch(error){await present('error-'+Date.now(),{error:String(error),stack:(error as Error).stack,meta:meta()});}finally{active=null;measuring=false;buttons.forEach(b=>b.disabled=false);}};
function mismatch(a:any,b:any,path='root'):string|null{if(ArrayBuffer.isView(a)){if(!ArrayBuffer.isView(b)||(a as any).length!==(b as any).length)return path+'.length';for(let i=0;i<(a as any).length;i++)if(!Object.is((a as any)[i],(b as any)[i]))return path+'['+i+']';return null;}if(a&&typeof a==='object'){if(!b||typeof b!=='object')return path;for(const k of new Set([...Object.keys(a),...Object.keys(b)])){const m=mismatch(a[k],b[k],path+'.'+k);if(m)return m;}return null;}return Object.is(a,b)?null:path;}
document.querySelector<HTMLButtonElement>('#physics')!.onclick=()=>locked(async()=>{
 const rows:any[]=[],warmup=6,samples=24;let reference:any;
 for(const backend of ['main-cpu','worker-cpu','worker-gpu']){
  output.textContent=backend+' 초기화';const initStart=performance.now();
  const solver=backend==='main-cpu'?new CpuSolver(grid,initial.slice()):await WorkerSolver.create(grid,initial,backend==='worker-cpu');
  const initMs=performance.now()-initStart;if(!solver){rows.push({backend,unavailable:true});continue;}
  try{active=solver;view.setClimate('none',solver.climate);refresh.reset();for(let n=0;n<warmup;n++){await solver.step(PHYSICS_DT,commands,environment);view.syncState(solver.state,environment);refresh.mark(PHYSICS_DT);await nextFrame();}
   output.textContent=backend+' 측정 중';frames=[];updates=[];draws=[];longTasks=[];const steps:number[]=[];measuring=true;const started=performance.now();
   for(let n=0;n<samples;n++){await nextFrame();const t=performance.now();await solver.step(PHYSICS_DT,commands,environment);steps.push(performance.now()-t);view.syncState(solver.state,environment);refresh.mark(PHYSICS_DT);}
   await nextFrame();const elapsedMs=performance.now()-started;measuring=false;
   const state={state:solver.state.slice(),climate:solver.climate.checkpoint(),lift:solver.climate.lift.slice(),energy:solver.energyChanges.slice(),escape:solver.escapeCells.slice(),condensed:solver.condensedCells.slice(),precipitated:solver.precipitatedCells.slice(),feeding:solver.feedingCells.slice()};
   const firstMismatch=reference?mismatch(reference,state):null;reference??=state;
   rows.push({backend,actualBackend:solver.backend,initMs,warmup,samples,elapsedMs,step:summary(steps),uiFrames:summary(frames),refresh:summary(updates),renderCpuSubmission:summary(draws),longTasks:summary(longTasks),exactVsMainCpu:firstMismatch===null,firstMismatch});
   await present('physics-'+kind,{meta:meta(),rows});
  }finally{active=null;solver.dispose();}
 }
});
document.querySelector<HTMLButtonElement>('#surface')!.onclick=()=>locked(async()=>{
 const state=seedWorld(grid,'coast',22);for(let i=0;i<grid.count;i++){state[i*STRIDE+F.soil]=2;state[i*STRIDE+F.plant]=state[i*STRIDE+F.water]<.2?.4:0;state[i*STRIDE+F.cloud]=.12;}
 view.setSurfaceStyle(true,1,true);view.setCloudStyle('stratus');const cells=cellBrushWeights(grid,100,5),rows:any[]=[];view.engine.stopRenderLoop(loop);
 try{for(const mode of ['idle','temperature','pour']){const update:number[]=[],render:number[]=[],gaps:number[]=[];let last=performance.now();output.textContent=mode+' 표면 측정 중';
   for(let n=0;n<180;n++){if(mode!=='idle')state[(n%grid.count)*STRIDE+F.temperature]+=.001;if(mode==='pour')for(const {index,weight} of cells)state[index*STRIDE+F.sand]+=80/30*weight;
    if(mode!=='idle'||n===0){const t=performance.now();view.update(state,1/15,environment);if(n>=30)update.push(performance.now()-t);}view.animate(1/60);const t=performance.now();view.scene.render();if(n>=30)render.push(performance.now()-t);await nextFrame();const now=performance.now();if(n>=30)gaps.push(now-last);last=now;
   }rows.push({mode,samples:150,warmupFrames:30,refresh:summary(update),renderCpuSubmission:summary(render),uiFrames:summary(gaps)});
  }await present('surface-'+kind,{meta:meta(),method:'stress test: refresh once per rendered frame, not application 15Hz coalescing',rows});
 }finally{if(rendering)view.engine.runRenderLoop(loop);}
});
document.querySelector<HTMLButtonElement>('#save')!.onclick=()=>locked(async()=>{
 const solver=new CpuSolver(grid,initial.slice()),rows:any[]=[];await prepareBrowserStorage();
 try{for(let i=0;i<3;i++){await solver.step(PHYSICS_DT,commands,environment);await nextFrame();}
  const captures:number[]=[];for(let n=0;n<3;n++){await nextFrame();const t=performance.now();snapshotSurface(solver.state,commands,[],null,solver.climate,environment);captures.push(performance.now()-t);}
  const snapshot={version:11 as const,preset:'coast' as const,state:Array.from(solver.state),climate:solver.climate.snapshot(),environment,time:.1,supplied:0,removed:0,discoveries:[]};
  for(const count of [1,4,8]){output.textContent=count+'행성 저장 측정';const profile={activeId:'planet-0',planets:Array.from({length:Math.min(count,4)},(_,i)=>({id:'planet-'+i,name:'Research '+i,snapshot:structuredClone(snapshot)})),stock:emptyStock()};
   const save={version:3 as const,mode:'sandbox' as const,...profile,...(count===8?{other:structuredClone(profile)}:{}),savedAt:Date.now()},prepare:number[]=[],submit:number[]=[],elapsed:number[]=[],read:number[]=[];const slot='performance-research-'+crypto.randomUUID();
   try{for(let n=0;n<3;n++){await nextFrame();let t=performance.now();const prepared=prepareSystemSave(save,grid.count);prepare.push(performance.now()-t);t=performance.now();const write=saveSnapshot(prepared,slot);submit.push(performance.now()-t);await write;elapsed.push(performance.now()-t);t=performance.now();const loaded:any=await loadRecord(slot);read.push(performance.now()-t);if(loaded.savedAt!==prepared.savedAt)throw new Error('IDB savedAt mismatch');}
    rows.push({count,prepare:summary(prepare),idbSynchronousSubmit:summary(submit),idbWriteElapsed:summary(elapsed),idbReadElapsed:summary(read),telemetryIncluded:false});
   }finally{const db=await prepareBrowserStorage();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').delete(slot);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
  }await present('save-'+kind,{meta:meta(),snapshotSurface:summary(captures),warmupPhysicsSteps:3,rows,roundTripValidation:'savedAt only; size/cost research, not full save correctness'});
 }finally{solver.dispose();}
});
