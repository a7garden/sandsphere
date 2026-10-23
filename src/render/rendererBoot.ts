import {AbstractEngine} from '@babylonjs/core/Engines/abstractEngine';
import type {WebGPUEngine} from '@babylonjs/core/Engines/webgpuEngine';
import {_CommonDispose} from '@babylonjs/core/Engines/engine.common';

export const RENDERER_BOOT_TIMEOUT_MS=3000;
/** One deadline covers the adapter probe, device and deferred GLSL compilers.
 * A timed-out attempt never becomes the active renderer after WebGL starts. */
export async function boundedWebGPU<T>(supported:()=>Promise<boolean>,create:()=>T,initialize:(engine:T,abandoned:()=>boolean)=>Promise<void>,dispose:(engine:T)=>void,timeoutMs=RENDERER_BOOT_TIMEOUT_MS):Promise<T|null>{
 let abandoned=false,engine:T|undefined;
 const cleanup=()=>{if(engine!==undefined)try{dispose(engine);}catch{/* A late settlement retries partial initialization cleanup. */}};
 let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`WebGPU renderer initialization exceeded ${timeoutMs}ms.`)),timeoutMs);});
 const pending=(async()=>{if(!await supported()||abandoned)return null;engine=create();await initialize(engine,()=>abandoned);return engine;})();
 // Attach both handlers immediately, including the rejection handler: an
 // abandoned driver/compiler promise can settle long after the fallback.
 void pending.then(()=>{if(abandoned)cleanup();},()=>{if(abandoned)cleanup();});
 try{return await Promise.race([pending,deadline]);}
 catch(error){abandoned=true;cleanup();throw error;}
 finally{clearTimeout(timer);}
}

/** Babylon 9.30 dispose() assumes its device managers exist. An adapter/device
 * failure can precede those managers, so release base ownership independently.
 * The boot owner calls this again if asynchronous initialization settles late. */
const fullyDisposed=new WeakSet<WebGPUEngine>();
export function disposeBootWebGPU(engine:WebGPUEngine,canvas:HTMLCanvasElement){
 if(fullyDisposed.has(engine))return;
 try{engine.dispose();fullyDisposed.add(engine);}
 catch{
  const partial=engine as unknown as {_device?:GPUDevice};
  try{partial._device?.destroy();}catch{/* Device may already be lost. */}
  try{_CommonDispose(engine,canvas);}finally{AbstractEngine.prototype.dispose.call(engine);}
 }
}
