import {readFile} from 'node:fs/promises';
import {request} from 'node:https';
import {lookup as systemLookup,Resolver} from 'node:dns';
const resolver=new Resolver();
resolver.setServers(['1.1.1.1','1.0.0.1']);
function lookup(host,options,callback){
 systemLookup(host,{family:4},(error,address,family)=>{
  if(!error)return callback(null,address,family);
  if(!['ENOTFOUND','EAI_AGAIN'].includes(error.code))return callback(error);
  // macOS may retain a negative answer from before a Custom Domain exists.
  // Resolve through Cloudflare's public DNS; TLS still verifies sandsphere.app.
  resolver.resolve4(host,(failure,addresses)=>callback(failure,addresses?.[0],4));
 });
}
function get(path){
 return new Promise((resolve,reject)=>{
  const req=request('https://sandsphere.app'+path,{family:4,lookup,headers:{'Cache-Control':'no-cache'}},response=>{
   let body='',size=0;
   response.on('data',chunk=>{size+=chunk.length;if(size>1024*1024)req.destroy(new Error('Unexpectedly large health-check response'));else body+=chunk;});
   response.on('end',()=>{if(response.statusCode!==200)reject(new Error(`HTTP ${response.statusCode}`));else resolve(body);});
   response.on('error',reject);
  });
  const timer=setTimeout(()=>req.destroy(new Error('Deployment health check timed out')),12000);
  req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end();
 });
}
const expected=JSON.parse(await readFile('dist/release.json','utf8'));
for(let attempt=0;attempt<12;attempt++){
 try{
  const actual=JSON.parse(await get('/release.json'));
  if(actual.tag!==expected.tag||actual.commit!==expected.commit)throw new Error('The domain is still serving a different release.');
  await get('/');console.log(`Verified ${expected.tag} at https://sandsphere.app`);process.exit(0);
 }catch(error){if(attempt===11)throw error;await new Promise(resolve=>setTimeout(resolve,5000));}
}
