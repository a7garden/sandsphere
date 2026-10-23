import checkpointWorkerUrl from './checkpoint.service-worker?worker&url';
import {setLifecycleCheckpointWriter,type LifecycleCheckpointWrite} from './browserStorage';

let preparing:Promise<boolean>|undefined;
let activeRegistration:ServiceWorkerRegistration|undefined;
export function checkpointWorkerAvailable(){return activeRegistration?.active?.state==='activated';}
function request(worker:ServiceWorker,message:{type:string;write?:LifecycleCheckpointWrite}):Promise<boolean>{
 return new Promise((resolve,reject)=>{
  const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('브라우저 종료 저장 응답을 확인하지 못했습니다.'));},30000);
  channel.port1.onmessage=({data})=>{clearTimeout(timer);channel.port1.close();if(data?.ok)resolve(data.written===true);else reject(new Error(data?.error??'브라우저 종료 저장에 실패했습니다.'));};
  try{worker.postMessage(message,[channel.port2]);}catch(error){clearTimeout(timer);channel.port1.close();reject(error);}
 });
}
async function activated(registration:ServiceWorkerRegistration):Promise<ServiceWorker>{
 const worker=registration.active??registration.waiting??registration.installing;if(!worker)throw new Error('Persistence worker was not installed.');
 if(worker.state==='activated')return worker;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{worker.removeEventListener('statechange',changed);reject(new Error('Persistence worker activation timed out.'));},10000);
  const changed=()=>{if(worker.state==='activated'){clearTimeout(timer);worker.removeEventListener('statechange',changed);resolve(worker);}else if(worker.state==='redundant'){clearTimeout(timer);worker.removeEventListener('statechange',changed);reject(new Error('Persistence worker installation was replaced.'));}};
  worker.addEventListener('statechange',changed);changed();
 });
}
/** Registration has its own narrow scope and never waits for controller/ready:
 * the game sends directly to the activated worker without controlling pages. */
export function prepareCheckpointWorker():Promise<boolean>{
 if(preparing)return preparing;
 preparing=(async()=>{
  if(!('serviceWorker' in navigator))return false;
  const script=new URL(checkpointWorkerUrl,location.href),scope=new URL('./sandsphere-checkpoints/',script);
  const registration=await navigator.serviceWorker.register(script.href,{type:'module',scope:scope.href});
  const worker=await activated(registration);await request(worker,{type:'sandsphere-checkpoint-ready'});activeRegistration=registration;
  setLifecycleCheckpointWriter(write=>request(registration.active??worker,{type:'sandsphere-checkpoint-write',write}));return true;
 })().catch(error=>{console.warn('Persistence service worker unavailable.',error);return false;});
 return preparing;
}
