import {createServer} from '/Users/garden/Workspace/Projects/sandsphere/node_modules/vite/dist/node/index.js';
import {writeFileSync,mkdirSync} from 'node:fs';
const root=process.env.SANDSPHERE_PERF_ROOT??'/Users/garden/Workspace/Projects/sandsphere';
const out=process.env.SANDSPHERE_RSH_OUT??new URL('./results/',import.meta.url).pathname;
const label=process.env.SANDSPHERE_RSH_LABEL??'baseline';
const totalSteps=Number(process.env.SANDSPHERE_RSH_STEPS??300);
mkdirSync(out,{recursive:true});
const server=await createServer({configFile:false,envDir:false,root,cacheDir:out+'/vite-cache',server:{middlewareMode:true,ws:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
const result={date:new Date().toISOString(),label,runtime:process.version,arch:process.arch,method:'Vite SSR production sources; wet coast level 4; timing pass without counters, counters pass on an identically seeded solver; windows in advance() steps (dt=1/30 game s, AIR_SECONDS=60)',steps:totalSteps,windows:[],stepMs:[]};
try{
 const model=await server.ssrLoadModule('/src/sim/model.ts'),sphere=await server.ssrLoadModule('/src/sim/sphere.ts'),orbit=await server.ssrLoadModule('/src/sim/orbit.ts');
 const dt=1/30,level=4,grid=sphere.createSphere(level);
 const seed=()=>{const state=model.seedWorld(grid,'coast',22);return {state,env:{...orbit.orbitalEnvironment(1),climate:true,gravity:1}};};
 // Timing pass: diagnostics off, per-step wall time.
 {
  const {state,env}=seed();const solver=new model.CpuSolver(grid,state),commands=new Float32Array(grid.count*model.COMMAND_STRIDE);
  solver.advance(dt,commands,env);
  for(let n=0;n<totalSteps;n++){const t=performance.now();solver.advance(dt,commands,env);result.stepMs.push(performance.now()-t);}
  solver.dispose();global.gc?.();
 }
 // Counters pass: identical seed, diagnostics enabled per window.
 const windows=[[1,3],[3,30],[30,100],[100,totalSteps]];
 {
  const {state,env}=seed();const solver=new model.CpuSolver(grid,state),commands=new Float32Array(grid.count*model.COMMAND_STRIDE);
  solver.advance(dt,commands,env);
  for(const [from,to] of windows){
   solver.climate.air.setRadiationDiagnostics(true);
   for(let n=from;n<to;n++)solver.advance(dt,commands,env);
   const d=solver.climate.air.radiationDiagnostics();
   const row={from,to,steps:to-from,calls:d.calls,rebuilds:d.rebuilds,deferred:d.deferred,initial:d.initial,age:d.age,surfaceTemperature:d.surfaceTemperature,albedo:d.albedo,mode:d.mode,temperature:d.temperature,mass:d.mass,cloud:d.cloud,dust:d.dust,soot:d.soot,gas:d.gas};
   row.rebuildRate=d.calls?d.rebuilds/d.calls:0;
   result.windows.push(row);
  }
  solver.dispose();global.gc?.();
 }
 const win=(a,b)=>{const slice=result.stepMs.slice(a,b);return {steps:slice.length,meanMs:slice.reduce((x,y)=>x+y,0)/slice.length,maxMs:Math.max(...slice),p95Ms:[...slice].sort((x,y)=>x-y)[Math.floor(slice.length*.95)]};};
 result.timing={first:win(0,1),warmup:win(1,30),mid:win(30,100),late:win(100,totalSteps),overall:win(0,totalSteps)};
 writeFileSync(out+`/radiation-structure-${label}.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify({label,timing:result.timing,windows:result.windows.map(w=>({from:w.from,to:w.to,calls:w.calls,rebuilds:w.rebuilds,rate:+w.rebuildRate.toFixed(4),gas:w.gas,temperature:w.temperature,mass:w.mass,cloud:w.cloud}))},null,1));
}finally{await server.close();}
