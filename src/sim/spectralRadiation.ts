/** ecCKD gas tables and interpolation ported from NumericalRadiation 0.1.1
 * (Apache-2.0; attribution in data/NOTICE). No fit to climate observations.
 * Sources are spectral Planck tables, rather than a fixed grey band split.
 * Off-table absorption clamps as in ecCKD. Below the source table, its lowest
 * spectral shape is retained while bolometric emission falls as T⁴; this is
 * a declared cold-source approximation, not resolved cryogenic spectroscopy.
 * Warm source extrapolation retains the existing ecRad linear approximation. */
import data from './data/ecckd-32.json';
import {createSpectralKernel,loadSpectralKernelBytes,SPECTRAL_INITIALIZATION_TIMEOUT_MS,type SpectralKernel,type SpectralAccelerationOptions,type SpectralAccelerationStatus,type SpectralAccelerationDiagnostics} from './spectralAcceleration';
export type {SpectralAccelerationOptions,SpectralAccelerationStatus,SpectralAccelerationDiagnostics} from './spectralAcceleration';
type Field={shape:number[];data:string};
const decode=(f:Field)=>{const raw=atob(f.data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer),values=new Float64Array(bytes.length/4);for(let i=0;i<values.length;i++)values[i]=view.getFloat32(i*4,true);return values;};
const fields=Object.fromEntries(Object.entries(data.fields).map(([k,f])=>[k,decode(f)]));
const P=fields.pressure_grid,T=fields.temperature_grid,H=fields.water_vapor_mole_fraction_grid,np=P.length,ng=32,nGas=8;
const normalize=(w:Float64Array)=>{const sum=w.reduce((a,b)=>a+b,0);return w.map(x=>x/sum);};
export const spectralWeights={longwave:normalize(fields.longwave_weights),shortwave:normalize(fields.shortwave_weights)};
export const spectralCloudOptics=data.cloud;
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
function logBracket(axis:Float64Array,x:number){const offset=(Math.log(Math.max(x,axis[0]))-Math.log(axis[0]))/(Math.log(axis[1])-Math.log(axis[0])),i=Math.floor(clamp(offset,0,axis.length-2));return {i,w:clamp(offset-i,0,1)};}
function stencil(p:number,t:number,h:number){const pb=logBracket(P,p),origin=T[pb.i]*(1-pb.w)+T[pb.i+1]*pb.w,offset=clamp((t-origin)/(T[np]-T[0]),0,data.fields.temperature_grid.shape[1]-1.0001);return {p:pb.i,wp:pb.w,t:Math.floor(offset),wt:offset-Math.floor(offset),h:logBracket(H,h)};}
function coefficient(a:Float64Array,g:number,j:number,s:ReturnType<typeof stencil>){
 const i=g+ng*(j+nGas*(s.p+np*s.t)),dp=ng*nGas,dt=dp*np;
 const x=a[i]+s.wp*(a[i+dp]-a[i]),y=a[i+dt]+s.wp*(a[i+dp+dt]-a[i+dt]);return x+s.wt*(y-x);
}
function waterCoefficient(a:Float64Array,g:number,s:ReturnType<typeof stencil>){
 const i=g+ng*(s.p+np*(s.t+data.fields.temperature_grid.shape[1]*s.h.i)),dp=ng,dt=ng*np,dh=dt*data.fields.temperature_grid.shape[1];
 const x0=a[i]+s.wp*(a[i+dp]-a[i]),y0=a[i+dt]+s.wp*(a[i+dt+dp]-a[i+dt]),x=x0+s.wt*(y0-x0),j=i+dh,
 x1=a[j]+s.wp*(a[j+dp]-a[j]),y1=a[j+dt]+s.wp*(a[j+dt+dp]-a[j+dt]),y=x1+s.wt*(y1-x1);
 return x+s.h.w*(y-x);
}
export function prescribedOzone(p:number){return 8e-6*(p/3000)*Math.exp(1-p/3000);}
export interface SpectralGasLayer {pressure:number;temperature:number;dryMoles:number;waterMoles:number;carbonDioxideMoles:number;methaneMoles:number;ozone?:number;n2o?:number;}
export interface SpectralGasOptics {longwave:Float64Array;shortwave:Float64Array;rayleigh:Float64Array;}
let accelerationEnabled=true,accelerationState:SpectralAccelerationStatus['state']='uninitialized',accelerationReason:string|undefined,accelerationEpoch=0;
let acceleration:SpectralKernel|undefined,initialization:Promise<SpectralAccelerationStatus>|undefined,kernelBusy=false,diagnostics:SpectralAccelerationDiagnostics|undefined;
export function spectralAccelerationStatus():SpectralAccelerationStatus{return {backend:accelerationEnabled&&acceleration?'wasm-simd':'js',state:accelerationEnabled?accelerationState:'disabled',...(accelerationReason?{reason:accelerationReason}:{}),memoryBytes:acceleration?.memoryBytes??0,tableBytes:acceleration?.tableBytes??0};}
/** Call between synchronous physics steps. Disabling also cancels publication
 * from an initialization still in flight; no late task can reactivate it. */
