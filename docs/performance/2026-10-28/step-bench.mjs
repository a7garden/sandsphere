import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';import {tmpdir} from 'node:os';import {join} from 'node:path';
const root=process.env.ROOT??fileURLToPath(new URL('../../..',import.meta.url));
const presets=(process.env.PRESET??'coast,sandbox,mars,jupiter').split(','),steps=Number(process.env.STEPS??20),warm=Number(process.env.WARM??5);
const {createServer}=await import(root+'/node_modules/vite/dist/node/index.js');
const server=await createServer({configFile:false,envDir:false,root,logLevel:'error',cacheDir:join(tmpdir(),'ss-bench-'+createHash('md5').update(root).digest('hex').slice(0,6)),server:{middlewareMode:true,ws:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
try{
 const model=await server.ssrLoadModule('/src/sim/model.ts'),sphere=await server.ssrLoadModule('/src/sim/sphere.ts'),pc=await server.ssrLoadModule('/src/sim/planetCreation.ts');
 const grid=sphere.createSphere(4),dt=1/30;
 const make={coast:()=>({state:model.seedWorld(grid,'coast'),environment:{...model.environmentFor('coast'),climate:true}}),sandbox:()=>pc.createSandboxPlanet(grid,'rock',1,1,'nitrogen',1),water:()=>pc.createSandboxPlanet(grid,'water',1,1,'nitrogen',1),mars:()=>pc.createMarsPlanet(grid),jupiter:()=>pc.createJupiterPlanet(grid)};
 for(const preset of presets){
  const made=make[preset](),solver=new model.CpuSolver(grid,made.state);if(made.climate)solver.climate.restore(made.climate);
  const commands=new Float32Array(grid.count*model.COMMAND_STRIDE);
  for(let n=0;n<warm;n++)solver.advance(dt,commands,made.environment);
  const ms=[];for(let n=0;n<steps;n++){const t=performance.now();solver.advance(dt,commands,made.environment);ms.push(performance.now()-t);}
  ms.sort((a,b)=>a-b);
  console.log(JSON.stringify({preset,mean:+(ms.reduce((a,b)=>a+b,0)/ms.length).toFixed(1),p50:+ms[ms.length>>1].toFixed(1),p95:+ms[Math.floor(ms.length*.95)].toFixed(1)}));
  solver.dispose?.();
 }
}finally{await server.close();}
