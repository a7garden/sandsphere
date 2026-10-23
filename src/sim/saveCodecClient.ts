import {encodeSaveBytes,decodeSaveBytes} from './saveCodec';
let worker:Worker|undefined,id=0;
const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:unknown)=>void}>();
function request(operation:'encode'|'decode',value:unknown):Promise<unknown>{
 if(typeof Worker==='undefined')return operation==='encode'?encodeSaveBytes(value):decodeSaveBytes(value as Uint8Array<ArrayBuffer>);
 if(!worker){
  try{worker=new Worker(new URL('./saveCodec.worker.ts',import.meta.url),{type:'module'});}catch{return operation==='encode'?encodeSaveBytes(value):decodeSaveBytes(value as Uint8Array<ArrayBuffer>);}
  worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);if(data.error)job.reject(new Error(data.error));else job.resolve(data.value);};
  worker.onerror=()=>{for(const job of pending.values())job.reject(new Error('저장 처리 Worker가 중단되었습니다.'));pending.clear();worker?.terminate();worker=undefined;};
 }
 return new Promise((resolve,reject)=>{const job=++id;pending.set(job,{resolve,reject});try{worker!.postMessage({id:job,operation,value});}catch(error){pending.delete(job);reject(error);}});
}
export const encodeStoredSave=(value:unknown)=>request('encode',value) as Promise<Uint8Array<ArrayBuffer>>;
export const decodeStoredSave=(value:Uint8Array<ArrayBuffer>)=>request('decode',value);