export function setSpectralAccelerationEnabled(enabled:boolean){if(accelerationEnabled!==enabled){accelerationEnabled=enabled;accelerationEpoch++;}if(!enabled&&accelerationState==='initializing')accelerationState='uninitialized';}
export function setSpectralAccelerationDiagnostics(enabled=true){diagnostics=enabled?{acceleratedCalls:0,javascriptCalls:0,nestedFallbacks:0,runtimeFailures:0}:undefined;}
export function spectralAccelerationDiagnostics(){return diagnostics?{...diagnostics}:undefined;}
function spectralGasOpticsWasmInto(c:SpectralGasLayer,result:SpectralGasOptics,amounts:Float64Array,kernel:SpectralKernel){
 const s=stencil(c.pressure,c.temperature,c.waterMoles/Math.max(1e-30,c.dryMoles)),ref=fields.gas_reference_mole_fractions,input=kernel.input;
 amounts[0]=c.dryMoles;amounts[1]=c.waterMoles;amounts[2]=(c.ozone??prescribedOzone(c.pressure))*c.dryMoles;amounts[3]=c.carbonDioxideMoles;amounts[4]=c.methaneMoles;amounts[5]=(c.n2o??320e-9)*c.dryMoles;amounts[6]=0;amounts[7]=0;
 for(let j=0;j<nGas;j++)amounts[j]-=ref[j]*c.dryMoles;
 input[0]=s.p;input[1]=s.wp;input[2]=s.t;input[3]=s.wt;input[4]=s.h.i;input[5]=s.h.w;input[6]=c.waterMoles;input[7]=c.dryMoles+c.waterMoles;for(let j=0;j<nGas;j++)input[8+j]=amounts[j];
 kernel.execute();result.longwave.set(kernel.longwave);result.shortwave.set(kernel.shortwave);result.rayleigh.set(kernel.rayleigh);return result;
}
function checkSpectralKernel(kernel:SpectralKernel){
 const cases:SpectralGasLayer[]=[
  {pressure:1e5,temperature:288,dryMoles:3.2,waterMoles:.01,carbonDioxideMoles:.0013,methaneMoles:6e-6},
  {pressure:.01,temperature:.01,dryMoles:3.2,waterMoles:1e-7,carbonDioxideMoles:1e-11,methaneMoles:2e-9},
  {pressure:1e7,temperature:2500,dryMoles:3.2,waterMoles:0,carbonDioxideMoles:.2,methaneMoles:.3},
  {pressure:3000,temperature:119.999999,dryMoles:0,waterMoles:12,carbonDioxideMoles:.1,methaneMoles:.1,ozone:0,n2o:0},
  {pressure:1e5,temperature:33.15,dryMoles:3.2,waterMoles:0,carbonDioxideMoles:0,methaneMoles:0,ozone:0,n2o:0},
  {pressure:1000,temperature:33.15,dryMoles:0,waterMoles:0,carbonDioxideMoles:0,methaneMoles:0,ozone:0,n2o:0},
  {pressure:1000,temperature:33.15,dryMoles:-0,waterMoles:-0,carbonDioxideMoles:-0,methaneMoles:-0,ozone:0,n2o:0},
 ];
 const expected={longwave:new Float64Array(ng),shortwave:new Float64Array(ng),rayleigh:new Float64Array(ng)},actual={longwave:new Float64Array(ng),shortwave:new Float64Array(ng),rayleigh:new Float64Array(ng)},amounts=new Float64Array(nGas);
 for(const c of cases){spectralGasOpticsJsInto(c,expected,amounts);spectralGasOpticsWasmInto(c,actual,amounts,kernel);for(const key of ['longwave','shortwave','rayleigh'] as const)for(let g=0;g<ng;g++)if(!Object.is(expected[key][g],actual[key][g]))throw new Error('Float64 spectral kernel self-check failed');}
}
/** Best-effort startup, outside advance. Fetch/compile/self-check are bounded;
 * unavailable SIMD, CSP, offline and late responses always retain JS. */
