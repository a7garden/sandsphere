import {encodeSaveBytes} from '../src/sim/saveCodec';
import {BrowserSystemStorage,BrowserSaveConflict,latestResume,loadRecord,prepareBrowserStorage,pruneLifecycleCheckpoints,saveSnapshot} from '../src/sim/browserStorage';
import {createSphere} from '../src/sim/sphere';
import {createJupiterPlanet,createSaturnPlanet} from '../src/sim/planetCreation';
import {emptyStock,type Snapshot} from '../src/sim/model';
import {prepareSystemSave,validSystem,type SystemSave} from '../src/sim/system';
import {prepareCheckpointWorker,checkpointWorkerAvailable} from '../src/sim/checkpointWorkerClient';

const output=document.querySelector<HTMLPreElement>('#results')!;
const prefix='persistence-verification-'+crypto.randomUUID(),ownedSlots=new Set<string>(),ownedKeys=new Set<string>();
const cases:{name:string;passed:boolean;details?:unknown}[]=[];
function assert(condition:unknown,message:string):asserts condition {if(!condition)throw new Error(message);}
function store(label:string){const slot=prefix+'-'+label,key=slot+'-resume';ownedSlots.add(slot);ownedSlots.add(slot+'-telemetry-base');ownedSlots.add(slot+'-resume-receipt');ownedSlots.add(slot+'-lifecycle-generation');ownedKeys.add(key);ownedKeys.add(key+'-pending');return new BrowserSystemStorage(slot,key);}
const valid=(value:unknown):value is SystemSave=>validSystem(value,createSphere(0).count);
function world(subdivisions:number,savedAt:number):SystemSave {
 const grid=createSphere(subdivisions),presets=[createJupiterPlanet(grid),createSaturnPlanet(grid)];
 const planets=Array.from({length:4},(_,i)=>{const p=presets[i%2],snapshot:Snapshot={version:11,preset:'coast',state:[...p.state],climate:structuredClone(p.climate),environment:structuredClone(p.environment),spin:structuredClone(p.spin),time:0,supplied:0,removed:0,discoveries:[]};return {id:'planet-'+i,name:'Giant '+i,snapshot};});
 const profile={activeId:'planet-0',planets,stock:emptyStock(),telemetry:{version:1 as const,planets:[]}};
 return prepareSystemSave({version:3,mode:'sandbox',...profile,other:structuredClone(profile),savedAt},grid.count);
}
async function check(name:string,run:()=>Promise<unknown>){try{cases.push({name,passed:true,details:await run()});}catch(error){cases.push({name,passed:false,details:String(error)});}output.textContent=JSON.stringify({complete:false,cases},null,2);}
async function cleanup(){
 for(const key of ownedKeys)localStorage.removeItem(key);
 const db=await prepareBrowserStorage();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots');for(const slot of ownedSlots)store.delete(slot);const keys=store.getAllKeys(IDBKeyRange.bound(prefix,prefix+'\uffff'));keys.onsuccess=()=>{for(const key of keys.result)store.delete(key);};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
}
async function sha(raw:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(v=>v.toString(16).padStart(2,'0')).join('');}

