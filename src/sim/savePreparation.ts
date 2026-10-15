import type {SystemSave} from './system';
import {packSaveAsync,unpackSaveAsync} from './saveCodec';

class InvalidSave extends Error {}
let worker:Worker|null=null,unavailable=false,nextId=0;
const pending=new Map<number,{resolve:(value:ArrayBuffer|undefined)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
function stop(error:Error){worker?.terminate();worker=null;unavailable=true;for(const job of pending.values()){clearTimeout(job.timer);job.reject(error);}pending.clear();}
function getWorker(){
 if(unavailable||typeof Worker==='undefined')return null;
 if(worker)return worker;
 try{
  worker=new Worker(new URL('./savePreparation.worker.ts',import.meta.url),{type:'module',name:'Sandsphere persistence'});
  worker.onmessage=({data}:MessageEvent<{id:number;payload?:ArrayBuffer;error?:string}>)=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);clearTimeout(job.timer);if(data.error)job.reject(new InvalidSave(data.error));else job.resolve(data.payload);};
  worker.onerror=event=>{event.preventDefault();stop(new Error(event.message||'Persistence worker stopped'));};
  worker.onmessageerror=()=>stop(new Error('Persistence worker response could not be read'));
  return worker;
 }catch{unavailable=true;return null;}
}
async function run(system:SystemSave,count:number,action:'prepare'|'validate'):Promise<SystemSave|undefined>{
 const active=getWorker();
 if(active){
  try{
   const payload=await packSaveAsync(system),id=++nextId;
   const reply=await new Promise<ArrayBuffer|undefined>((resolve,reject)=>{const timer=setTimeout(()=>stop(new Error('Persistence worker timed out')),30000);pending.set(id,{resolve,reject,timer});try{active.postMessage({id,action,count,payload},[payload]);}catch(error){stop(error instanceof Error?error:new Error(String(error)));}});
   if(action==='prepare'){if(!reply)throw new Error('Missing prepared save');return await unpackSaveAsync(reply) as SystemSave;}return;
  }catch(error){if(error instanceof InvalidSave)throw error;stop(error instanceof Error?error:new Error(String(error)));}
 }
 const module=await import('./system');
 if(action==='prepare')return module.prepareSystemSave(system,count);
 if(!module.validSystem(system,count))throw new Error('완전한 저장본만 업로드할 수 있습니다.');
}
export async function prepareSystemSaveAsync(system:SystemSave,count:number){return (await run(system,count,'prepare'))!;}
export async function validateSystemSaveAsync(system:SystemSave,count:number){await run(system,count,'validate');}
