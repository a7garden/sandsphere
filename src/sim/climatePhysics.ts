import {saturationPressure} from './waterPhysics';
import {waterEquilibrium} from './phaseEquilibrium';

export const STEFAN_BOLTZMANN=5.670374419e-8;
export const PLUME_ENTRAINMENT=2e-4; // m^-1; sensitivity parameter, not observationally fitted
/** Uniform total-water PDF statistical-cloud closure.
 * The half-width expresses unresolved moisture variability; RHcrit=.8 is
 * a declared sensitivity parameter, not a fit to satellite cloud targets.
 * Integrating max(qt-qs,0) gives both mean condensate and area fraction.
 * Inputs may be masses: all three quantities share the same normalization. */
export function statisticalCloud(totalWater:number,saturation:number,criticalRH=.8){
 if(!Number.isFinite(saturation)||saturation<=0)return {fraction:saturation===0&&totalWater>0?1:0,condensate:saturation===0?Math.max(0,totalWater):0};
 const width=(1-criticalRH)*saturation;
 if(width<=0)return {fraction:totalWater>saturation?1:0,condensate:Math.max(0,totalWater-saturation)};
 const excess=totalWater+width-saturation;
 if(excess<=0)return {fraction:0,condensate:0};
 if(excess>=2*width)return {fraction:1,condensate:Math.max(0,totalWater-saturation)};
 return {fraction:excess/(2*width),condensate:excess*excess/(4*width)};
}
/** Random-overlap mean transmission: cloud path is grid mean, τ/C is
 * the in-cloud depth. Homogeneous overcast opacity over-reflects thin clouds. */
export function fractionalCloudDepth(meanDepth:number,fraction:number){
 const c=Math.max(0,Math.min(1,fraction));
 if(c===0||meanDepth<=0)return 0;
 return -Math.log1p(c*Math.expm1(-meanDepth/c));
}
/** Established maximum-random overlap: adjacent cloudy layers share a
 * subcolumn rank; a clear layer resets its rank. This is an explicit overlap
 * approximation, not the IFS's newer exponential-random decorrelation fit. */
export function maximumRandomCloudArea(fraction:ArrayLike<number>){
 let clear=1,block=0;
 for(let k=0;k<fraction.length;k++){const c=Math.max(0,Math.min(1,fraction[k]));if(c>0)block=Math.max(block,c);else{clear*=1-block;block=0;}}
 return 1-clear*(1-block);
}
/** Exact area quadrature for the specified overlap. Every threshold interval
 * has a constant cloud mask. Eleven layers have at most 81 subcolumns. */
function maximumRandomMasks(fraction:ArrayLike<number>){
 const n=fraction.length,blocks:{start:number;end:number;cuts:number[]}[]=[];
 for(let k=0;k<n;){if(fraction[k]<=0){k++;continue;}const start=k,cuts=[0,1];while(k<n&&fraction[k]>0){cuts.push(Math.max(0,Math.min(1,fraction[k])));k++;}blocks.push({start,end:k,cuts:[...new Set(cuts)].sort((a,b)=>a-b)});}
 const columns:{weight:number;mask:Uint8Array}[]=[],mask=new Uint8Array(n);
 const visit=(b:number,weight:number)=>{
  if(b===blocks.length){columns.push({weight,mask:mask.slice()});return;}
  const {start,end,cuts}=blocks[b];
  for(let j=1;j<cuts.length;j++){const rank=(cuts[j-1]+cuts[j])/2;for(let k=start;k<end;k++)mask[k]=Number(rank<fraction[k]);visit(b+1,weight*(cuts[j]-cuts[j-1]));}
 };
 visit(0,1);return columns;
}
/** Reversible moist parcel adjustment uses the same material and energy law
 * as stored atmospheric layers; a diagnostic lift may approach absolute zero. */
export function parcelEquilibrium(dryCapacity:number,dryMoles:number,water:number,
 enthalpy:number,pressure:number,potential:number){
 return waterEquilibrium(dryCapacity,dryMoles,water,enthalpy,pressure,potential);
}

/** Isca BYRNE scheme: dτ/d(p/1e5)=0.8678+1997.9q+0.17ln(CO2/360).
 * q is specific humidity, CO2 is ppmv. Not a spectroscopic model of CH4 or
 * arbitrary gas atmospheres. The low-CO2 extension uses nonnegative opacity. */
export function byrneOpticalDepth(deltaPressure:number,q:number,co2ppm:number){
 return Math.max(0,.8678+1997.9*Math.max(0,q)+.17*Math.log(Math.max(1e-12,co2ppm)/360))*Math.max(0,deltaPressure)/1e5;
}
/** Isca GEEN two-band LW fits to SBDART, including the 8–14µm window.
 * Coefficients are published defaults, not tuned to the reference fixture. */
