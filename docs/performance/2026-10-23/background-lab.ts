import {CpuSolver,F,seedPlanet,type Solver,type Snapshot} from '../../../src/sim/model';
import {createSphere} from '../../../src/sim/sphere';
import {WorkerSolver} from '../../../src/sim/workerSolver';
import {BackgroundWorlds,advanceOrbit,type PlanetRecord} from '../../../src/sim/system';
import {orbitalEnvironment} from '../../../src/sim/orbit';
import {PHYSICS_DT} from '../../../src/sim/clock';
import {runFrameSteps} from '../../../src/sim/frameExecution';
import {createCommandBatch} from '../../../src/sim/supply';

const WARM=6,SAMPLES=12,COUNTS=[1,2,4],BUDGET_MS=110000;
const button=document.querySelector<HTMLButtonElement>('#run')!,download=document.querySelector<HTMLButtonElement>('#download')!,output=document.querySelector<HTMLElement>('#result')!,message=document.querySelector<HTMLElement>('#message')!,pulse=document.querySelector<HTMLElement>('#pulse')!;
let lastReport:unknown;
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const summary=(values:number[])=>{const sorted=values.slice().sort((a,b)=>a-b),sum=values.reduce((a,b)=>a+b,0);return {count:values.length,meanMs:values.length?sum/values.length:null,p50Ms:sorted.length?sorted[Math.floor((sorted.length-1)*.5)]:null,p95Ms:sorted.length?sorted[Math.ceil((sorted.length-1)*.95)]:null,maxMs:sorted.at(-1)??null};};
function mismatch(a:unknown,b:unknown,path='$'):string|null{
 if(Object.is(a,b))return null;
 if(ArrayBuffer.isView(a)&&ArrayBuffer.isView(b)){
  if(a.constructor!==b.constructor)return path+': typed-array kind';
  const x=a as unknown as ArrayLike<number>,y=b as unknown as ArrayLike<number>;
  if(x.length!==y.length)return path+': length';for(let i=0;i<x.length;i++)if(!Object.is(x[i],y[i]))return path+'['+i+']: '+x[i]+' vs '+y[i];return null;
 }
 if(a&&b&&typeof a==='object'&&typeof b==='object'){
  const x=a as Record<string,unknown>,y=b as Record<string,unknown>,keys=Object.keys(x),other=Object.keys(y);
  if(keys.length!==other.length||keys.some(key=>!Object.hasOwn(y,key)))return path+': property set';
  for(const key of keys){const difference=mismatch(x[key],y[key],path+'.'+key);if(difference)return difference;}return null;
 }
 return path+': '+String(a)+' vs '+String(b);
}
async function servedIdentity(){
 const paths=['model','system','workerSolver','solver.worker','solverWorkerProtocol','weatherClimate','layeredAtmosphere','spectralRadiation','deepAtmosphere','climateSnapshot'];
 return Object.fromEntries(await Promise.all(paths.map(async name=>{const path='/src/sim/'+name+'.ts';try{const response=await fetch(path);if(!response.ok)return [path,{available:false,status:response.status}];const bytes=await response.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);return [path,{available:true,sha256ServedTransformedModule:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')}];}catch(error){return [path,{available:false,error:String(error)}];}})));
}
function fixture(grid:ReturnType<typeof createSphere>,index:number):PlanetRecord{
 const state=seedPlanet(grid,'sand',20+index*2,'nitrogen',1),environment={...orbitalEnvironment(1),climate:true,orbitAngle:index*.37};
 const snapshot:Snapshot={version:11,preset:'coast',planet:{primary:'sand'},state:Array.from(state),time:0,environment,supplied:0,removed:0,escaped:0,discoveries:[],paused:false,spin:{angle:index*.17,running:true,period:120,tilt:0}};
 return {id:'planet-'+index,name:'Dry '+(index+1),snapshot};
}

button.addEventListener('click',()=>void run());
download.addEventListener('click',()=>{if(!lastReport)return;const url=URL.createObjectURL(new Blob([JSON.stringify(lastReport,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='background-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});

async function run(){
 button.disabled=true;download.disabled=true;const started=performance.now(),startedAt=new Date().toISOString(),live=new Set<Solver>();let stopped=false,raf=0,phase='setup',lastFrame:number|undefined;
 const intervals:{start:number;end:number;ms:number}[]=[],longTasks:{start:number;duration:number}[]=[];
 const beat=(time:number)=>{if(lastFrame!==undefined&&phase==='measure')intervals.push({start:lastFrame,end:time,ms:time-lastFrame});lastFrame=time;pulse.style.transform='translateX('+(Math.sin(time/350)*15).toFixed(1)+'px)';raf=requestAnimationFrame(beat);};raf=requestAnimationFrame(beat);
 let observer:PerformanceObserver|undefined;
 if(PerformanceObserver.supportedEntryTypes?.includes('longtask')){observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push({start:entry.startTime,duration:entry.duration});});observer.observe({type:'longtask',buffered:false});}
 const flushLongTasks=()=>{for(const entry of observer?.takeRecords()??[])longTasks.push({start:entry.startTime,duration:entry.duration});};
 const stop=()=>{stopped=true;for(const solver of live)solver.dispose();live.clear();};
 const deadline=setTimeout(stop,BUDGET_MS);
 const check=()=>{if(stopped)throw new Error('110-second bound reached; partial receipt only.');if(document.hidden)throw new Error('Tab became hidden; timing invalidated.');};
 const cases:Record<string,unknown>[]=[];
 type Captured={state:Float32Array;checkpoint:ReturnType<CpuSolver['climate']['checkpoint']>;climate:ReturnType<CpuSolver['climate']['snapshot']>;time:number;environment:Snapshot['environment'];spin:Snapshot['spin'];escaped:number};
 const verification:{count:number;initial:PlanetRecord[];actual:Captured[]}[]=[];
 let identity:unknown,error:string|undefined;
 try{
  if(typeof Worker==='undefined')throw new Error('Native Worker unavailable; no main-thread substitute is timed.');
  identity=await servedIdentity();check();const grid=createSphere(4),empty=createCommandBatch(grid.count);
  for(const count of COUNTS){
   check();phase='warm';message.textContent=count+' total planets: warming '+WARM+' steps…';await frame();
   const planets=Array.from({length:count},(_,i)=>fixture(grid,i)),initial=structuredClone(planets),activeId=planets[0].id,solvers=new Map<string,Solver>();
   let inFlightBackground=0,maxBackground=0,inFlightAll=0,maxAll=0,measuredBackground=0,measuredAll=0,factories=0;
   const backends:{scope:string;backend:Solver['backend'];backgroundCompute:boolean}[]=[],completed:Record<string,{warm:number;measured:number}>={};
   for(const p of planets)completed[p.id]={warm:0,measured:0};
   const create=async(state:Float32Array,scope:'active'|'background')=>{
    check();const solver=await WorkerSolver.create(grid,state,true);if(!solver)throw new Error('Native CPU Worker could not initialize.');
    live.add(solver);check();factories++;backends.push({scope,backend:solver.backend,backgroundCompute:!!(solver as Solver&{backgroundCompute?:boolean}).backgroundCompute});
    const original=solver.step.bind(solver);solver.step=async(...args)=>{
     check();inFlightAll++;maxAll=Math.max(maxAll,inFlightAll);if(phase==='measure')measuredAll=Math.max(measuredAll,inFlightAll);
     if(scope==='background'){inFlightBackground++;maxBackground=Math.max(maxBackground,inFlightBackground);if(phase==='measure')measuredBackground=Math.max(measuredBackground,inFlightBackground);}
     try{await original(...args);}finally{inFlightAll--;if(scope==='background')inFlightBackground--;}
    };return solver;
   };
   const background=new BackgroundWorlds(grid,state=>create(state,'background')),active=await create(new Float32Array(planets[0].snapshot.state),'active');active.climate.restore(planets[0].snapshot.climate);solvers.set(activeId,active);
   const activeStep=async()=>{const snapshot=planets[0].snapshot;advanceOrbit(snapshot,PHYSICS_DT);await active.step(PHYSICS_DT,empty,snapshot.environment);snapshot.escaped=(snapshot.escaped??0)+active.escapeCells.reduce((sum,v)=>sum+v,0);completed[activeId][phase==='measure'?'measured':'warm']++;};
   const backgroundStep=()=>background.stepAsync(planets,activeId,PHYSICS_DT,(planet,solver)=>{solvers.set(planet.id,solver);completed[planet.id][phase==='measure'?'measured':'warm']++;});
   try{
    for(let n=0;n<WARM;n++){check();await runFrameSteps(1,activeStep,backgroundStep);}
    message.textContent=count+' total planets: measuring '+SAMPLES+' steps…';await frame();phase='measure';const windowStart=performance.now(),samples:number[]=[];
    for(let n=0;n<SAMPLES;n++){check();const begin=performance.now();await runFrameSteps(1,activeStep,backgroundStep);samples.push(performance.now()-begin);}
    const windowEnd=performance.now();phase='capture';flushLongTasks();
    const frames=intervals.filter(v=>v.start>=windowStart&&v.end<=windowEnd).map(v=>v.ms),tasks=longTasks.filter(v=>v.start<windowEnd&&v.start+v.duration>windowStart),elapsed=windowEnd-windowStart;
    cases.push({totalPlanets:count,activePlanets:1,inactivePlanets:count-1,cells:grid.count,warmStepsPerPlanet:WARM,measuredStepsPerPlanet:SAMPLES,completedPerWorld:completed,completedCountsExact:Object.values(completed).every(value=>value.warm===WARM&&value.measured===SAMPLES),workerCreations:factories,backends,maxBackgroundStepConcurrency:maxBackground,maxAllStepConcurrency:maxAll,maxMeasuredBackgroundConcurrency:measuredBackground,maxMeasuredAllConcurrency:measuredAll,candidateBackgroundBoundObserved:measuredBackground<=2,window:{startMs:windowStart,endMs:windowEnd,elapsedMs:elapsed},systemStep:summary(samples),systemStepsPerSecond:SAMPLES*1000/elapsed,planetStepsPerSecond:SAMPLES*count*1000/elapsed,elapsedMsPerPlanetStep:elapsed/(SAMPLES*count),mainRaf:summary(frames),longTasks:observer?{count:tasks.length,totalMs:tasks.reduce((sum,v)=>sum+v.duration,0),maxMs:Math.max(0,...tasks.map(v=>v.duration)),entries:tasks}:null});
    // Public materialization and exact checkpoint copies are outside timing.
    const actual=planets.map(p=>{const solver=solvers.get(p.id);if(!solver)throw new Error('No complete solver for '+p.id);const climate=p.id===activeId?solver.climate.snapshot():p.snapshot.climate;if(!climate)throw new Error('No committed public climate for '+p.id);return {state:p.id===activeId?solver.state.slice():new Float32Array(p.snapshot.state),checkpoint:solver.climate.checkpoint(),climate,time:p.snapshot.time,environment:structuredClone(p.snapshot.environment),spin:structuredClone(p.snapshot.spin),escaped:p.snapshot.escaped??0};});
    verification.push({count,initial,actual});
   }finally{
    for(const p of planets)background.invalidate(p.id);for(const solver of solvers.values()){solver.dispose();live.delete(solver);}active.dispose();live.delete(active);
   }
  }
  phase='control';message.textContent='Timing complete. Checking exact serial CPU state, checkpoint, orbit and save view…';await frame();
  for(const job of verification){
   const results:Record<string,unknown>[]=[];const controlStarted=performance.now();
   for(let i=0;i<job.initial.length;i++){
    check();const p=job.initial[i],s=p.snapshot,cpu=new CpuSolver(grid,new Float32Array(s.state));cpu.climate.restore(s.climate);
    try{for(let n=0;n<WARM+SAMPLES;n++){check();advanceOrbit(s,PHYSICS_DT);cpu.advance(PHYSICS_DT,empty,s.environment);s.escaped=(s.escaped??0)+cpu.escapeCells.reduce((sum,v)=>sum+v,0);await frame();}
     const actual=job.actual[i],stateDifference=mismatch(actual.state,cpu.state),checkpointDifference=mismatch(actual.checkpoint,cpu.climate.checkpoint()),orbitDifference=mismatch({time:actual.time,environment:actual.environment,spin:actual.spin,escaped:actual.escaped},{time:s.time,environment:s.environment,spin:s.spin,escaped:s.escaped??0}),snapshotDifference=mismatch(actual.climate,cpu.climate.snapshot());
     results.push({id:p.id,steps:WARM+SAMPLES,exactState:stateDifference===null,exactCheckpoint:checkpointDifference===null,exactOrbitAndEscaped:orbitDifference===null,exactSnapshotValues:snapshotDifference===null,exactSnapshotJson:JSON.stringify(actual.climate)===JSON.stringify(cpu.climate.snapshot()),firstDifference:stateDifference??checkpointDifference??orbitDifference??snapshotDifference});
    }finally{cpu.dispose();}
   }
   const entry=cases.find(value=>value.totalPlanets===job.count)!;entry.serialControl={outsideTiming:true,elapsedMs:performance.now()-controlStarted,worlds:results,pass:results.every(r=>r.exactState&&r.exactCheckpoint&&r.exactOrbitAndEscaped&&r.exactSnapshotValues&&r.exactSnapshotJson)};
  }
 }catch(problem){error=problem instanceof Error?problem.message:String(problem);}finally{phase='done';clearTimeout(deadline);stop();cancelAnimationFrame(raf);flushLongTasks();observer?.disconnect();}
 const report={kind:'background-worlds-production-inspector',label:new URLSearchParams(location.search).get('label')??'unspecified',startedAt,finishedAt:new Date().toISOString(),totalElapsedMs:performance.now()-started,status:error?'incomplete-or-failed':cases.every(c=>(c.serialControl as {pass?:boolean}|undefined)?.pass&&c.completedCountsExact&&c.candidateBackgroundBoundObserved)?'pass':'fail',error,environment:{url:location.href,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,devicePixelRatio,viewport:{width:innerWidth,height:innerHeight},visibility:document.visibilityState},identity,settings:{resolution:4,fixture:'dry sand, nitrogen 0.3 game kg/cell, full climate, deterministic temperature/orbit variation',dt:PHYSICS_DT,warm:WARM,samples:SAMPLES,totalPlanets:COUNTS,forceCpuWorker:true,ordering:'production runFrameSteps: await active, then await BackgroundWorlds.stepAsync',timeBoundMs:BUDGET_MS},interpretation:{timed:'Worker roundtrip + active step + production background scheduling/publication; 1/2/4 total planets means 0/1/3 background worlds.',notMeasured:'Game rendering, UI frame rate, GPU execution time, mobile hardware, long-term thermal performance, cloud or save throughput.',cadence:'requestAnimationFrame interval in this visible inspector only; longtasks are main-thread entries overlapping measured windows.',control:'Serial CpuSolver replays the same 18 ordered common steps per planet only after all timing. Exact checks use Object.is, retaining signed zero.',parallelism:'Observed simultaneous solver.step promises; not a CPU-core utilization measurement. Candidate background maximum is 2; baseline may remain serial.'},cases};
 const name='background-'+Date.now(),endpoint='http://127.0.0.1:5184/__performance/result/'+name;
 lastReport=report;output.textContent=JSON.stringify(report,null,2);download.disabled=false;
 try{const sameOrigin=new URL(endpoint).origin===location.origin,response=await fetch(endpoint,{method:'POST',mode:sameOrigin?'same-origin':'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify(report)});if(sameOrigin&&!response.ok)throw new Error('Receipt HTTP '+response.status);message.textContent=report.status+' · '+(sameOrigin?'JSON receipt saved.':'JSON receipt submitted to 5184; cross-origin acknowledgement is opaque.');}catch(problem){message.textContent=report.status+' · Receipt submission failed; use Download JSON. '+String(problem);}
 button.disabled=false;
}
