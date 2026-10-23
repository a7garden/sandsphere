import {createServer} from 'vite';
import {writeFileSync,mkdirSync} from 'node:fs';
const root=new URL('../../../',import.meta.url).pathname,out=new URL('./',import.meta.url).pathname;
mkdirSync(out,{recursive:true});
const server=await createServer({root,configFile:false,envDir:false,cacheDir:'/tmp/sandsphere-performance-browser-cache-20261023',server:{host:'127.0.0.1',port:5183,strictPort:true},plugins:[{name:'research-receipts',configureServer(s){s.middlewares.use('/__performance/result/',(req,res,next)=>{if(req.method!=='POST')return next();const name=req.url?.replace(/^\//,'');if(!name||!/^[a-z0-9-]+$/.test(name)){res.statusCode=400;res.end();return;}let body='';req.on('data',b=>{body+=b;if(body.length>2000000)req.destroy();});req.on('end',()=>{try{const value=JSON.parse(body);writeFileSync(out+'browser-'+name+'.json',JSON.stringify(value,null,2)+'\n');res.end('saved');}catch{res.statusCode=400;res.end();}});});}}]});
await server.listen();console.log('Research server http://127.0.0.1:5183/docs/performance/2026-10-23/browser-lab.html');
