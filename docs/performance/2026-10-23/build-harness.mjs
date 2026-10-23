import {build} from '/Users/garden/Workspace/Projects/sandsphere/node_modules/vite/dist/node/index.js';
import {writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {gzipSync,brotliCompressSync} from 'node:zlib';
const root='/Users/garden/Workspace/Projects/sandsphere',outDir='/tmp/sandsphere-performance-build-20261023';
let chunks=[];const started=performance.now();
await build({root,configFile:false,envDir:false,cacheDir:'/tmp/sandsphere-performance-build-cache-20261023',build:{target:'es2022',outDir,emptyOutDir:true,rolldownOptions:{input:{app:root+'/index.html',clouds:root+'/clouds.html'}}},plugins:[{name:'performance-research-metadata',generateBundle(options,bundle){for(const [file,item] of Object.entries(bundle))if(item.type==='chunk')chunks.push({file,isEntry:item.isEntry,imports:item.imports,dynamicImports:item.dynamicImports,modules:Object.entries(item.modules??{}).map(([id,m])=>({id:id.replace(root+'/',''),bytes:m.renderedLength??m.originalLength??0}))});}}]});
const files=readdirSync(outDir+'/assets').map(file=>{const data=readFileSync(outDir+'/assets/'+file);return {file,bytes:data.length,gzipBytes:gzipSync(data).length,brotliBytes:brotliCompressSync(data).length};});
const result={buildMs:performance.now()-started,envFilesLoaded:false,outDir,files,chunks};writeFileSync('/tmp/sandsphere-performance-bundle-20261023.json',JSON.stringify(result,null,2));console.log(JSON.stringify({buildMs:result.buildMs,largest:files.slice().sort((a,b)=>b.bytes-a.bytes).slice(0,7),chunks:chunks.length},null,2));