export function geenOpticalDepth(deltaPressure:number,q:number,co2ppm:number){
 const humidity=Math.max(0,q),co2=Math.log(Math.max(1e-12,co2ppm)/360),dp=Math.max(0,deltaPressure)/1e5;
 return {window:Math.max(0,.215+147.11*humidity+1.0814e4*humidity**2+.0954*co2)*dp,
  nonWindow:Math.max(0,.1+23.8*Math.log1p(254*humidity)+.2023*co2)*dp};
}
/** Published GEEN solar fit, integrated top-to-bottom with adaptive RK4.
 * Optical depth >25 is the opaque limit (transmission <1.4e-11). */
export function geenSolarDepth(topDepth:number,deltaPressure:number,q:number,co2ppm:number){
 const humidity=Math.max(0,q),co2=Math.log(Math.max(1e-12,co2ppm)/360);
 const derivative=(tau:number)=>Math.max(0,.0596+humidity*Math.exp(.01887/(tau+.009522)+1.603/(tau+.5194)**2)+.0029*co2);
 const rk=(tau:number,step:number)=>{const a=derivative(tau),b=derivative(tau+a*step/2),c=derivative(tau+b*step/2),d=derivative(tau+c*step);return tau+step*(a+2*b+2*c+d)/6;};
 let tau=Math.max(0,topDepth),remaining=Math.max(0,deltaPressure)/1e5,step=remaining;
 for(let n=0;remaining>1e-12;n++){
  if(tau>=25)return 25;if(n>1000)throw new Error('단파 광학 두께 적분이 수렴하지 않았습니다.');
  step=Math.min(step,remaining);const full=rk(tau,step),half=rk(rk(tau,step/2),step/2),error=Math.abs(full-half),tolerance=1e-6*(1+half);
  if(error>tolerance){step*=.5;continue;}tau=half;remaining-=step;if(error<tolerance/16)step*=2;
 }
 return Math.min(25,tau);
}
/** Frierson (2006) prescribed-opacity reference, for reproducible dry tests. */
export function friersonOpticalDepth(pressure:number,sinLatitude:number){const sigma=Math.max(0,pressure)/1e5,tau0=6+(1.5-6)*sinLatitude**2;return tau0*(.1*sigma+.9*sigma**4);}

export interface RadiationColumn {
 temperature: ArrayLike<number>; // Celsius, bottom to top
 opticalDepth: ArrayLike<number>; // effective diffuse LW depth per layer
 cloudTransportDepth: ArrayLike<number>; // (1-g) extinction, bottom to top
 surfaceTemperature:number; surfaceAlbedo:number; solar:number;
 longwaveBands?:{weight:number;opticalDepth:ArrayLike<number>;sourceTop?:ArrayLike<number>;sourceBottom?:ArrayLike<number>;surfaceSource?:number;diffusivity?:number;cloudMeanAbsorptionDepth?:ArrayLike<number>}[];
 shortwaveBands?:{weight:number;absorptionDepth:ArrayLike<number>;rayleighDepth?:ArrayLike<number>;cloudMeanAbsorptionDepth?:ArrayLike<number>;cloudTransportDepth?:ArrayLike<number>}[];
 solarAbsorptionDepth?:ArrayLike<number>;
 cloudFraction?:ArrayLike<number>; // default homogeneous cloud
 cloudMeanAbsorptionDepth?:ArrayLike<number>; // grid-mean LW cloud absorption, gas opacity separate
 cloudOverlap?:'random'|'maximum-random';
}
/** Isothermal-layer exact Schwarzschild solution + conservative cloud
 * two-stream adding. Shortwave layer R=τ_tr/(2+τ_tr), T=1-R (ω=1).
 * Adding includes repeated surface/cloud and cloud/cloud reflections. */
