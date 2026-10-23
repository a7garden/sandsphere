import {CpuSolver,COMMAND_STRIDE,emptyStock,seedWorld,totalEnthalpy,type Snapshot} from '../../../src/sim/model';
import {createSphere} from '../../../src/sim/sphere';
import {orbitalEnvironment} from '../../../src/sim/orbit';
import {sandboxDefinition} from '../../../src/sim/planetDefinition';
import {BackgroundWorlds,prepareSystemSave,validSystem,type PlanetRecord,type ModeWorld,type SystemSave} from '../../../src/sim/system';
import {TelemetryStore} from '../../../src/sim/telemetry';
import {archiveTelemetry} from '../../../src/sim/telemetryPersistence';
import {climateSnapshotFromCheckpoint} from '../../../src/sim/climateSnapshot';
import {preparePersistenceInWorker} from '../../../src/sim/persistencePreparationClient';
import type {PersistenceCapture,SnapshotMetadata} from '../../../src/sim/persistencePreparation';
import {BrowserSystemStorage,loadRecord,prepareBrowserStorage} from '../../../src/sim/browserStorage';

const output=document.querySelector<HTMLPreElement>('#results')!,button=document.querySelector<HTMLButtonElement>('#run')!;
const DT=1/30,GRID_LEVEL=4,STEPS=5,MAX_ELAPSED=58000;
const prefix='persistence-performance-'+crypto.randomUUID(),ownedKeys=new Set<string>();
const grid=createSphere(GRID_LEVEL),environment={...orbitalEnvironment(1),climate:true,body:sandboxDefinition('rock',1,1)};
const rows:Record<string,unknown>[]=[];
let started=false;
function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message);}
function metadata(snapshot:Snapshot):SnapshotMetadata{return Object.fromEntries(Object.keys(snapshot).filter(key=>key!=='state'&&key!=='climate').map(key=>[key,snapshot[key as keyof Snapshot]])) as SnapshotMetadata;}
function nextFrame(){return new Promise<number>(resolve=>requestAnimationFrame(resolve));}
function quantile(values:number[],q:number){if(!values.length)return null;const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*q)];}
function arrayExact(a:ArrayLike<number>,b:ArrayLike<number>){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(!Object.is(a[i],b[i]))return false;return true;}
function exact(actual:unknown,expected:unknown):boolean{
 if(Object.is(actual,expected))return true;if(!actual||!expected||typeof actual!=='object'||typeof expected!=='object')return false;
 if(Array.isArray(actual)!==Array.isArray(expected))return false;
 const a=actual as Record<string,unknown>,b=expected as Record<string,unknown>,ak=Object.keys(a).filter(k=>a[k]!==undefined),bk=Object.keys(b).filter(k=>b[k]!==undefined);
 return ak.length===bk.length&&bk.every(key=>Object.hasOwn(a,key)&&exact(a[key],b[key]));
}
async function sha(bytes:Uint8Array<ArrayBuffer>){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');}
interface Fixture {active:CpuSolver;planets:PlanetRecord[];background:BackgroundWorlds;telemetry:TelemetryStore;other?:ModeWorld;otherRevision:number;}
function canonicalPlanet(fixture:Fixture,planet:PlanetRecord):PlanetRecord{
 if(planet.id==='planet-0')return {...planet,snapshot:{...metadata(planet.snapshot),state:Array.from(fixture.active.state),climate:fixture.active.climate.snapshot()}};
 const typed=fixture.background.capture(planet);assert(typed,'background getter was materialized before capture');
 return {id:planet.id,name:planet.name,snapshot:{...metadata(planet.snapshot),state:Array.from(typed.state),climate:climateSnapshotFromCheckpoint(typed.climate)}};
}
function archive(store:TelemetryStore,planets:PlanetRecord[],active?:CpuSolver){return archiveTelemetry(store,planets.map(p=>{const state=new Float32Array(p.snapshot.state);return {id:p.id,name:p.name,input:{...p.snapshot,directions:grid.directions,state,escaped:p.snapshot.escaped??0,transferredIn:p.snapshot.transferredIn??0,transferredOut:p.snapshot.transferredOut??0},settledEnergy:active&&p.id==='planet-0'?totalEnthalpy(state,p.snapshot.climate)-totalEnthalpy(active.state,active.climate):0};}));}
function record(store:TelemetryStore,planet:PlanetRecord){const s=planet.snapshot;store.sample(planet.id,planet.name,{...s,directions:grid.directions,state:new Float32Array(s.state),escaped:0,transferredIn:0,transferredOut:0},true);}
async function fixture(worlds:1|4|8,base:Snapshot):Promise<Fixture>{
 const active=new CpuSolver(grid,new Float32Array(base.state));active.climate.restore(base.climate);
 const planets=Array.from({length:Math.min(4,worlds)},(_,i)=>({id:'planet-'+i,name:'Measured '+i,snapshot:{...structuredClone(base),paused:i===0}}));
 const background=new BackgroundWorlds(grid),telemetry=new TelemetryStore();
 // The inactive planets run the common production step and retain the same lazy,
 // committed typed read model as the application. Fixture setup is not timed.
 if(worlds>1)background.step(planets,'planet-0',DT);
 const result:Fixture={active,planets,background,telemetry,otherRevision:worlds};
 for(const planet of planets)record(telemetry,canonicalPlanet(result,planet));
 if(worlds===8){
  const otherPlanets=Array.from({length:4},(_,i)=>({id:'planet-'+i,name:'Retained '+i,snapshot:structuredClone(base)})),otherTelemetry=new TelemetryStore();
  for(const planet of otherPlanets)record(otherTelemetry,planet);
  result.other={activeId:'planet-0',planets:otherPlanets,stock:emptyStock(),telemetry:archive(otherTelemetry,otherPlanets)};
 }
 await nextFrame();return result;
}
function capture(f:Fixture,stamp:number):PersistenceCapture{
 const activeMetadata={...metadata(f.planets[0].snapshot),savedAt:stamp};
 return {grid,system:{version:3,mode:'sandbox',activeId:'planet-0',stock:emptyStock(),savedAt:stamp},planets:f.planets.map(planet=>{
  if(planet.id==='planet-0')return {id:planet.id,name:planet.name,metadata:activeMetadata,state:[],climate:undefined,typed:false};
  const typed=f.background.capture(planet);assert(typed,'inactive capture resolved public arrays');return {id:planet.id,name:planet.name,metadata:metadata(planet.snapshot),state:typed.state,climate:typed.climate,typed:true};
 }),active:{metadata:activeMetadata,state:f.active.state.slice(),climate:f.active.climate.checkpoint(),pending:new Float64Array(grid.count*COMMAND_STRIDE),falling:[]},telemetry:f.telemetry.planets,other:f.other,otherRevision:f.otherRevision};
}
function expectedSystem(f:Fixture,stamp:number):SystemSave{
 const planets=f.planets.map(p=>canonicalPlanet(f,p));planets[0].snapshot.savedAt=stamp;
 const system=prepareSystemSave({version:3,mode:'sandbox',activeId:'planet-0',planets,stock:emptyStock(),other:f.other,savedAt:stamp},grid.count);
 system.telemetry=archive(f.telemetry,system.planets,f.active);return system;
}
function observe(){
 const gaps:number[]=[],tasks:{start:number;duration:number}[]=[];let last:number|undefined,frame=0,running=true;
 const loop=(time:number)=>{if(!running)return;if(last!==undefined)gaps.push(time-last);last=time;frame=requestAnimationFrame(loop);};frame=requestAnimationFrame(loop);
 const longTaskObserver=typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes.includes('longtask')?new PerformanceObserver(list=>{for(const entry of list.getEntries())tasks.push({start:entry.startTime,duration:entry.duration});}):undefined;
 longTaskObserver?.observe({type:'longtask'});
 return {stop(){running=false;cancelAnimationFrame(frame);for(const entry of longTaskObserver?.takeRecords()??[])tasks.push({start:entry.startTime,duration:entry.duration});longTaskObserver?.disconnect();return {rafSamples:gaps.length,rafMedianMs:quantile(gaps,.5),rafP95Ms:quantile(gaps,.95),rafMaxMs:gaps.length?Math.max(...gaps):null,longTasksSupported:!!longTaskObserver,longTasks:tasks,longTaskTotalMs:tasks.reduce((sum,task)=>sum+task.duration,0)};}};
}
async function inspect(f:Fixture,worlds:1|4|8,repetition:number,deadline:number){
 assert(!document.hidden,'tab was hidden; sample is invalid');
 const slot=prefix+'-'+worlds+'-'+repetition,key=slot+'-resume',saver=new BrowserSystemStorage(slot,key);ownedKeys.add(key);ownedKeys.add(key+'-pending');await saver.read(value=>validSystem(value,grid.count));
 const generation={value:saver.captureGeneration()},stamp=Date.now()+worlds*10+repetition;
 await nextFrame();await nextFrame();const observer=observe(),sampleStart=performance.now();
 let putSyncMs=0,putCalls=0,firstPutAt:number|undefined;const originalPut=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value:unknown,id?:IDBValidKey){
  if(typeof id!=='string'||!id.startsWith(prefix))return originalPut.call(this,value,id!);
  const start=performance.now();firstPutAt??=start;try{return originalPut.call(this,value,id!);}finally{putSyncMs+=performance.now()-start;putCalls++;}
 };
 let measurement:ReturnType<ReturnType<typeof observe>['stop']>;
 try{
  const captureStart=performance.now(),input=capture(f,stamp),captureEnd=performance.now();
  const postStart=performance.now(),pending=preparePersistenceInWorker(input),postEnd=performance.now(),prepared=await pending,preparedAt=performance.now();
  assert(performance.now()<deadline,'overall inspector budget expired after worker preparation');
  const saveStart=performance.now(),written=saver.savePrepared(prepared.savedAt,prepared.bytes,undefined,generation),saveCallEnd=performance.now();assert(await written,'isolated save was superseded');const completeAt=performance.now();
  await nextFrame();await nextFrame();measurement=observer.stop();
  // All exactness work is outside the measured capture/encode/IDB interval.
  const verificationStart=performance.now(),restored=await saver.read(value=>validSystem(value,grid.count)),disk=restored.disk;
  assert(validSystem(disk,grid.count),'restored canonical system is invalid');
  const envelope=await loadRecord(slot) as {transport?:string;bytes?:Uint8Array<ArrayBuffer>};assert(envelope.transport==='sandsphere-binary-gzip-1'&&!!envelope.bytes,'compact primary missing');
  const encodedSha256=await sha(prepared.bytes),storedSha256=await sha(envelope.bytes);assert(encodedSha256===storedSha256,'stored compressed bytes differ');
  const expected=expectedSystem(f,stamp),wholeSystemExact=exact(disk,expected);assert(wholeSystemExact,'canonical state, cache, carry or telemetry differs after restore');
  assert(f.active.state.byteLength>0&&grid.directions.byteLength>0&&Array.from(f.telemetry.planets.values()).every(record=>record.energy.byteLength===32),'a live physics/grid/telemetry buffer was detached');
  let resume:{stateExact:boolean;climateExact:boolean}|null=null;
  if(performance.now()<deadline-1500){
   const source=new CpuSolver(grid,f.active.state.slice()),restoredSolver=new CpuSolver(grid,new Float32Array(disk.planets[0].snapshot.state));
   try{source.climate.restore(f.active.climate.snapshot());restoredSolver.climate.restore(disk.planets[0].snapshot.climate);const empty=new Float64Array(grid.count*COMMAND_STRIDE);source.advance(DT,empty,environment);restoredSolver.advance(DT,empty,environment);resume={stateExact:arrayExact(source.state,restoredSolver.state),climateExact:exact(source.climate.snapshot(),restoredSolver.climate.snapshot())};assert(resume.stateExact&&resume.climateExact,'one-step resumed canonical state differs');}finally{source.dispose();restoredSolver.dispose();}
  }
  rows.push({worlds,activeModeWorlds:Math.min(worlds,4),otherModeWorlds:worlds===8?4:0,repetition,firstPersistenceWorkerUse:rows.length===0,retainedModeFirstTransfer:worlds===8&&repetition===0,gridCells:grid.count,activeSteps:STEPS,backgroundSteps:STEPS+1,telemetryPoints:Array.from(f.telemetry.planets.values()).reduce((sum,record)=>sum+record.points.length,0)+(f.other?.telemetry?.planets.reduce((sum,record)=>sum+record.points.length,0)??0),captureSyncMs:captureEnd-captureStart,workerPostSyncMs:postEnd-postStart,workerElapsedAfterPostMs:preparedAt-postEnd,captureToPreparedMs:preparedAt-captureStart,idbSaveCallSyncMs:saveCallEnd-saveStart,idbPutSyncMs:putSyncMs,idbPutCalls:putCalls,idbSaveCompleteMs:completeAt-saveStart,idbSubmitToCompleteMs:firstPutAt===undefined?null:completeAt-firstPutAt,measuredElapsedMs:completeAt-sampleStart,gzipBytes:prepared.bytes.byteLength,...measurement,verification:{wholeSystemExact,compressedBytesExact:encodedSha256===storedSha256,encodedSha256,storedSha256,resume,verificationElapsedMs:performance.now()-verificationStart},visible:!document.hidden});
 }finally{IDBObjectStore.prototype.put=originalPut;observer.stop();}
 output.textContent=JSON.stringify({complete:false,prefix,rows},null,2);
}
async function cleanup(){
 for(const key of ownedKeys)localStorage.removeItem(key);
 const db=await prepareBrowserStorage();await new Promise<void>((resolve,reject)=>{const transaction=db.transaction('snapshots','readwrite'),store=transaction.objectStore('snapshots'),keys=store.getAllKeys(IDBKeyRange.bound(prefix,prefix+'\uffff'));keys.onsuccess=()=>{for(const key of keys.result)store.delete(key);};transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});
}
async function run(){
 if(started)return;started=true;button.disabled=true;const start=performance.now(),deadline=start+MAX_ELAPSED;let failure:string|undefined,skipped=false;
 try{
  await prepareBrowserStorage();
  const solver=new CpuSolver(grid,seedWorld(grid,'coast',22)),empty=new Float64Array(grid.count*COMMAND_STRIDE);
  let base:Snapshot;try{for(let step=0;step<STEPS;step++){solver.advance(DT,empty,environment);await nextFrame();}base={version:11,preset:'coast',state:Array.from(solver.state),climate:solver.climate.snapshot(),time:STEPS*DT,environment,discoveries:[],supplied:0,removed:0,escaped:0,transferredIn:0,transferredOut:0,savedAt:Date.now(),paused:true};}finally{solver.dispose();}
  for(const worlds of [1,4,8] as const){
   if(performance.now()>deadline-5000){skipped=true;break;}const current=await fixture(worlds,base!);
   try{for(let repetition=0;repetition<2;repetition++){if(performance.now()>deadline-5000){skipped=true;break;}await inspect(current,worlds,repetition,deadline);}}finally{current.active.dispose();for(const p of current.planets)current.background.invalidate(p.id);}
  }
 }catch(error){failure=error instanceof Error?error.stack??error.message:String(error);}finally{await cleanup().catch(error=>{failure=(failure?failure+'\n':'')+'Cleanup: '+String(error);});}
 const result={complete:true,passed:!failure&&!skipped&&rows.length===6,scope:'production typed capture -> preparePersistenceInWorker -> BrowserSystemStorage.savePrepared; isolated browser storage; no cloud',date:new Date().toISOString(),url:location.href,userAgent:navigator.userAgent,gridLevel:GRID_LEVEL,gridCells:grid.count,evolvedSteps:STEPS,elapsedMs:performance.now()-start,requestedBudgetMs:MAX_ELAPSED,skippedForBudget:skipped,failure,prefix,rows,comparison:{legacyMeasuredHere:false,reason:'Uses only current production modules; compare capture/IDB synchronous submission against the preserved pre-change research measurements, not an invented legacy implementation.',reference:'docs/PERFORMANCE_RESEARCH_2026-10-23_KO.md section 3'},limits:['This is a focused browser storage inspector, not the full game frame loop.','Fixture setup, full canonical comparison and optional one-step resume are outside the measured capture/encode/IDB window.','Main rAF/Long Tasks cover capture through durable local completion; they are not GPU timing.','Two observations per world count are descriptive samples, not a statistical performance claim.','The retained mode is canonical and immutable, so its first structured transfer is measured once; the repeat uses the production worker cache.']};
 output.textContent=JSON.stringify(result,null,2);
 const endpoint='/__performance/result/persistence-performance-'+Date.now();
 try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});assert(response.ok,'result upload returned '+response.status);output.textContent=JSON.stringify({...result,resultPost:endpoint},null,2);}catch(error){output.textContent=JSON.stringify({...result,resultPostError:String(error)},null,2);}
}
button.addEventListener('click',()=>void run());
if(new URLSearchParams(location.search).get('autorun')==='1')void run();
