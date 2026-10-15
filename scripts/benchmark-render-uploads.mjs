import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {writeFileSync,mkdirSync} from 'node:fs';
const root=process.cwd(),out=resolve(process.argv[2]??'artifacts/performance/render-uploads.json');
const {createServer}=await import(pathToFileURL(createRequire(resolve(root,'package.json')).resolve('vite')).href);
const server=await createServer({root,configFile:false,envDir:false,cacheDir:'/tmp/sandsphere-render-uploads-cache',server:{middlewareMode:true,ws:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
try{
 const {createSphere}=await server.ssrLoadModule('/src/sim/sphere.ts'),{dualSurface}=await server.ssrLoadModule('/src/render/surface.ts'),{VertexUploadGate}=await server.ssrLoadModule('/src/render/vertexUploadGate.ts');
 const grid=createSphere(4),surface=dualSurface(grid,0),vertices=surface.indices.length;
 const specs=[['terrainData',3],['normals',3],['colors',4],['surfaceInfo',4],['waterData',6],['waterNormals',6],['waterColors',8],['heatPositions',3],['heatColors',4]];
 const arrays=specs.map(([key,width])=>[key,Float32Array.from({length:vertices*width},(_,i)=>Math.sin(i*.031))]),bytesPerRefresh=arrays.reduce((n,[,a])=>n+a.byteLength,0),runs=[];
 for(const changed of [[],['heatColors'],specs.map(([key])=>key)]){
  const gate=new VertexUploadGate();for(const [key,a]of arrays)gate.changed(key,a);const start=performance.now();let calls=0,bytes=0;
  for(let n=0;n<60;n++)for(const [key,a]of arrays){if(changed.includes(key))a[n%a.length]+=.001;if(gate.changed(key,a)){calls++;bytes+=a.byteLength;}}
  runs.push({changed,refreshes:60,meanCompareMs:(performance.now()-start)/60,oldUploadCalls:60*9,newUploadCalls:calls,oldUploadBytes:bytesPerRefresh*60,newUploadBytes:bytes,stats:gate.stats()});
 }
 const result={method:'CPU comparison of real dual-surface buffer dimensions with synthetic staging values; no GPU or browser FPS measured',cells:grid.count,triangles:vertices/3,vertices,bytesPerRefresh,runs};mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await server.close();}