export function radiativeFluxes(c:RadiationColumn){
 if(c.cloudOverlap!=='maximum-random'||!c.cloudMeanAbsorptionDepth)return singleRadiativeFluxes(c);
 const fraction=c.cloudFraction??new Float64Array(c.temperature.length).fill(1);
 // Fully clear/overcast layers have one mask; avoid quadrature overhead.
 const inLW=Array.from(c.cloudMeanAbsorptionDepth,(tau,k)=>tau/Math.max(1e-30,fraction[k]));
 const inSW=Array.from(c.cloudTransportDepth,(tau,k)=>tau/Math.max(1e-30,fraction[k]));
 if(Array.from(fraction).every(c=>c===0||c===1))return singleRadiativeFluxes(c,Uint8Array.from(fraction),inLW,inSW);
 let result:ReturnType<typeof singleRadiativeFluxes>|undefined;
 const arrays=['up','down','heating','swDown','swUp'] as const;
 const scalars=['surfaceSolar','surfaceNet','toaNet','olr','reflectedSolar'] as const;
 for(const {weight,mask} of maximumRandomMasks(fraction)){
  const f=singleRadiativeFluxes(c,mask,inLW,inSW);
  if(!result){for(const key of arrays)for(let k=0;k<f[key].length;k++)f[key][k]*=weight;for(const key of scalars)f[key]*=weight;result=f;}
  else{for(const key of arrays)for(let k=0;k<f[key].length;k++)result[key][k]+=weight*f[key][k];for(const key of scalars)result[key]+=weight*f[key];}
 }
 return result!;
}
/** The surface light used by ecology needs only downward shortwave flux.
 * Keep the same band, reflection and cloud-mask order as radiativeFluxes. */
