import {createServer} from '/Users/garden/Workspace/Projects/sandsphere/node_modules/vite/dist/node/index.js';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Session} from 'node:inspector';
const root=process.env.SANDSPHERE_PERF_ROOT??'/Users/garden/Workspace/Projects/sandsphere';
const out=process.env.SANDSPHERE_PERF_OUT??new URL('./optimization-results/candidate/',import.meta.url).pathname;mkdirSync(out,{recursive:true});
function exactHash(value){const h=createHash('sha256');const visit=v=>{if(ArrayBuffer.isView(v)){h.update(v.constructor.name);h.update(new Uint8Array(v.buffer,v.byteOffset,v.byteLength));}else if(v&&typeof v==='object'){for(const k of Object.keys(v).sort()){h.update(k);visit(v[k]);}}else h.update(Object.is(v,-0)?'-0':String(v));};visit(value);return h.digest('hex');}
const server=await createServer({configFile:false,envDir:false,root,cacheDir:out+'/vite-cache',server:{middlewareMode:true,ws:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
const summary=a=>{const s=[...a].sort((x,y)=>x-y);return {n:s.length,meanMs:s.reduce((x,y)=>x+y,0)/s.length,medianMs:s[Math.floor(s.length/2)],p95Ms:s[Math.min(s.length-1,Math.floor(s.length*.95))],minMs:s[0],maxMs:s.at(-1)};};
const measure=(n,fn)=>{const samples=[];for(let k=0;k<n;k++){const start=performance.now();fn();samples.push(performance.now()-start);}return summary(samples);};
function buffers(value){const seen=new Set(),found=new Set();const walk=v=>{if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);if(ArrayBuffer.isView(v)){found.add(v.buffer);return;}if(v instanceof ArrayBuffer){found.add(v);return;}if(v instanceof Map){for(const [k,x]of v){walk(k);walk(x);}return;}for(const x of Object.values(v))walk(x);};walk(value);return [...found].reduce((n,v)=>n+v.byteLength,0);}
const profileSession=new Session();const post=(name,arg={})=>new Promise((resolve,reject)=>profileSession.post(name,arg,(e,result)=>e?reject(e):resolve(result)));
const result={date:new Date().toISOString(),runtime:process.version,arch:process.arch,sourceRoot:root,method:'Vite SSR production sources; same 6 warmups +24 samples as research; serial baseline/candidate; no live user saves',warmupSteps:6,steadySamples:24,profileSamplesSteps:16,scenarios:[],saves:[]};
try{
 const model=await server.ssrLoadModule('/src/sim/model.ts'),sphere=await server.ssrLoadModule('/src/sim/sphere.ts'),orbit=await server.ssrLoadModule('/src/sim/orbit.ts'),creation=await server.ssrLoadModule('/src/sim/planetCreation.ts'),systemModule=await server.ssrLoadModule('/src/sim/system.ts'),definition=await server.ssrLoadModule('/src/sim/planetDefinition.ts');
 if(process.env.SANDSPHERE_PERF_SPECTRAL_WASM==='1'){
  const spectral=await server.ssrLoadModule('/src/sim/spectralRadiation.ts');
  result.acceleration=await spectral.initializeSpectralAcceleration({load:async()=>new Uint8Array(readFileSync(root+'/src/sim/data/spectral-optics-simd.wasm'))});
  if(result.acceleration.backend!=='wasm-simd')throw new Error('Requested WASM acceleration did not initialize');
 }
 const dt=1/30;
 for(const [level,kind,climate] of [[2,'dry',true],[3,'dry',true],[4,'dry',true],[4,'wet',true],[4,'methane',true],[4,'jupiter',true],[4,'dry',false]]){
  const grid=sphere.createSphere(level),planet=kind==='jupiter'?creation.createJupiterPlanet(grid):null;
  const state=planet?.state??(kind==='wet'?model.seedWorld(grid,'coast',22):model.seedPlanet(grid,'sand',22,kind==='methane'?'methane':'nitrogen'));
  const env=planet?.environment??{...orbit.orbitalEnvironment(1),climate,gravity:kind==='methane'?.3:1};
  const solver=new model.CpuSolver(grid,state),commands=new Float32Array(grid.count*model.COMMAND_STRIDE);if(planet?.climate)solver.climate.restore(planet.climate);
  const first=measure(1,()=>solver.advance(dt,commands,env));for(let n=0;n<5;n++)solver.advance(dt,commands,env);
  global.gc?.();const memoryBefore=process.memoryUsage();
  const steady=measure(24,()=>solver.advance(dt,commands,env)),memoryAfter=process.memoryUsage();
  const exactAfter30=exactHash({state:solver.state,climate:solver.climate.checkpoint(),lift:solver.climate.lift,energy:solver.energyChanges,escape:solver.escapeCells,condensed:solver.condensedCells,precipitated:solver.precipitatedCells,feeding:solver.feedingCells});
  const named={};const restores=[];
  for(const [obj,names,prefix]of [[solver.climate,['step','stepGiant','checkpoint','prepareSurface'],'climate'],[solver.climate.air,['advance','dynamics','combustionStep','radiation','phase','precipitation'],'air'],[solver.climate.giant,['advance','dynamics','radiation','equilibrateClouds'],'giant']])for(const name of names){const original=obj[name];if(typeof original!=='function')continue;const item=named[prefix+'.'+name]={calls:0,totalMs:0};obj[name]=function(...args){const t=performance.now();try{return original.apply(this,args);}finally{item.calls++;item.totalMs+=performance.now()-t;}};restores.push(()=>obj[name]=original);}
  const instrumented=measure(3,()=>solver.advance(dt,commands,env));for(const restore of restores)restore();
  const checkpoint=solver.climate.checkpoint(),checkpointBytes=buffers(checkpoint),copy=measure(30,()=>solver.climate.checkpoint()),restore=measure(30,()=>solver.climate.restoreCheckpoint(checkpoint));
  const snapshot=measure(10,()=>solver.climate.snapshot()),surfaceArray=measure(10,()=>Array.from(solver.state));
  const row={exactAfter30,level,kind,climate,cells:grid.count,dt,first,steady,instrumented,named,checkpointBytes,copy,restore,snapshot,surfaceArray,solverTypedArrayBytes:buffers(solver),memoryBefore,memoryAfter};
  if(level===4&&kind==='wet'){
   profileSession.connect();await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});await post('Profiler.start');for(let n=0;n<16;n++)solver.advance(dt,commands,env);const {profile}=await post('Profiler.stop');await post('Profiler.disable');profileSession.disconnect();writeFileSync(out+'/wet.cpuprofile',JSON.stringify(profile));row.profile=out+'/wet.cpuprofile';
  }
  result.scenarios.push(row);writeFileSync(out+'/cpu.json',JSON.stringify(result,null,2));console.log(JSON.stringify({kind,level,cells:grid.count,first:first.meanMs,steady:steady.meanMs,copyMs:copy.meanMs,checkpointBytes}));
  if(level===4&&['wet','jupiter'].includes(kind)){
   const saveEnv=env.body?env:{...env,body:definition.sandboxDefinition('rock',env.gravity??1,1)};
   const snapshot={version:11,preset:'coast',state:[...solver.state],climate:solver.climate.snapshot(),environment:saveEnv,time:1,supplied:0,removed:0,discoveries:[]};
   for(const count of [1,4,8]){
    const planets=Array.from({length:Math.min(count,4)},(_,i)=>({id:'planet-'+i,name:'Research '+i,snapshot:structuredClone(snapshot)}));
    const world={activeId:'planet-0',planets,stock:model.emptyStock()};const save={version:3,mode:'sandbox',...world,...(count===8?{other:structuredClone(world)}:{}),savedAt:1};
    const prepare=measure(3,()=>systemModule.prepareSystemSave(save,grid.count));const prepared=systemModule.prepareSystemSave(save,grid.count);
    const stringify=measure(3,()=>JSON.stringify(prepared)),json=JSON.stringify(prepared),bytes=new TextEncoder().encode(json);
    const clone=measure(3,()=>structuredClone(prepared));let gzipBytes=0;const gzipTimes=[];for(let n=0;n<3;n++){const t=performance.now();const blob=await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).blob();gzipBytes=blob.size;gzipTimes.push(performance.now()-t);}
    result.saves.push({kind,count,rawBytes:bytes.length,gzipBytes,parts512KiB:Math.ceil(gzipBytes/(512*1024)),prepare,stringify,clone,gzip:summary(gzipTimes),telemetryIncluded:false});writeFileSync(out+'/cpu.json',JSON.stringify(result,null,2));console.log(JSON.stringify({save:kind,count,rawBytes:bytes.length,gzipBytes,prepareMs:prepare.meanMs,stringifyMs:stringify.meanMs}));
   }
  }
  if(solver.climate.air.setRadiationDiagnostics&&climate){solver.climate.air.setRadiationDiagnostics(true);for(let n=0;n<3;n++)solver.advance(dt,commands,env);row.radiationDiagnostics=solver.climate.air.radiationDiagnostics();writeFileSync(out+'/cpu.json',JSON.stringify(result,null,2));}
  solver.dispose();global.gc?.();
 }
}finally{await server.close();}