async function run(){
 const small=world(0,10),large=world(4,100),largeRaw=JSON.stringify(large),bytes=new TextEncoder().encode(largeRaw).byteLength;
 await check('independent persistence worker activates without controlling pages',async()=>{assert(await prepareCheckpointWorker(),'persistence worker unavailable');return {available:checkpointWorkerAvailable()};});
 await check('legacy localStorage recovery and verified migration without deletion',async()=>{
  const saver=store('legacy');localStorage.setItem(saver.resumeKey,JSON.stringify(small));
  const reader=new BrowserSystemStorage(saver.slot,saver.resumeKey),before=await reader.read();
  assert(JSON.stringify(latestResume(before.disk,before.legacy,valid))===JSON.stringify(small),'legacy world did not restore');
  await reader.save({...small,savedAt:11});const after=await new BrowserSystemStorage(saver.slot,saver.resumeKey).read();
  assert(after.legacy===undefined,'migrated legacy was still selected');assert(localStorage.getItem(saver.resumeKey)===JSON.stringify(small),'legacy data changed');
  return {legacyPreserved:true,committedAt:(after.disk as SystemSave).savedAt};
 });
 await check('compact migration preserves one compatible raw backup across later saves',async()=>{
  const saver=store('binary-backup');await saver.read();await saveSnapshot(small,saver.slot);
  await saver.save({...small,savedAt:11});const raw=await loadRecord(saver.slot) as {transport?:string};
  assert(raw.transport==='sandsphere-binary-gzip-1','primary did not use compact transport');
  assert(JSON.stringify(await loadRecord(saver.slot+'-before-binary-v1'))===JSON.stringify(small),'original raw backup changed');
  await saver.save({...small,savedAt:12});assert(JSON.stringify(await loadRecord(saver.slot+'-before-binary-v1'))===JSON.stringify(small),'later save overwrote compatible backup');
  assert(((await saver.read()).disk as SystemSave).savedAt===12,'compact read failed');return {rawBackupPreserved:true,savedAt:12};
 });
 await check('stale asynchronous preparation cannot overwrite a chosen branch',async()=>{
  const saver=store('prepared-generation');await saver.read();await saver.save({...small,savedAt:100});
  const generation={value:saver.captureGeneration()},bytes=await encodeSaveBytes({...small,savedAt:101});
  await saver.save({...small,savedAt:1},undefined,{replace:true});
  let conflict=false;try{await saver.savePrepared(101,bytes,undefined,generation);}catch(error){conflict=error instanceof BrowserSaveConflict;}
  assert(conflict,'stale prepared save was accepted');assert(((await saver.read()).disk as SystemSave).savedAt===1,'stale prepared bytes replaced selected branch');return {rejected:true,selectedAt:1};
 });
 await check('corrupt compact lifecycle does not hide an earlier complete primary',async()=>{
  const saver=store('corrupt-compact');await saver.read();await saver.save(small);
  const bytes=await encodeSaveBytes({...small,savedAt:12});bytes[bytes.length-2]^=255;
  const key=saver.slot+'-lifecycle-12|test|';await saveSnapshot({version:1,system:{transport:'sandsphere-binary-gzip-1',savedAt:12,bytes}},key);
  assert(((await saver.read(valid)).disk as SystemSave).savedAt===10,'corrupt compact recovery displaced primary');return {lastCompleteAt:10};
 });
 await check('eight full-resolution giant worlds round-trip above 5 MiB',async()=>{
  assert(bytes>5*1024*1024,'fixture is too small');const saver=store('large');await saver.read();
  await saver.save(large);const restored=await saver.read();
  assert(validSystem(restored.disk,createSphere(4).count),'persisted system is invalid');assert(JSON.stringify(restored.disk)===largeRaw,'full system round trip changed values');
  return {bytes,cells:createSphere(4).count,planets:8,exact:true};
 });
 await check('exhausted localStorage cannot prevent full IndexedDB checkpoint',async()=>{
  const saver=store('quota');await saver.read();const filler=prefix+'-quota',probe=prefix+'-quota-probe';ownedKeys.add(filler);ownedKeys.add(probe);
  let low=0,high=6*1024*1024,quotaName='';
  try{
   while(high-low>1){const middle=Math.floor((low+high)/2);try{localStorage.setItem(filler,'q'.repeat(middle));low=middle;}catch(error){quotaName=(error as DOMException).name;high=middle;}}
   let full=false;try{localStorage.setItem(probe,'x'.repeat(1024));}catch{full=true;}assert(full,'localStorage was not full');
   await saver.save(large);assert(JSON.stringify((await saver.read()).disk)===largeRaw,'IDB checkpoint failed while localStorage was full');
   return {quotaName,fillerCharacters:low,bytes,exact:true};
  }finally{localStorage.removeItem(filler);localStorage.removeItem(probe);}
 });
 await check('transaction abort preserves the world, telemetry base, and legacy receipt',async()=>{
  const saver=store('abort');localStorage.setItem(saver.resumeKey,JSON.stringify(small));const writer=new BrowserSystemStorage(saver.slot,saver.resumeKey);await writer.read();
  const base={savedAt:1,archive:{version:1,planets:[]}};await writer.save(small,{slot:saver.slot+'-telemetry-base',value:base});
  const original=IDBObjectStore.prototype.put;let failed=false;
  try{
   IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey){if(key===saver.slot)throw new DOMException('Forced verification quota error','QuotaExceededError');return original.call(this,value,key!);};
   try{await writer.save({...small,savedAt:12},{slot:saver.slot+'-telemetry-base',value:{savedAt:11}});}catch(error){failed=(error as DOMException).name==='QuotaExceededError';}
  }finally{IDBObjectStore.prototype.put=original;}
  const restored=await writer.read();assert(failed,'forced write did not reject');assert(JSON.stringify(restored.disk)===JSON.stringify(small),'failed transaction changed world');assert(JSON.stringify(restored.telemetryBase)===JSON.stringify(base),'failed transaction changed telemetry base');assert(restored.pendingAt===12,'interrupted checkpoint was not reported');assert(restored.legacy===undefined,'failed transaction damaged prior receipt');
  return {rejected:true,lastCommittedRetained:true,pendingAt:restored.pendingAt};
 });
 await check('newer checkpoint wins when an older automatic save arrives later',async()=>{
  const saver=store('race');await saver.read();
  const result=await Promise.all([saver.save({...small,savedAt:30},{slot:saver.slot+'-telemetry-base',value:{savedAt:29}}),saver.save({...small,savedAt:20},{slot:saver.slot+'-telemetry-base',value:{savedAt:19}})]);
  const restored=await saver.read();assert(result[0]&&!result[1],'stale save was not rejected');assert((restored.disk as SystemSave).savedAt===30,'older save replaced newer');assert((restored.telemetryBase as {savedAt:number}).savedAt===29,'stale companion replaced telemetry base');
  return {results:result,savedAt:30,baseSavedAt:29};
 });
 await check('save requests capture values synchronously before caller mutation',async()=>{
  const saver=store('immutable');await saver.read();await saver.save({...small,savedAt:9});const candidate=structuredClone(small),originalName=candidate.planets[0].name;
  const pending=saver.save(candidate);candidate.planets[0].name='Edited after save request';candidate.savedAt=0;await pending;
  const restored=await saver.read();assert((restored.disk as SystemSave).planets[0].name===originalName&&(restored.disk as SystemSave).savedAt===10,'requested save captured later mutation');assert(restored.pendingAt===undefined,'committed marker was not cleared');return {immutable:true};
 });
 await check('explicit replacement preserves legacy but prevents its resurrection',async()=>{
  const saver=store('replace');localStorage.setItem(saver.resumeKey,JSON.stringify({...small,savedAt:100}));const writer=new BrowserSystemStorage(saver.slot,saver.resumeKey);await writer.read();
  await writer.save({...small,savedAt:1},undefined,{replace:true});const restored=await new BrowserSystemStorage(saver.slot,saver.resumeKey).read();
  assert(restored.legacy===undefined&&(restored.disk as SystemSave).savedAt===1,'legacy overrode intentional replacement');assert(localStorage.getItem(saver.resumeKey)!==null,'legacy was deleted');
  localStorage.setItem(saver.resumeKey,JSON.stringify({...small,savedAt:101}));const changed=await new BrowserSystemStorage(saver.slot,saver.resumeKey).read();assert((latestResume(changed.disk,changed.legacy,valid))?.savedAt===101,'new legacy checkpoint was ignored');
  return {originalPreserved:true,replacementAt:1,newLegacyAt:101};
 });
 await check('stale lifecycle saves cannot replace newer checkpoints across writer instances',async()=>{
  const saver=store('lifecycle-race');await saver.read();await saver.save({...small,savedAt:200});
  const other=new BrowserSystemStorage(saver.slot,saver.resumeKey);await other.read();
  await saver.save({...small,savedAt:201},undefined,{lifecycle:true});await other.save({...small,savedAt:199},undefined,{lifecycle:true});
  assert(((await saver.read()).disk as SystemSave).savedAt===201,'older lifecycle replaced newer lifecycle');
  await saver.save({...small,savedAt:202});await other.save({...small,savedAt:198},undefined,{lifecycle:true});
  assert(((await saver.read()).disk as SystemSave).savedAt===202,'older lifecycle replaced newer primary');
  await saver.save({...small,savedAt:1},undefined,{replace:true});await other.save({...small,savedAt:203},undefined,{lifecycle:true});
  assert(((await saver.read()).disk as SystemSave).savedAt===1,'old-generation lifecycle resurrected replaced branch');
  let conflict=false;try{await other.save({...small,savedAt:204});}catch(error){conflict=error instanceof BrowserSaveConflict;}assert(conflict,'old-generation ordinary save did not surface a conflict');
  assert(((await saver.read()).disk as SystemSave).savedAt===1,'old-generation primary resurrected replaced branch');
  return {newestLifecycle:201,newestPrimary:202,replacementAt:1,oldWriterRejected:true};
 });
 await check('late cleanup from a former generation preserves the current checkpoint',async()=>{
  const saver=store('cleanup-generation');await saver.read();await saver.save({...small,savedAt:300},undefined,{replace:true});
  const formerGeneration=await loadRecord(saver.slot+'-lifecycle-generation') as string;
  assert(typeof formerGeneration==='string','checkpoint cleanup deleted the generation metadata');
  await saver.save({...small,savedAt:1},undefined,{replace:true});await saver.save({...small,savedAt:2},undefined,{lifecycle:true});
  await pruneLifecycleCheckpoints(saver.slot,1000,formerGeneration);
  assert(((await saver.read()).disk as SystemSave).savedAt===2,'former-generation cleanup deleted the current checkpoint');
  assert(typeof await loadRecord(saver.slot+'-lifecycle-generation')==='string','former cleanup deleted generation metadata');
  return {currentCheckpoint:2,formerCleanupStamp:1000,preserved:true};
 });
 await cleanup();output.textContent=JSON.stringify({complete:true,passed:cases.every(c=>c.passed),cases},null,2);
 const button=document.querySelector<HTMLButtonElement>('#prepare-reload')!;button.hidden=false;button.onclick=()=>void prepareReload(large).catch(error=>{output.textContent=String(error);});
}

