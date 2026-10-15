/** ecCKD gas tables and interpolation ported from NumericalRadiation 0.1.1
 * (Apache-2.0; attribution in data/NOTICE). No fit to climate observations.
 * Sources are spectral Planck tables, rather than a fixed grey band split.
 * Off-table absorption clamps as in ecCKD; source extrapolation follows ecRad. */
import data from './data/ecckd-32.json';
type Field={shape:number[];data:string};
// The source bytes already contain Float32 coefficients. Reading the same
// representable values directly preserves JS-double arithmetic while avoiding
// a second Float64 copy. Derived/normalized weights remain Float64.
const littleEndian=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
const decode=(f:Field)=>{const raw=atob(f.data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(littleEndian)return new Float32Array(bytes.buffer);const view=new DataView(bytes.buffer),values=new Float32Array(bytes.length/4);for(let i=0;i<values.length;i++)values[i]=view.getFloat32(i*4,true);return values;};
const ng=32,nGas=8;
const normalize=(w:Float32Array)=>{const sum=w.reduce((a,b)=>a+b,0);return Float64Array.from(w,x=>x/sum);};
function decodeTables(){
 const fields=Object.fromEntries(Object.entries(data.fields).map(([k,f])=>[k,decode(f)]));
 return {fields,P:fields.pressure_grid,T:fields.temperature_grid,H:fields.water_vapor_mole_fraction_grid,
  weights:{longwave:normalize(fields.longwave_weights),shortwave:normalize(fields.shortwave_weights)}};
}
let decoded:ReturnType<typeof decodeTables>|undefined;
const tables=()=>decoded??=decodeTables();
// Validation-only bundles never initialize or retain the scientific tables.
export const spectralWeights={get longwave(){return tables().weights.longwave;},get shortwave(){return tables().weights.shortwave;}};
export const spectralCloudOptics=/* @__PURE__ */(()=>data.cloud)();
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
function logBracket(axis:Float32Array,x:number){const offset=(Math.log(Math.max(x,axis[0]))-Math.log(axis[0]))/(Math.log(axis[1])-Math.log(axis[0])),i=Math.floor(clamp(offset,0,axis.length-2));return {i,w:clamp(offset-i,0,1)};}
function stencil(p:number,t:number,h:number){const {P,T,H}=tables(),np=P.length,pb=logBracket(P,p),origin=T[pb.i]*(1-pb.w)+T[pb.i+1]*pb.w,offset=clamp((t-origin)/(T[np]-T[0]),0,data.fields.temperature_grid.shape[1]-1.0001);return {np,p:pb.i,wp:pb.w,t:Math.floor(offset),wt:offset-Math.floor(offset),h:logBracket(H,h)};}
function coefficient(a:Float32Array,g:number,j:number,s:ReturnType<typeof stencil>){
 const np=s.np,i=g+ng*(j+nGas*(s.p+np*s.t)),dp=ng*nGas,dt=dp*np;
 const x=a[i]+s.wp*(a[i+dp]-a[i]),y=a[i+dt]+s.wp*(a[i+dp+dt]-a[i+dt]);return x+s.wt*(y-x);
}
function waterCoefficient(a:Float32Array,g:number,s:ReturnType<typeof stencil>){
 const np=s.np,i=g+ng*(s.p+np*(s.t+data.fields.temperature_grid.shape[1]*s.h.i)),dp=ng,dt=ng*np,dh=dt*data.fields.temperature_grid.shape[1];
 const at=(i:number)=>{const x=a[i]+s.wp*(a[i+dp]-a[i]),y=a[i+dt]+s.wp*(a[i+dt+dp]-a[i+dt]);return x+s.wt*(y-x);};
 const x=at(i);return x+s.h.w*(at(i+dh)-x);
}
export function prescribedOzone(p:number){return 8e-6*(p/3000)*Math.exp(1-p/3000);}
export interface SpectralGasLayer {pressure:number;temperature:number;dryMoles:number;waterMoles:number;carbonDioxideMoles:number;methaneMoles:number;ozone?:number;n2o?:number;}
export function spectralGasOptics(c:SpectralGasLayer){
 const {fields}=tables(),s=stencil(c.pressure,c.temperature,c.waterMoles/Math.max(1e-30,c.dryMoles)),ref=fields.gas_reference_mole_fractions,
 amounts=[c.dryMoles,c.waterMoles,(c.ozone??prescribedOzone(c.pressure))*c.dryMoles,c.carbonDioxideMoles,c.methaneMoles,(c.n2o??320e-9)*c.dryMoles,0,0].map((v,j)=>v-ref[j]*c.dryMoles),longwave=new Float64Array(ng),shortwave=new Float64Array(ng),rayleigh=new Float64Array(ng);
 for(let g=0;g<ng;g++){
  let lw=waterCoefficient(fields.longwave_water_vapor_absorption,g,s)*c.waterMoles,sw=waterCoefficient(fields.shortwave_water_vapor_absorption,g,s)*c.waterMoles;
  for(let j=0;j<nGas;j++){lw+=coefficient(fields.longwave_absorption,g,j,s)*amounts[j];sw+=coefficient(fields.shortwave_absorption,g,j,s)*amounts[j];}
  longwave[g]=Math.max(0,lw);shortwave[g]=Math.max(0,sw);rayleigh[g]=fields.shortwave_rayleigh_molar_scattering[g]*(c.dryMoles+c.waterMoles);
 }
 return {longwave,shortwave,rayleigh};
}
export function spectralSource(temperature:number){
 const {fields}=tables(),grid=fields.longwave_source_temperature_grid,offset=clamp((temperature-grid[0])/(grid[1]-grid[0]),0,grid.length-2),i=Math.floor(offset),w=temperature>grid.at(-1)!?(temperature-grid.at(-2)!)/(grid.at(-1)!-grid.at(-2)!):clamp((temperature-grid[i])/(grid[i+1]-grid[i]),0,1),source=new Float64Array(ng),table=fields.longwave_source_table;
 for(let g=0;g<ng;g++)source[g]=(table[g+ng*i]+w*(table[g+ng*(i+1)]-table[g+ng*i]))*Math.min(temperature/grid[0],1);
 return source;
}