export function initializeSpectralAcceleration(options:SpectralAccelerationOptions={}):Promise<SpectralAccelerationStatus>{
 if(options.enabled!==undefined)setSpectralAccelerationEnabled(options.enabled);
 if(!accelerationEnabled||acceleration)return Promise.resolve(spectralAccelerationStatus());
 if(initialization)return initialization;
 if(typeof WebAssembly==='undefined'||typeof WebAssembly.validate!=='function'||typeof WebAssembly.instantiate!=='function'){accelerationState='unavailable';accelerationReason='WebAssembly unavailable';return Promise.resolve(spectralAccelerationStatus());}
 const epoch=accelerationEpoch,controller=typeof AbortController==='undefined'?undefined:new AbortController();accelerationState='initializing';accelerationReason=undefined;
 initialization=(async()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const load=(async()=>{const bytes=await (options.load?options.load():loadSpectralKernelBytes(controller?.signal)),kernel=await createSpectralKernel(bytes,fields,np,data.fields.temperature_grid.shape[1]);checkSpectralKernel(kernel);return kernel;})();
   const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller?.abort();reject(new Error('Spectral initialization timed out'));},SPECTRAL_INITIALIZATION_TIMEOUT_MS);});
   const kernel=await Promise.race([load,timeout]);
   if(epoch===accelerationEpoch&&accelerationEnabled){acceleration=kernel;accelerationState='ready';}else accelerationState='uninitialized';
  }catch(error){if(epoch===accelerationEpoch&&accelerationEnabled){acceleration=undefined;accelerationState='failed';accelerationReason=error instanceof Error?error.message.slice(0,240):'Spectral initialization failed';}}
  finally{if(timer!==undefined)clearTimeout(timer);}
  return spectralAccelerationStatus();
 })().finally(()=>{initialization=undefined;});return initialization;
}
/** Caller-owned buffers for the synchronous solver path. Public results own
 * their arrays; reentrant calls use JS instead of aliasing the WASM scratch. */
export function spectralGasOpticsInto(c:SpectralGasLayer,result:SpectralGasOptics,amounts:Float64Array){
 const kernel=accelerationEnabled?acceleration:undefined;
 if(kernel&&!kernelBusy){kernelBusy=true;try{const value=spectralGasOpticsWasmInto(c,result,amounts,kernel);if(diagnostics)diagnostics.acceleratedCalls++;return value;}catch(error){acceleration=undefined;accelerationState='failed';accelerationReason=error instanceof Error?error.message.slice(0,240):'Spectral kernel failed';if(diagnostics)diagnostics.runtimeFailures++;}finally{kernelBusy=false;}}
 else if(kernelBusy&&diagnostics)diagnostics.nestedFallbacks++;
 if(diagnostics)diagnostics.javascriptCalls++;return spectralGasOpticsJsInto(c,result,amounts);
}
function spectralGasOpticsJsInto(c:SpectralGasLayer,result:SpectralGasOptics,amounts:Float64Array){
 const s=stencil(c.pressure,c.temperature,c.waterMoles/Math.max(1e-30,c.dryMoles)),ref=fields.gas_reference_mole_fractions,
 {longwave,shortwave,rayleigh}=result;
 amounts[0]=c.dryMoles;amounts[1]=c.waterMoles;amounts[2]=(c.ozone??prescribedOzone(c.pressure))*c.dryMoles;amounts[3]=c.carbonDioxideMoles;amounts[4]=c.methaneMoles;amounts[5]=(c.n2o??320e-9)*c.dryMoles;amounts[6]=0;amounts[7]=0;
 for(let j=0;j<nGas;j++)amounts[j]-=ref[j]*c.dryMoles;
 for(let g=0;g<ng;g++){
  let lw=waterCoefficient(fields.longwave_water_vapor_absorption,g,s)*c.waterMoles,sw=waterCoefficient(fields.shortwave_water_vapor_absorption,g,s)*c.waterMoles;
  for(let j=0;j<nGas;j++){lw+=coefficient(fields.longwave_absorption,g,j,s)*amounts[j];sw+=coefficient(fields.shortwave_absorption,g,j,s)*amounts[j];}
  longwave[g]=Math.max(0,lw);shortwave[g]=Math.max(0,sw);rayleigh[g]=fields.shortwave_rayleigh_molar_scattering[g]*(c.dryMoles+c.waterMoles);
 }
 return result;
}
export function spectralGasOptics(c:SpectralGasLayer){return spectralGasOpticsInto(c,{longwave:new Float64Array(ng),shortwave:new Float64Array(ng),rayleigh:new Float64Array(ng)},new Float64Array(nGas));}
export function spectralSourceInto(temperature:number,source:Float64Array){
 const grid=fields.longwave_source_temperature_grid,offset=clamp((temperature-grid[0])/(grid[1]-grid[0]),0,grid.length-2),i=Math.floor(offset),w=temperature>grid.at(-1)!?(temperature-grid.at(-2)!)/(grid.at(-1)!-grid.at(-2)!):clamp((temperature-grid[i])/(grid[i+1]-grid[i]),0,1),table=fields.longwave_source_table;
 const coldScale=temperature<grid[0]?(Math.max(0,temperature)/grid[0])**4:1;
 for(let g=0;g<ng;g++)source[g]=(table[g+ng*i]+w*(table[g+ng*(i+1)]-table[g+ng*i]))*coldScale;
 return source;
}
export function spectralSource(temperature:number){return spectralSourceInto(temperature,new Float64Array(ng));}