async function prepareReload(large:SystemSave){
 const saver=store('reload');await saver.read();await saver.save({...large,savedAt:200});
 const latest={...large,savedAt:201},digest=await sha(JSON.stringify(latest)),metadata={slot:saver.slot,key:saver.resumeKey,digest,savedAt:201};
 sessionStorage.setItem('sandsphere-persistence-reload-probe',JSON.stringify(metadata));
 // This is the production synchronous-start writer. No save is requested until
 // the browser actually dispatches pagehide for the navigation below.
 window.addEventListener('pagehide',()=>{void saver.save(latest,undefined,{lifecycle:true}).catch(console.error);},{once:true});
 const link=document.querySelector<HTMLAnchorElement>('#reload-link')!;link.href=location.pathname+'?resumeProbe=1';link.hidden=false;
 output.textContent=JSON.stringify({prepared:true,workerAvailable:checkpointWorkerAvailable(),baseline:200,expected:201,digest,slot:saver.slot},null,2);
}
async function resumeProbe(){
 await prepareCheckpointWorker();
 const metadata=JSON.parse(sessionStorage.getItem('sandsphere-persistence-reload-probe')??'null') as {slot:string;key:string;digest:string;savedAt:number}|null;assert(metadata,'reload probe was not prepared');
 const saver=new BrowserSystemStorage(metadata.slot,metadata.key),restored=await saver.read(),raw=JSON.stringify(restored.disk),digest=await sha(raw),savedAt=(restored.disk as SystemSave|undefined)?.savedAt;
 const passed=savedAt===metadata.savedAt&&digest===metadata.digest;
 output.textContent=JSON.stringify({complete:true,passed,pagehideReload:true,savedAt,expected:metadata.savedAt,digest,expectedDigest:metadata.digest,bytes:new TextEncoder().encode(raw).byteLength,pendingAt:restored.pendingAt},null,2);
 // Keep the isolated probe until inspection; no user slots are touched.
}
void (new URLSearchParams(location.search).has('resumeProbe')?resumeProbe():run()).catch(error=>{output.textContent=JSON.stringify({complete:true,passed:false,error:String(error),cases},null,2);console.error(error);});