export function surfaceSolarDown(c:RadiationColumn){
 if(c.solar<=0)return 0;
 if(c.cloudOverlap!=='maximum-random'||!c.cloudMeanAbsorptionDepth)return singleSurfaceSolarDown(c);
 const fraction=c.cloudFraction??new Float64Array(c.temperature.length).fill(1);
 if(Array.from(fraction).every(value=>value===0||value===1))return singleSurfaceSolarDown(c,Uint8Array.from(fraction));
 let down=0;
 for(const {weight,mask} of maximumRandomMasks(fraction))down+=weight*singleSurfaceSolarDown(c,mask);
 return down;
}
function singleSurfaceSolarDown(c:RadiationColumn,mask?:Uint8Array){
 const n=c.temperature.length,reflect=new Float64Array(n),transmit=new Float64Array(n),effective=new Float64Array(n+1);
 const bands=c.shortwaveBands??[{weight:1,absorptionDepth:c.solarAbsorptionDepth??new Float64Array(n)}];
 let down=0;
 for(const band of bands){
  effective[0]=Math.max(0,Math.min(1,c.surfaceAlbedo));
  for(let k=0;k<n;k++){const meanTau=band.cloudTransportDepth?.[k]??c.cloudTransportDepth[k],tau=Math.max(0,mask?mask[k]*meanTau/Math.max(1e-30,c.cloudFraction?.[k]??1):meanTau),fraction=Math.max(0,Math.min(1,mask?mask[k]:(c.cloudFraction?.[k]??1))),cloudScatter=fraction===0?0:fraction*tau/(2*fraction+tau),rayleigh=Math.max(0,band.rayleighDepth?.[k]??0),scatter=1-(1-cloudScatter)*2/(2+rayleigh),meanAbs=band.cloudMeanAbsorptionDepth?.[k]??0,cloudAbs=mask?mask[k]*meanAbs/Math.max(1e-30,c.cloudFraction?.[k]??1):fractionalCloudDepth(meanAbs,c.cloudFraction?.[k]??1),absorption=Math.exp(-Math.max(0,band.absorptionDepth[k]+cloudAbs)),r=scatter*absorption,t=(1-scatter)*absorption;reflect[k]=r;transmit[k]=t;effective[k+1]=r+t*t*effective[k]/Math.max(1e-15,1-r*effective[k]);}
  let current=band.weight*Math.max(0,c.solar);
  for(let k=n-1;k>=0;k--)current=transmit[k]*current/Math.max(1e-15,1-reflect[k]*effective[k]);
  down+=current;
 }
 return down;
}
function singleRadiativeFluxes(c:RadiationColumn,mask?:Uint8Array,inLW?:number[],inSW?:number[]){
 const n=c.temperature.length,up=new Float64Array(n+1),down=new Float64Array(n+1),heating=new Float64Array(n),reflect=new Float64Array(n),transmit=new Float64Array(n),effective=new Float64Array(n+1),swDown=new Float64Array(n+1),swUp=new Float64Array(n+1);
 const bands=c.longwaveBands??[{weight:1,opticalDepth:c.opticalDepth}];
 if(Math.abs(bands.reduce((a,b)=>a+b.weight,0)-1)>1e-12||bands.some(b=>b.weight<0))throw new Error('복사 밴드 가중치가 올바르지 않습니다.');
 for(const band of bands){
  let current=band.weight*(band.surfaceSource??STEFAN_BOLTZMANN*(c.surfaceTemperature+273.15)**4);up[0]+=current;
  for(let k=0;k<n;k++){
   const meanCloud=band.cloudMeanAbsorptionDepth?.[k]??c.cloudMeanAbsorptionDepth?.[k]??0,cloud=mask?mask[k]*meanCloud/Math.max(1e-30,c.cloudFraction?.[k]??1):fractionalCloudDepth(meanCloud,c.cloudFraction?.[k]??1);
   const depth=(band.diffusivity??1)*Math.max(0,band.opticalDepth[k]+cloud),transmission=Math.exp(-depth),top=band.sourceTop?.[k],bottom=band.sourceBottom?.[k];
   const emission=top===undefined||bottom===undefined?(1-transmission)*band.weight*STEFAN_BOLTZMANN*(c.temperature[k]+273.15)**4:band.weight*linearSource(depth,top,bottom);
   current=transmission*current+emission;up[k+1]+=current;
  }
  current=0;
  for(let k=n-1;k>=0;k--){
   const meanCloud=band.cloudMeanAbsorptionDepth?.[k]??c.cloudMeanAbsorptionDepth?.[k]??0,cloud=mask?mask[k]*meanCloud/Math.max(1e-30,c.cloudFraction?.[k]??1):fractionalCloudDepth(meanCloud,c.cloudFraction?.[k]??1);
   const depth=(band.diffusivity??1)*Math.max(0,band.opticalDepth[k]+cloud),transmission=Math.exp(-depth),top=band.sourceTop?.[k],bottom=band.sourceBottom?.[k];
   const emission=top===undefined||bottom===undefined?(1-transmission)*band.weight*STEFAN_BOLTZMANN*(c.temperature[k]+273.15)**4:band.weight*linearSource(depth,bottom,top);
   current=transmission*current+emission;down[k]+=current;
  }
 }
 for(let k=0;k<n;k++)heating[k]=up[k]-up[k+1]+down[k+1]-down[k];
 const solarBands=c.shortwaveBands??[{weight:1,absorptionDepth:c.solarAbsorptionDepth??new Float64Array(n)}];
 for(const band of solarBands){
  effective[0]=Math.max(0,Math.min(1,c.surfaceAlbedo));
  for(let k=0;k<n;k++){const meanTau=band.cloudTransportDepth?.[k]??c.cloudTransportDepth[k],tau=Math.max(0,mask?mask[k]*meanTau/Math.max(1e-30,c.cloudFraction?.[k]??1):meanTau),fraction=Math.max(0,Math.min(1,mask?mask[k]:(c.cloudFraction?.[k]??1))),cloudScatter=fraction===0?0:fraction*tau/(2*fraction+tau),rayleigh=Math.max(0,band.rayleighDepth?.[k]??0),scatter=1-(1-cloudScatter)*2/(2+rayleigh),meanAbs=band.cloudMeanAbsorptionDepth?.[k]??0,cloudAbs=mask?mask[k]*meanAbs/Math.max(1e-30,c.cloudFraction?.[k]??1):fractionalCloudDepth(meanAbs,c.cloudFraction?.[k]??1),absorption=Math.exp(-Math.max(0,band.absorptionDepth[k]+cloudAbs)),r=scatter*absorption,t=(1-scatter)*absorption;reflect[k]=r;transmit[k]=t;effective[k+1]=r+t*t*effective[k]/Math.max(1e-15,1-r*effective[k]);}
  let current=band.weight*Math.max(0,c.solar);swDown[n]+=current;swUp[n]+=effective[n]*current;
  for(let k=n-1;k>=0;k--){current=transmit[k]*current/Math.max(1e-15,1-reflect[k]*effective[k]);swDown[k]+=current;swUp[k]+=effective[k]*current;}
 }
 for(let k=0;k<n;k++)heating[k]+=swDown[k+1]-swUp[k+1]-swDown[k]+swUp[k];
 const surfaceSolar=swDown[0]-swUp[0],surfaceNet=surfaceSolar+down[0]-up[0],toaNet=swDown[n]-swUp[n]-up[n];
 return {up,down,heating,swDown,swUp,surfaceSolar,surfaceNet,toaNet,olr:up[n],reflectedSolar:swUp[n]};
}
/** Exact formal solution for a source linear in optical depth. Stable thin
 * limit retains both interface temperatures instead of emitting at skin T. */
export function linearSource(depth:number,exit:number,entry:number){
 if(depth<=0)return 0;
 const attenuation=-Math.expm1(-depth),slope=depth<1e-4?depth/2-depth*depth/6+depth**3/24:1-attenuation/depth;
 return entry*attenuation+(exit-entry)*slope;
}
