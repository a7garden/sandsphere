import type {PersistenceCapture} from './persistencePreparation';
export interface PreparedPersistence {savedAt:number;activeSavedAt:number;bytes:Uint8Array<ArrayBuffer>;}
let worker:Worker|undefined,id=0,cachedOtherRevision=-1;
const pending=new Map<number,{resolve:(value:PreparedPersistence)=>void;reject:(error:unknown)=>void}>();
/** Inputs own their typed buffers: transferring these copies never detaches live physics. */
function transfers(value:unknown,result=new Set<ArrayBuffer>()):ArrayBuffer[]{
 if(ArrayBuffer.isView(value)&&value.buffer instanceof ArrayBuffer)result.add(value.buffer);
 else if(value&&typeof value==='object'){if(value instanceof Map){for(const item of value.values())transfers(item,result);}else for(const item of Object.values(value))transfers(item,result);}
 return [...result];
}
export function persistenceCaptureTransfers(input:PersistenceCapture):ArrayBuffer[]{
 return [...new Set([...transfers(input.active),...input.planets.filter(p=>p.typed).flatMap(p=>transfers({state:p.state,climate:p.climate}))])];
}
export function preparePersistenceInWorker(input:PersistenceCapture):Promise<PreparedPersistence>{
 if(!worker){
  try{worker=new Worker(new URL('./persistencePreparation.worker.ts',import.meta.url),{type:'module'});}catch(error){return Promise.reject(error);}
  cachedOtherRevision=-1;
  worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);if(data.error)job.reject(new Error(data.error));else job.resolve(data.result);};
  worker.onerror=()=>{for(const job of pending.values())job.reject(new Error('저장 준비 Worker가 중단되었습니다.'));pending.clear();worker?.terminate();worker=undefined;};
 }
 const payload={...input,other:cachedOtherRevision===input.otherRevision?undefined:input.other};
 return new Promise((resolve,reject)=>{const job=++id;pending.set(job,{resolve,reject});try{worker!.postMessage({id:job,input:payload},persistenceCaptureTransfers(payload));cachedOtherRevision=input.otherRevision;}catch(error){pending.delete(job);reject(error);}});
}
