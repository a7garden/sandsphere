import {createServer} from '/Users/garden/Workspace/Projects/sandsphere/node_modules/vite/dist/node/index.js';
import {writeFileSync} from 'node:fs';
const server=await createServer({configFile:false,envDir:false,root:'/Users/garden/Workspace/Projects/sandsphere',cacheDir:'/tmp/sandsphere-perf-ssr-20261015',server:{middlewareMode:true,ws:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
try{
 const model=await server.ssrLoadModule('/src/sim/model.ts'),sphere=await server.ssrLoadModule('/src/sim/sphere.ts'),creation=await server.ssrLoadModule('/src/sim/planetCreation.ts'),systemModule=await server.ssrLoadModule('/src/sim/system.ts'),firebase=await server.ssrLoadModule('/src/account/firebase.ts');
 const grid=sphere.createSphere(4),p=creation.createJupiterPlanet(grid),solver=new model.CpuSolver(grid,p.state),commands=new Float32Array(grid.count*model.COMMAND_STRIDE);solver.climate.restore(p.climate);
 for(let n=0;n<14;n++)solver.advance(1/30,commands,p.environment);
 const snapshot={version:11,preset:'coast',state:[...solver.state],climate:solver.climate.snapshot(),environment:p.environment,time:14/30,supplied:0,removed:0,discoveries:[]};
 const world={activeId:'planet-0',planets:Array.from({length:4},(_,i)=>({id:'planet-'+i,name:'Research '+i,snapshot:structuredClone(snapshot)})),stock:model.emptyStock()};
 const system=systemModule.prepareSystemSave({version:3,mode:'sandbox',...world,other:structuredClone(world),savedAt:1},grid.count);
 let encodingError=null,encodedBytes=null;try{encodedBytes=(await firebase.encodeSave(system)).size;}catch(error){encodingError=error.message;}
 const data={cells:grid.count,planets:8,steps:14,gameSeconds:14/30,validSystem:systemModule.validSystem(system,grid.count),rawBytes:new TextEncoder().encode(JSON.stringify(system)).length,limitBytes:20*1024*1024,encodedBytes,encodingError,telemetryIncluded:false};
 writeFileSync('/tmp/sandsphere-performance-save-limit-20261015.json',JSON.stringify(data,null,2));console.log(JSON.stringify(data,null,2));solver.dispose();
}finally{await server.close();}
