/** Local build graph with no environment files, account access or deployment. */
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {writeFileSync,readdirSync,readFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {gzipSync,brotliCompressSync} from 'node:zlib';
const root=process.cwd(),prefix=resolve(process.argv[2]??'artifacts/performance/bundle'),outDir=mkdtempSync(join(tmpdir(),'sandsphere-bundle-'));
mkdirSync(dirname(prefix),{recursive:true});
const {build}=await import(pathToFileURL(createRequire(resolve(root,'package.json')).resolve('vite')).href);
let chunks=[];const started=performance.now();
await build({root,configFile:false,envDir:false,cacheDir:'/tmp/sandsphere-performance-build-cache-20261015',build:{target:'es2022',outDir,emptyOutDir:true,rolldownOptions:{input:{app:root+'/index.html',clouds:root+'/clouds.html'}}},plugins:[{name:'performance-research-metadata',generateBundle(options,bundle){for(const [file,item] of Object.entries(bundle))if(item.type==='chunk')chunks.push({file,isEntry:item.isEntry,imports:item.imports,dynamicImports:item.dynamicImports,modules:Object.entries(item.modules??{}).map(([id,m])=>({id:id.replace(root+'/',''),bytes:m.renderedLength??m.originalLength??0}))});}}]});
const files=readdirSync(outDir+'/assets').map(file=>{const data=readFileSync(outDir+'/assets/'+file);return {file,bytes:data.length,gzipBytes:gzipSync(data).length,brotliBytes:brotliCompressSync(data).length};});
const result={buildMs:performance.now()-started,envFilesLoaded:false,outDir,files,chunks};writeFileSync(prefix+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify({buildMs:result.buildMs,largest:files.slice().sort((a,b)=>b.bytes-a.bytes).slice(0,7),chunks:chunks.length},null,2));
