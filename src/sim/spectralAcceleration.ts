import kernelUrl from './data/spectral-optics-simd.wasm?url';

export interface SpectralAccelerationOptions {
 enabled?:boolean;
 /** Optional packaged byte loader. Default loads the versioned Vite asset. */
 load?:()=>Promise<Uint8Array>;
}
export interface SpectralAccelerationStatus {
 backend:'js'|'wasm-simd';state:'uninitialized'|'initializing'|'ready'|'disabled'|'unavailable'|'failed';
 reason?:string;memoryBytes:number;tableBytes:number;
}
export interface SpectralAccelerationDiagnostics {acceleratedCalls:number;javascriptCalls:number;nestedFallbacks:number;runtimeFailures:number;}
export interface SpectralKernel {
 input:Float64Array;longwave:Float64Array;shortwave:Float64Array;rayleigh:Float64Array;
 execute:()=>void;memoryBytes:number;tableBytes:number;
}
export const SPECTRAL_INITIALIZATION_TIMEOUT_MS=3000;
export async function loadSpectralKernelBytes(signal?:AbortSignal){
 const response=await fetch(kernelUrl,{signal});if(!response.ok)throw new Error(`Spectral kernel HTTP ${response.status}`);return new Uint8Array(await response.arrayBuffer());
}
/** One instance/table copy per module realm. It has no imports or shared memory.
 * Grow once before constructing views; callers must serialize access. */
export async function createSpectralKernel(bytes:Uint8Array,fields:Record<string,Float64Array>,np:number,nt:number):Promise<SpectralKernel>{
 const ownedBytes=new Uint8Array(bytes);
 if(!WebAssembly.validate(ownedBytes))throw new Error('Float64 SIMD kernel unsupported');
 const {instance,module}=await WebAssembly.instantiate(ownedBytes,{});
 if(WebAssembly.Module.imports(module).length)throw new Error('Unexpected spectral kernel imports');
 const memory=instance.exports.memory as WebAssembly.Memory,kernel=instance.exports.optics as (...args:number[])=>void;
 if(!(memory instanceof WebAssembly.Memory)||typeof kernel!=='function'||!(instance.exports.__heap_base instanceof WebAssembly.Global))throw new Error('Unexpected spectral kernel ABI');
 const names=['longwave_absorption','shortwave_absorption','longwave_water_vapor_absorption','shortwave_water_vapor_absorption','shortwave_rayleigh_molar_scattering'],pointers:number[]=[];
 let pointer=Number(instance.exports.__heap_base.value);
 for(const name of names){pointer=(pointer+15)&~15;pointers.push(pointer);pointer+=fields[name].byteLength;}
 pointer=(pointer+15)&~15;const inputPointer=pointer;pointer+=16*8;const outputPointer=pointer;pointer+=96*8;
 const pages=Math.ceil(pointer/65536),current=memory.buffer.byteLength/65536;if(pages>current)memory.grow(pages-current);
 for(let i=0;i<names.length;i++)new Float64Array(memory.buffer,pointers[i],fields[names[i]].length).set(fields[names[i]]);
 return {input:new Float64Array(memory.buffer,inputPointer,16),longwave:new Float64Array(memory.buffer,outputPointer,32),shortwave:new Float64Array(memory.buffer,outputPointer+32*8,32),rayleigh:new Float64Array(memory.buffer,outputPointer+64*8,32),execute:()=>kernel(pointers[0],pointers[1],pointers[2],pointers[3],pointers[4],inputPointer,outputPointer,1,np,nt),memoryBytes:memory.buffer.byteLength,tableBytes:names.reduce((sum,name)=>sum+fields[name].byteLength,0)};
}
