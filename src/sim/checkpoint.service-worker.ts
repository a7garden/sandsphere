import {commitLifecycleCheckpoint,prepareBrowserStorage,type LifecycleCheckpointWrite} from './browserStorage';

interface LifetimeEvent extends Event {waitUntil(promise:Promise<unknown>):void;}
interface LifetimeMessage extends MessageEvent {waitUntil(promise:Promise<unknown>):void;}
const worker=self as unknown as EventTarget&{skipWaiting():Promise<void>};
const pendingWrites=new Set<Promise<boolean>>();
worker.addEventListener('install',event=>(event as LifetimeEvent).waitUntil(worker.skipWaiting()));
// This worker has no fetch interception, caches, or client-control behavior.
worker.addEventListener('message',event=>{
 const message=event as LifetimeMessage,data=message.data as {type?:string;write?:LifecycleCheckpointWrite},port=message.ports[0];
 if(data?.type!=='sandsphere-checkpoint-ready'&&data?.type!=='sandsphere-checkpoint-write')return;
 const task=data.type==='sandsphere-checkpoint-ready'?prepareBrowserStorage().then(()=>Promise.all([...pendingWrites])).then(()=>true):data.write?commitLifecycleCheckpoint(data.write):Promise.reject(new Error('Checkpoint message is missing its world.'));
 if(data.type==='sandsphere-checkpoint-write'){pendingWrites.add(task);void task.then(()=>pendingWrites.delete(task),()=>pendingWrites.delete(task));}
 message.waitUntil(task.then(written=>{try{port?.postMessage({ok:true,written});}catch{}},error=>{try{port?.postMessage({ok:false,error:error instanceof Error?error.message:String(error)});}catch{}}));
});
