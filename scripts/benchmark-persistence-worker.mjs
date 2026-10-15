/** Exercise the actual persistence Worker bundle with Node worker_threads.
 * No account, browser database, GPU or user save is accessed. */
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve,join,dirname} from 'node:path';
import {mkdtempSync,mkdirSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
const root=process.cwd(),out=resolve(process.argv[2]??'artifacts/performance/persistence-worker.json'),directory=mkdtempSync(join(tmpdir(),'sandsphere-save-worker-'));
const {createServer,build}=await import(pathToFileURL(createRequire(resolve(root,'package.json')).resolve('vite')).href);
await build({root,configFile:false,envDir:false,logLevel:'error',build:{target:'es2022',copyPublicDir:false,outDir:directory,emptyOutDir:false,minify:true,lib:{entry:resolve(root,'src/sim/savePreparation.worker.ts'),formats:['es'],fileName:()=> 'save.worker.mjs'}}});
const shim=join(directory,'node-worker.mjs');writeFileSync(shim,`import {parentPort,workerData} from 'node:worker_threads';globalThis.self=globalThis;globalThis.postMessage=(data,transfer=[])=>parentPort.postMessage(data,transfer);const queue=[];let ready=false;parentPort.on('message',data=>ready?globalThis.onmessage({data}):queue.push(data));await import(workerData.module);ready=true;for(const data of queue)globalThis.onmessage({data});`);
const worker=new Worker(pathToFileURL(shim),{workerData:{module:pathToFileURL(join(directory,'save.worker.mjs')).href}}),server=await createServer({root,configFile:false,envDir:false,logLevel:'error',cacheDir:join(directory,'cache'),server:{middlewareMode:true,ws:false,watch:null}});
let id=0;const request=(action,count,payload)=>new Promise((resolve,reject)=>{const current=++id,timer=setTimeout(()=>{worker.off('message',receive);reject(new Error('Worker timed out'));},30000);function receive(data){if(data.id!==current)return;clearTimeout(timer);worker.off('message',receive);resolve(data);}worker.on('message',receive);worker.once('error',reject);worker.postMessage({id:current,action,count,payload},[payload]);});
try{
 const {createSphere}=await server.ssrLoadModule('/src/sim/sphere.ts'),{createJupiterPlanet}=await server.ssrLoadModule('/src/sim/planetCreation.ts'),model=await server.ssrLoadModule('/src/sim/model.ts'),system=await server.ssrLoadModule('/src/sim/system.ts'),codec=await server.ssrLoadModule('/src/sim/saveCodec.ts');
 const grid=createSphere(4),planet=createJupiterPlanet(grid),cpu=new model.CpuSolver(grid,planet.state),commands=new Float32Array(grid.count*model.COMMAND_STRIDE);cpu.climate.restore(planet.climate);for(let n=0;n<14;n++)cpu.advance(1/30,commands,planet.environment);
 const snapshot={version:11,preset:'coast',state:[...cpu.state],climate:cpu.climate.snapshot(),environment:planet.environment,time:14/30,supplied:0,removed:0,discoveries:[]};
 const world={activeId:'planet-0',planets:Array.from({length:4},(_,i)=>({id:'planet-'+i,name:'Jupiter '+i,snapshot:structuredClone(snapshot)})),stock:model.emptyStock()},save={version:3,mode:'sandbox',...world,other:structuredClone(world),savedAt:1};
 const direct=codec.packSave(system.prepareSystemSave(save,grid.count)),input=await codec.packSaveAsync(save),beforeState=cpu.state.slice(),t=performance.now(),response=await request('prepare',grid.count,input),workerMs=performance.now()-t;
 if(response.error||!response.payload)throw new Error(response.error??'Missing payload');
 const hash=b=>createHash('sha256').update(new Uint8Array(b)).digest('hex'),exact=hash(response.payload)===hash(direct),decoded=await codec.unpackSaveAsync(response.payload),validation=await request('validate',grid.count,codec.packSave(decoded)),invalid=await request('prepare',grid.count,codec.packSave({...save,activeId:'missing'}));
 const liveStateUnchanged=cpu.state.every((v,i)=>Object.is(v,beforeState[i]))&&cpu.state.byteLength>0;
 const result={method:'Actual compiled persistence Worker via Node worker_threads; evolved 14x1/30s Jupiter state, 4 planets per mode, no telemetry; wire-byte equality against direct preparation',cells:grid.count,planets:8,workerBundleBytes:statSync(join(directory,'save.worker.mjs')).size,packedBytes:direct.byteLength,workerMs,exact,liveStateUnchanged,inputTransferred:input.byteLength===0,validationAccepted:validation.error===undefined,invalidRejected:typeof invalid.error==='string'};
 if(!exact||!liveStateUnchanged||!result.validationAccepted||!result.invalidRejected)throw new Error('Persistence contract failed');mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));cpu.dispose();
}finally{await worker.terminate();await server.close();}
