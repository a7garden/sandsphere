// @ts-nocheck -- immutable pre-optimization fixture; production nominal types may evolve.
// Only import paths differ; normalize them to verify the original captured source SHA-256.
/** ecCKD gas tables and interpolation ported from NumericalRadiation 0.1.1
 * (Apache-2.0; attribution in data/NOTICE). No fit to climate observations.
 * Sources are spectral Planck tables, rather than a fixed grey band split.
 * Off-table absorption clamps as in ecCKD. Below the source table, its lowest
 * spectral shape is retained while bolometric emission falls as T⁴; this is
 * a declared cold-source approximation, not resolved cryogenic spectroscopy.
 * Warm source extrapolation retains the existing ecRad linear approximation. */
import data from '../../../src/sim/data/ecckd-32.json';
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
 const at=(i:number)=>{const x=a[i]+s.wp*(a[i+dp]-a[i]),y=a[i+dt]+s.wp*(a[i+dt+dp]-a[i+dt]);return x+s.wt*(y-x);};
 const x=at(i);return x+s.h.w*(at(i+dh)-x);
}
export function prescribedOzone(p:number){return 8e-6*(p/3000)*Math.exp(1-p/3000);}
export interface SpectralGasLayer {pressure:number;temperature:number;dryMoles:number;waterMoles:number;carbonDioxideMoles:number;methaneMoles:number;ozone?:number;n2o?:number;}
export function spectralGasOptics(c:SpectralGasLayer){
 const s=stencil(c.pressure,c.temperature,c.waterMoles/Math.max(1e-30,c.dryMoles)),ref=fields.gas_reference_mole_fractions,
 amounts=[c.dryMoles,c.waterMoles,(c.ozone??prescribedOzone(c.pressure))*c.dryMoles,c.carbonDioxideMoles,c.methaneMoles,(c.n2o??320e-9)*c.dryMoles,0,0].map((v,j)=>v-ref[j]*c.dryMoles),longwave=new Float64Array(ng),shortwave=new Float64Array(ng),rayleigh=new Float64Array(ng);
 for(let g=0;g<ng;g++){
  let lw=waterCoefficient(fields.longwave_water_vapor_absorption,g,s)*c.waterMoles,sw=waterCoefficient(fields.shortwave_water_vapor_absorption,g,s)*c.waterMoles;
  for(let j=0;j<nGas;j++){lw+=coefficient(fields.longwave_absorption,g,j,s)*amounts[j];sw+=coefficient(fields.shortwave_absorption,g,j,s)*amounts[j];}
  longwave[g]=Math.max(0,lw);shortwave[g]=Math.max(0,sw);rayleigh[g]=fields.shortwave_rayleigh_molar_scattering[g]*(c.dryMoles+c.waterMoles);
 }
 return {longwave,shortwave,rayleigh};
}
export function spectralSource(temperature:number){
 const grid=fields.longwave_source_temperature_grid,offset=clamp((temperature-grid[0])/(grid[1]-grid[0]),0,grid.length-2),i=Math.floor(offset),w=temperature>grid.at(-1)!?(temperature-grid.at(-2)!)/(grid.at(-1)!-grid.at(-2)!):clamp((temperature-grid[i])/(grid[i+1]-grid[i]),0,1),source=new Float64Array(ng),table=fields.longwave_source_table;
 const coldScale=temperature<grid[0]?(Math.max(0,temperature)/grid[0])**4:1;
 for(let g=0;g<ng;g++)source[g]=(table[g+ng*i]+w*(table[g+ng*(i+1)]-table[g+ng*i]))*coldScale;
 return source;
}
