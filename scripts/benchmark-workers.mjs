/** Real Node worker_threads exercise the browser solver protocol without UI/GPU.
 * This measures CPU/IPC/event-loop availability; it is not browser FPS evidence. */
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Worker as ThreadWorker} from 'node:worker_threads';
import {isDeepStrictEqual} from 'node:util';
import {setImmediate as immediate,setTimeout as delay} from 'node:timers/promises';
const root=process.cwd(),prefix=resolve(process.argv[2]??'artifacts/performance/workers'),directory=mkdtempSync(join(tmpdir(),'sandsphere-worker-bench-'));
mkdirSync(dirname(prefix),{recursive:true});const {createServer,build}=await import(pathToFileURL(createRequire(resolve(root,'package.json')).resolve('vite')).href);
await build({root,configFile:false,envDir:false,logLevel:'error',build:{target:'es2022',outDir:directory,emptyOutDir:false,minify:false,lib:{entry:resolve(root,'src/sim/solver.worker.ts'),formats:['es'],fileName:()=> 'solver.worker.mjs'}}});
const shim=join(directory,'node-worker.mjs');writeFileSync(shim,`import {parentPort,workerData} from 'node:worker_threads';globalThis.self=globalThis;globalThis.postMessage=(data,transfer=[])=>parentPort.postMessage(data,transfer);const queue=[];let ready=false;parentPort.on('message',data=>ready?globalThis.onmessage({data}):queue.push(data));await import(workerData.module);ready=true;for(const data of queue)globalThis.onmessage({data});`);
const threads=new Set();
class BrowserWorkerAdapter {
 onmessage=null;onerror=null;onmessageerror=null;
 constructor(){this.thread=new ThreadWorker(pathToFileURL(shim),{workerData:{module:pathToFileURL(join(directory,'solver.worker.mjs')).href}});threads.add(this.thread);this.thread.on('message',data=>this.onmessage?.({data}));this.thread.on('error',error=>this.onerror?.({message:error.message,preventDefault(){}}));this.thread.on('messageerror',()=>this.onmessageerror?.());}
 postMessage(data,transfer=[]){this.thread.postMessage(data,transfer);}
 terminate(){threads.delete(this.thread);void this.thread.terminate();}
}
globalThis.Worker=BrowserWorkerAdapter;
const server=await createServer({root,configFile:false,envDir:false,logLevel:'error',cacheDir:join(directory,'cache'),server:{middlewareMode:true,ws:false,watch:null}});
const summary=a=>{const s=a.slice().sort((a,b)=>a-b);return {n:s.length,meanMs:s.reduce((a,b)=>a+b,0)/s.length,p95Ms:s[Math.floor(s.length*.95)]??0,maxMs:s.at(-1)??0};};
const result={method:'Real Node worker_threads; browser solver bundle forced to CPU; not browser FPS or GPU',root,runtime:process.version,scenarios:[]};
try{
 const m=await server.ssrLoadModule('/src/sim/model.ts'),sphere=await server.ssrLoadModule('/src/sim/sphere.ts'),orbit=await server.ssrLoadModule('/src/sim/orbit.ts'),creation=await server.ssrLoadModule('/src/sim/planetCreation.ts'),w=await server.ssrLoadModule('/src/sim/workerSolver.ts'),sys=await server.ssrLoadModule('/src/sim/system.ts'),grid=sphere.createSphere(4),commands=new Float32Array(grid.count*m.COMMAND_STRIDE);
 for(const kind of ['wet','jupiter']){
  const p=kind==='jupiter'?creation.createJupiterPlanet(grid):{state:m.seedWorld(grid,'coast',22),environment:{...orbit.orbitalEnvironment(1),climate:true}},cpu=new m.CpuSolver(grid,p.state.slice()),worker=await w.WorkerSolver.create(grid,p.state,true);
  if(!worker)throw new Error('Node adapter failed to create a worker');if(p.climate){cpu.climate.restore(p.climate);worker.climate.restore(p.climate);}
  const run=async solver=>{for(let i=0;i<3;i++)await solver.step(1/30,commands,p.environment);const times=[],gaps=[];let previous=performance.now();const timer=setInterval(()=>{const now=performance.now();gaps.push(now-previous);previous=now;},4);await delay(5);for(let i=0;i<8;i++){await immediate();const start=performance.now();await solver.step(1/30,commands,p.environment);times.push(performance.now()-start);}await delay(8);clearInterval(timer);return {step:summary(times),eventLoopGaps:summary(gaps)};};
  const baseline=await run(cpu),background=await run(worker),exact=isDeepStrictEqual(cpu.state,worker.state)&&isDeepStrictEqual(cpu.climate.checkpoint(),worker.climate.checkpoint())&&isDeepStrictEqual(cpu.energyChanges,worker.energyChanges)&&isDeepStrictEqual(cpu.escapeCells,worker.escapeCells)&&isDeepStrictEqual(cpu.feedingCells,worker.feedingCells);
  result.scenarios.push({kind,cells:grid.count,baseline,background,exact});cpu.dispose();worker.dispose();if(!exact)throw new Error(kind+' Worker result differs');
 }
 const initial=creation.createSandboxPlanet(grid,'sand',1,1,'nitrogen',1),make=()=>Array.from({length:3},(_,i)=>({id:'planet-'+i,name:'Node '+i,snapshot:{version:11,preset:'coast',state:[...initial.state],environment:structuredClone(initial.environment),time:0,supplied:0,removed:0,discoveries:[],planet:{primary:'sand'}}}));
 const serialWorlds=make(),parallelWorlds=make(),solvers=[];
 const factory=async state=>{const solver=await w.WorkerSolver.create(grid,state,true);if(!solver)throw new Error('Missing worker');solvers.push(solver);return solver;};
 const serial=new sys.BackgroundWorlds(grid,factory),parallel=new sys.BackgroundWorlds(grid,factory);
 const serialStep=async()=>{for(const p of serialWorlds)await serial.stepAsync([p],'active',1/30);},parallelStep=()=>parallel.stepAsync(parallelWorlds,'active',1/30);
 for(let n=0;n<3;n++){await serialStep();await parallelStep();}
 const collect=async action=>{const samples=[];for(let n=0;n<8;n++){const start=performance.now();await action();samples.push(performance.now()-start);}return summary(samples);};
 result.threeBackgroundPlanets={cells:grid.count,serial:await collect(serialStep),boundedParallel:await collect(parallelStep),exact:isDeepStrictEqual(serialWorlds,parallelWorlds)};
 for(const solver of solvers)solver.dispose();if(!result.threeBackgroundPlanets.exact)throw new Error('Background scheduling changed results');
 writeFileSync(prefix+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{for(const thread of threads)await thread.terminate();await server.close();}
