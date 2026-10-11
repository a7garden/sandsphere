import {F,STRIDE,capacity,enthalpy,phaseEnergy,equilibrateWater,type Environment} from './model';
import {SPECIFIC_HEAT,PHASE_ENERGY} from './thermodynamics';
import {GASES,thermalEscapeFraction} from './gases';
import {saturationPressure,waterActivity,REFERENCE_PRESSURE} from './waterPhysics';
import {albedo} from './materialPhysics';
import type {SphereGrid} from './sphere';
import {parcelEquilibrium,radiativeFluxes,surfaceSolarDown,PLUME_ENTRAINMENT,statisticalCloud,maximumRandomCloudArea,type RadiationColumn} from './climatePhysics';
import {diagnosticRainMixingRatio,kesslerAccretedFraction,warmAutoFraction,iceAggregation} from './cloudMicrophysics';
import {spectralGasOptics,spectralSource,spectralWeights,spectralCloudOptics} from './spectralRadiation';

/** SI dynamics, with an explicit conversion from the existing column inventory.
 * Surface inventory is retained; .3 inventory kg represents an Earth 1-atm
 * column. One game second is 60 physical seconds on the 1000-km-radius planet.
 * This is a hydrostatic, finite-volume moist mass-flux model, not a DNS/GCM. */
export const AIR_LAYERS=11;
export const LEGACY_AIR_LAYERS=5;
// Numeric layout avoids a model ↔ climate module initialization cycle.
export const AIR_FIELDS=[9,13,14,15,16,17] as const;
export const AIR_SECONDS=60;
export const AIR_RADIUS=1e6;
export const COLUMN_KG=REFERENCE_PRESSURE/(9.81*.3);
/** Extinction per liquid-water-equivalent mass, for 10 μm droplets. */
export const CLOUD_OPTICAL_PER_KG=150;
export const CLOUD_DISPLAY_SCALE=COLUMN_KG*CLOUD_OPTICAL_PER_KG/12;
export const CLOUD_VISIBLE_MASS=.1/(COLUMN_KG*CLOUD_OPTICAL_PER_KG);
export const AIR_Z=[500,1500,3000,5500,8500,12000,16000,20000,25000,31000,38000] as const;
export const AIR_DZ=[1000,1000,2000,3000,3000,4000,4000,4000,6000,6000,8000] as const;
const SIGMA=5.670374419e-8;
/** Black-surface, liquid-cloud limit of the two-stream scattering solver,
 * using transport depth (1-g)τ, g=.85. Full radiation includes reflections. */
export function cloudTransmission(mass:number){return 1/(1+.075*Math.max(0,mass)*COLUMN_KG*CLOUD_OPTICAL_PER_KG);}
/** Optical coverage of a surface water/ice film. A physical ocean must not
 * inherit the hidden rock albedo simply because its game inventory is small.
 * 10 kg/m² is the declared opaque-film scale; open water albedo .07.
 * Earth experiments instead use their actual land/sea and snow boundaries. */
export function climateSurfaceAlbedo(s:Float32Array,i:number){
 const p=i*STRIDE,water=-Math.expm1(-Math.max(0,s[p+F.water])*COLUMN_KG/10),ice=-Math.expm1(-Math.max(0,s[p+F.ice])*COLUMN_KG/10);
 const underlying=(1-water)*albedo(s,p)+water*.07;
 return (1-ice)*underlying+ice*.6;
}
const cp=AIR_FIELDS.map(f=>SPECIFIC_HEAT[f]);
const latent=AIR_FIELDS.map(f=>PHASE_ENERGY[f]);
const molar=[.018015,.028014,.016043,.04401];
const escapeMolar=AIR_FIELDS.slice(0,4).map(field=>GASES.find(g=>g.field===field)!.molarMass);
const escapeIndex=AIR_FIELDS.slice(0,4).map(field=>GASES.findIndex(g=>g.field===field));
const RAD_STRIDE=8+5*AIR_LAYERS;
export interface LayeredSnapshot {version:1|2;mass:number[];temperature:number[];velocity:number[];updraft:number[];gravity:number;radiationCache?:number[];}
export interface LayeredCheckpoint {mass:Float64Array;temperature:Float64Array;velocity:Float64Array;updraft:Float64Array;roundoff:Float64Array;radiationCache:Float64Array;gravity:number;initialized:boolean;detached:boolean;}
export interface AirEdge {i:number;j:number;distance:number;t:number[];}
/** Explicit prescribed-SST boundary for offline RCE experiments. The caller
 * supplies it every step; external heat is recorded in the command channel. */
export interface PrescribedClimateBoundary {temperature:number;albedo:number;windSpeed?:number;ozone?:'earth'|'rcemip';}
const sum=(a:ArrayLike<number>,p:number,n:number)=>{let s=0;for(let k=0;k<n;k++)s+=a[p+k];return s;};
export function surfaceCapacity(s:Float32Array,i:number){const p=i*STRIDE;return capacity(s,i)-AIR_FIELDS.reduce((a,f)=>a+s[p+f]*SPECIFIC_HEAT[f],0);}
export function surfaceEnthalpy(s:Float32Array,i:number){const p=i*STRIDE;return surfaceCapacity(s,i)*s[p+F.temperature]+phaseEnergy(s,i)-AIR_FIELDS.reduce((a,f)=>a+s[p+f]*PHASE_ENERGY[f],0);}
/** Dry parcel enthalpy + gravitational potential is invariant under lifting. */
export function liftedTemperature(t:number,dz:number,gravity=9.81,heatCapacity=1004){return t-gravity*dz/heatCapacity;}
/** Composition-aware ideal-gas saturation at the layer's actual pressure. */
export function saturatedVapor(dryMass:number,dryMoles:number,t:number,p:number,ice=false,activity=1){
 const es=saturationPressure(t,ice?'ice':'water')*activity;
 return es>=p?Infinity:.018015*dryMoles*es/Math.max(1e-12,p-es);
}
export function validLayered(value:unknown,count:number):value is LayeredSnapshot {
 if(!value||typeof value!=='object')return false;const a=value as LayeredSnapshot,n=count*(a.version===1?LEGACY_AIR_LAYERS:AIR_LAYERS);
 const arr=(v:unknown,len:number,min:number,max:number)=>Array.isArray(v)&&v.length===len&&v.every(x=>Number.isFinite(x)&&x>=min&&x<=max);
 return [1,2].includes(a.version)&&Number.isFinite(a.gravity)&&a.gravity>=.01&&a.gravity<=3&&arr(a.mass,n*6,0,100000)&&arr(a.temperature,n,-150,2500)&&arr(a.velocity,n*3,-5000,5000)&&arr(a.updraft,count*((a.version===1?LEGACY_AIR_LAYERS:AIR_LAYERS)-1),0,5000)&&(a.radiationCache===undefined||a.version===2&&arr(a.radiationCache,count*RAD_STRIDE,-1e18,1e18));
}

export class LayeredAtmosphere {
 readonly mass:Float64Array;readonly temperature:Float64Array;readonly velocity:Float64Array;readonly updraft:Float64Array;
 private roundoff:Float64Array;
 private initialized=false;private detached=false;private gravity=1;
 private delta:Float64Array;private heat:Float64Array;private momentum:Float64Array;private out:Float64Array;
 private gradients:Float64Array;private radiationCache:Float64Array;
 private acceleration:Float64Array;private rt:Float64Array;private virtualTemperature:Float64Array;private logPressure:Float64Array;private edgeSpeeds:Float64Array;private carried:Float64Array;
 constructor(readonly grid:SphereGrid,private edges:AirEdge[],private maxStepSeconds=1){if(!Number.isFinite(maxStepSeconds)||maxStepSeconds<=0||maxStepSeconds>60)throw new Error("대기 적분 간격은 0–60초 범위여야 합니다.");const n=grid.count*AIR_LAYERS;this.roundoff=new Float64Array(grid.count);this.mass=new Float64Array(n*6);this.temperature=new Float64Array(n);this.velocity=new Float64Array(n*3);this.updraft=new Float64Array(grid.count*(AIR_LAYERS-1));this.delta=new Float64Array(n*6);this.heat=new Float64Array(n);this.momentum=new Float64Array(n*3);this.out=new Float64Array(n);this.acceleration=new Float64Array(n*3);this.rt=new Float64Array(n);this.virtualTemperature=new Float64Array(n);this.logPressure=new Float64Array(n);this.edgeSpeeds=new Float64Array(edges.length*AIR_LAYERS);this.carried=new Float64Array(3);this.gradients=this.gradientGeometry();this.radiationCache=new Float64Array(grid.count*RAD_STRIDE);for(let i=0;i<grid.count;i++)this.radiationCache[i*RAD_STRIDE]=-1;}
 /** Consistent tangent least-squares gradient, including the 12 pentagons.
  * A fixed division by 3 biases irregular neighbor fans as resolution grows. */
 private gradientGeometry(){
  const n=this.grid.count,u=new Float64Array(n*3),v=new Float64Array(n*3),matrix=new Float64Array(n*3),components=new Float64Array(this.edges.length*4),result=new Float64Array(this.edges.length*6);
  for(let i=0;i<n;i++){const p=i*3,[x,y,z]=this.grid.directions.subarray(p,p+3),axis=Math.abs(z)<.9?[0,0,1]:[1,0,0],cross=[y*axis[2]-z*axis[1],z*axis[0]-x*axis[2],x*axis[1]-y*axis[0]],l=Math.hypot(...cross);for(let k=0;k<3;k++)u[p+k]=cross[k]/l;v.set([y*u[p+2]-z*u[p+1],z*u[p]-x*u[p+2],x*u[p+1]-y*u[p]],p);}
  this.edges.forEach(({i,j,t},index)=>{for(const [cell,offset] of [[i,0],[j,2]]){const p=cell*3,x=t.reduce((s,a,k)=>s+a*u[p+k],0),y=t.reduce((s,a,k)=>s+a*v[p+k],0),l=Math.hypot(x,y),a=x/l,b=y/l;components[index*4+offset]=a;components[index*4+offset+1]=b;matrix[p]+=a*a;matrix[p+1]+=a*b;matrix[p+2]+=b*b;}});
  this.edges.forEach(({i,j},index)=>{for(const [cell,offset,target] of [[i,0,0],[j,2,3]]){const p=cell*3,a=components[index*4+offset],b=components[index*4+offset+1],det=matrix[p]*matrix[p+2]-matrix[p+1]**2,x=(matrix[p+2]*a-matrix[p+1]*b)/det,y=(matrix[p]*b-matrix[p+1]*a)/det;for(let k=0;k<3;k++)result[index*6+target+k]=x*u[p+k]+y*v[p+k];}});return result;
 }
 snapshot():LayeredSnapshot|undefined{return this.initialized?{version:2,mass:[...this.mass],temperature:[...this.temperature],velocity:[...this.velocity],updraft:[...this.updraft],gravity:this.gravity,radiationCache:[...this.radiationCache]}:undefined;}
 /** Typed rollback state avoids serializing the entire atmosphere on every tick. */
 checkpoint():LayeredCheckpoint{return {mass:this.mass.slice(),temperature:this.temperature.slice(),velocity:this.velocity.slice(),updraft:this.updraft.slice(),roundoff:this.roundoff.slice(),radiationCache:this.radiationCache.slice(),gravity:this.gravity,initialized:this.initialized,detached:this.detached};}
 restoreCheckpoint(c:LayeredCheckpoint){this.mass.set(c.mass);this.temperature.set(c.temperature);this.velocity.set(c.velocity);this.updraft.set(c.updraft);this.roundoff.set(c.roundoff);this.radiationCache.set(c.radiationCache);this.gravity=c.gravity;this.initialized=c.initialized;this.detached=c.detached;}
 restore(s?:LayeredSnapshot){this.initialized=!!s;this.detached=false;this.mass.fill(0);this.temperature.fill(0);this.velocity.fill(0);this.updraft.fill(0);this.roundoff.fill(0);this.radiationCache.fill(0);for(let i=0;i<this.grid.count;i++)this.radiationCache[i*RAD_STRIDE]=-1;this.gravity=s?.gravity??1;if(s){
   if(s.version===2){this.mass.set(s.mass);this.temperature.set(s.temperature);this.velocity.set(s.velocity);this.updraft.set(s.updraft);if(s.radiationCache)this.radiationCache.set(s.radiationCache);}
   else for(let i=0;i<this.grid.count;i++){
    // Keep old five layers at their original heights. Empty added layers do
    // not invent atmospheric mass or energy during migration.
    this.mass.set(s.mass.slice(i*5*6,(i+1)*5*6),i*AIR_LAYERS*6);
    this.temperature.set(s.temperature.slice(i*5,(i+1)*5),i*AIR_LAYERS);
    this.velocity.set(s.velocity.slice(i*5*3,(i+1)*5*3),i*AIR_LAYERS*3);
    this.updraft.set(s.updraft.slice(i*4,(i+1)*4),i*(AIR_LAYERS-1));
   }
  }}
 get ready(){return this.initialized;}
 height(k:number){return AIR_Z[k]/this.gravity;}
 thickness(k:number){return AIR_DZ[k]/this.gravity;}
 layerMass(q:number){return sum(this.mass,q*6,6);}
 layerCapacity(q:number){let c=0;for(let f=0;f<6;f++)c+=this.mass[q*6+f]*cp[f];return c;}
 layerEnergy(q:number){let h=this.layerCapacity(q)*this.temperature[q];for(let f=0;f<6;f++)h+=this.mass[q*6+f]*latent[f];return h+this.layerMass(q)*(9.81*this.gravity*this.height(q%AIR_LAYERS)+this.speed2(q)*.5)/1000;}
 private speed2(q:number){const v=q*3;return this.velocity[v]**2+this.velocity[v+1]**2+this.velocity[v+2]**2;}
 private setEnergy(q:number,h:number){const c=this.layerCapacity(q);if(c<=1e-18){this.temperature[q]=0;this.velocity.fill(0,q*3,q*3+3);return;}let phase=0;for(let f=0;f<6;f++)phase+=this.mass[q*6+f]*latent[f];this.temperature[q]=(h-phase-this.layerMass(q)*(9.81*this.gravity*this.height(q%AIR_LAYERS)+this.speed2(q)*.5)/1000)/c;}
 totalEnergy(){let h=0;for(let q=0;q<this.temperature.length;q++)h+=this.layerEnergy(q);return h;}
 columnEnergy(i:number){let h=0;for(let k=0;k<AIR_LAYERS;k++)h+=this.layerEnergy(i*AIR_LAYERS+k);return h;}
 /** Relative to the old aggregate-at-surface-temperature diagnostic. */
 energyOffset(s:Float32Array,i:number){const p=i*STRIDE;return this.columnEnergy(i)-AIR_FIELDS.reduce((a,f)=>a+s[p+f]*(SPECIFIC_HEAT[f]*s[p+F.temperature]+PHASE_ENERGY[f]),0);}
 initialize(s:Float32Array,e:Environment,legacyWind?:Float32Array){
  if(this.initialized)return;this.gravity=e.gravity??1;
  for(let i=0;i<this.grid.count;i++){
   const p=i*STRIDE,old=enthalpy(s,i),t=s[p+F.temperature];
   let total=0;const weights=AIR_Z.map((z,k)=>{const low=z-AIR_DZ[k]/2,high=z+AIR_DZ[k]/2,w=Math.exp(-9.81*low/(287*Math.max(173.15,t+273.15)))-Math.exp(-9.81*high/(287*Math.max(173.15,t+273.15)));total+=w;return w;});
   for(let k=0;k<AIR_LAYERS;k++){const q=i*AIR_LAYERS+k;this.temperature[q]=Math.max(-150,t-.0065*Math.min(11000,AIR_Z[k])+.001*Math.max(0,AIR_Z[k]-20000));for(let f=0;f<6;f++)this.mass[q*6+f]=s[p+AIR_FIELDS[f]]*weights[k]/total;if(legacyWind)for(let v=0;v<3;v++)this.velocity[q*3+v]=legacyWind[i*3+v]*AIR_RADIUS/AIR_SECONDS;}
   // Opening the old shared reservoir into a stratified atmosphere is an
   // internal energy transfer, including its gravitational potential.
   s[p+F.temperature]+=(old-surfaceEnthalpy(s,i)-this.columnEnergy(i))/surfaceCapacity(s,i);this.roundoff[i]+=surfaceEnthalpy(s,i)+this.columnEnergy(i)-old;
  }
  this.initialized=true;
 }
 /** Remove aggregate mirrors before the surface CPU/WGSL kernel, so its heat
  * capacity, conduction and phase equilibrium contain surface matter only. */
 detach(s:Float32Array,e:Environment,legacyWind?:Float32Array){this.initialize(s,e,legacyWind);if(this.detached)return;this.reconcile(s);for(let i=0;i<this.grid.count;i++)for(const f of AIR_FIELDS)s[i*STRIDE+f]=0;this.detached=true;}
 attach(s:Float32Array){for(let i=0;i<this.grid.count;i++)for(let f=0;f<6;f++){let m=0;for(let k=0;k<AIR_LAYERS;k++)m+=this.mass[(i*AIR_LAYERS+k)*6+f];s[i*STRIDE+AIR_FIELDS[f]]=m;}this.detached=false;}
 /** Import an edited/save-time aggregate. Existing layer shape and temperature
  * survive; additions enter the boundary layer at the supply temperature. */
 reconcile(s:Float32Array,only?:number){if(!this.initialized||this.detached)return;for(let i=only??0;i<(only===undefined?this.grid.count:only+1);i++)for(let f=0;f<6;f++){let old=0;for(let k=0;k<AIR_LAYERS;k++)old+=this.mass[(i*AIR_LAYERS+k)*6+f];const desired=s[i*STRIDE+AIR_FIELDS[f]],difference=desired-old;if(Math.abs(difference)<=Math.max(1e-12,old*2e-7))continue;if(difference>0){const q=i*AIR_LAYERS,h=this.layerEnergy(q);this.mass[q*6+f]+=difference;this.setEnergy(q,h+difference*(cp[f]*20+latent[f]+9.81*this.gravity*this.height(0)/1000));}else for(let k=0;k<AIR_LAYERS;k++)this.mass[(i*AIR_LAYERS+k)*6+f]*=desired/Math.max(1e-30,old);}}
 supplies(s:Float32Array,commands:Float32Array,stride:number,energy:Float32Array){
  for(let i=0;i<this.grid.count;i++){
   const p=i*STRIDE,q=i*AIR_LAYERS,c=i*stride,erase=commands[c+7]>0?0:Math.max(0,Math.min(1,commands[c+5]));
   if(erase){const before=this.columnEnergy(i);for(let k=0;k<AIR_LAYERS;k++)for(let f=0;f<6;f++)this.mass[(q+k)*6+f]*=1-erase;energy[i*4+1]+=this.columnEnergy(i)-before;}
   let moved=0,h=enthalpy(s,i);
   for(let f=0;f<6;f++){const amount=s[p+AIR_FIELDS[f]];if(amount<=0)continue;const old=this.layerEnergy(q);this.mass[q*6+f]+=amount;const airHeat=amount*(cp[f]*20+latent[f]+9.81*this.gravity*this.height(0)/1000);this.setEnergy(q,old+airHeat);moved+=amount*(cp[f]*20+latent[f]);s[p+AIR_FIELDS[f]]=0;energy[i*4+1]+=amount*9.81*this.gravity*this.height(0)/1000;}
   s[p+F.temperature]=(h-moved-phaseEnergy(s,i))/capacity(s,i);this.roundoff[i]+=enthalpy(s,i)-(h-moved);
  }
 }
 pressure(i:number,k:number){let above=0;for(let l=k+1;l<AIR_LAYERS;l++)above+=this.layerMass(i*AIR_LAYERS+l);return Math.max(.01,(above+this.layerMass(i*AIR_LAYERS+k)*.5)*COLUMN_KG*9.81*this.gravity);}
 private dry(q:number){let mass=0,moles=0;for(let f=1;f<4;f++){mass+=this.mass[q*6+f];moles+=this.mass[q*6+f]/molar[f];}return {mass,moles};}
 private gasConstant(q:number){let mass=0,moles=0;for(let f=0;f<4;f++){mass+=this.mass[q*6+f];moles+=this.mass[q*6+f]/molar[f];}return mass>0?8.314462618*moles/mass:287;}
 private virtual(q:number,t=this.temperature[q]){const m=this.layerMass(q),gas=sum(this.mass,q*6,4);return (t+273.15)*this.gasConstant(q)/287*gas/Math.max(1e-30,m);}
 conditions(s:Float32Array,i:number){
  if(!this.initialized)return {temperature:s[i*STRIDE+F.temperature],humidity:0,pressure:0,saturation:0,excess:0,lift:0,height:0,layer:0};
  let k=0,largest=-1;for(let l=0;l<AIR_LAYERS;l++){const q=i*AIR_LAYERS+l,m=this.mass[q*6+4]+this.mass[q*6+5];if(m>largest){largest=m;k=l;}}
  // Clear columns report boundary-layer conditions, not an invented cloud layer.
  if(largest<=1e-12)k=0;const q=i*AIR_LAYERS+k,d=this.dry(q),p=this.pressure(i,k),ice=this.temperature[q]<0,sat=saturatedVapor(d.mass,d.moles,this.temperature[q],p,ice),v=this.mass[q*6],moles=v/.018015,partial=p*moles/Math.max(1e-30,moles+d.moles);
  return {temperature:this.temperature[q],humidity:partial/Math.max(1e-30,saturationPressure(this.temperature[q],ice?'ice':'water')),pressure:p,saturation:sat,excess:v-sat,lift:this.updraft[i*(AIR_LAYERS-1)+Math.min(k,AIR_LAYERS-2)],height:this.height(k),layer:k};
 }
 layerCloudFraction(i:number,k:number){
  const q=i*AIR_LAYERS+k,d=this.dry(q),total=this.mass[q*6]+this.mass[q*6+4]+this.mass[q*6+5],sat=saturatedVapor(d.mass,d.moles,this.temperature[q],this.pressure(i,k),this.temperature[q]<0);
  return statisticalCloud(total,sat).fraction;
 }
 /** Maximum-random area, using the same subcolumns as radiation. */
 cloudFraction(i:number){return maximumRandomCloudArea(Array.from({length:AIR_LAYERS},(_,k)=>this.layerCloudFraction(i,k)));}
 /** Original ecCKD 32x32 gas tables, Mie liquid/Baum ice tables, pressure-
  * interpolated interface Planck sources, and maximum-random cloud overlap.
  * Ozone/N2O remain prescribed; non-Earth gas mixtures are outside the tables.
  * Solar transfer uses a conservative diffuse two-stream approximation. */
 radiationColumn(s:Float32Array,i:number,e:Environment,solarOverride?:number,albedoOverride?:number,ozone:'earth'|'rcemip'='earth'):RadiationColumn{
  const n=AIR_LAYERS,temperature=this.temperature.subarray(i*n,(i+1)*n),pressure=Array.from({length:n},(_,k)=>this.pressure(i,k)),interfaces=new Float64Array(n+1);
  let above=0;for(let k=n-1;k>=0;k--){interfaces[k+1]=above;above+=this.layerMass(i*n+k)*COLUMN_KG*9.81*this.gravity;}interfaces[0]=above;
  const interfaceTemperature=new Float64Array(n+1);interfaceTemperature[n]=temperature[n-1]+273.15;
  for(let k=1;k<n;k++){const span=pressure[k-1]-pressure[k],weight=span>1e-20?(pressure[k-1]-interfaces[k])/span:.5;interfaceTemperature[k]=Math.max(1,273.15+temperature[k-1]+weight*(temperature[k]-temperature[k-1]));}
  const lowerSpan=pressure[0]-pressure[1];interfaceTemperature[0]=Math.max(1,273.15+temperature[0]+(lowerSpan>1e-20?(interfaces[0]-pressure[0])/lowerSpan*(temperature[0]-temperature[1]):0));
  const sources=Array.from(interfaceTemperature,spectralSource),surface=spectralSource(s[i*STRIDE+F.temperature]+273.15),cloudFraction=new Float64Array(n),cloudMeanAbsorptionDepth=new Float64Array(n),cloudTransportDepth=new Float64Array(n),opticalDepth=new Float64Array(n);
  const longwaveBands=Array.from(spectralWeights.longwave,(weight,g)=>({weight,opticalDepth:new Float64Array(n),sourceTop:Float64Array.from({length:n},(_,k)=>sources[k+1][g]),sourceBottom:Float64Array.from({length:n},(_,k)=>sources[k][g]),surfaceSource:surface[g],diffusivity:1.66,cloudMeanAbsorptionDepth:new Float64Array(n)}));
  const shortwaveBands=Array.from(spectralWeights.shortwave,weight=>({weight,absorptionDepth:new Float64Array(n),rayleighDepth:new Float64Array(n),cloudTransportDepth:new Float64Array(n),cloudMeanAbsorptionDepth:new Float64Array(n)}));
  for(let k=0;k<n;k++){
   const q=i*n+k,a=q*6,d=this.dry(q),p=pressure[k],o3=ozone==='rcemip'?3.6478e-6*(p/100)**.83209*Math.exp(-p/(100*11.3515)):undefined;
   const gas=spectralGasOptics({pressure:p,temperature:temperature[k]+273.15,dryMoles:d.moles*COLUMN_KG,waterMoles:this.mass[a]*COLUMN_KG/.018015,carbonDioxideMoles:this.mass[a+3]*COLUMN_KG/.04401,methaneMoles:this.mass[a+2]*COLUMN_KG/.016043,ozone:o3,n2o:ozone==='rcemip'?306e-9:320e-9});
   const liquid=this.mass[a+4]*COLUMN_KG,ice=this.mass[a+5]*COLUMN_KG;cloudFraction[k]=this.layerCloudFraction(i,k);
   for(let g=0;g<32;g++){
    const lw=longwaveBands[g],sw=shortwaveBands[g];lw.opticalDepth[k]=gas.longwave[g];sw.absorptionDepth[k]=gas.shortwave[g];sw.rayleighDepth[k]=gas.rayleigh[g];
    lw.cloudMeanAbsorptionDepth[k]=liquid*spectralCloudOptics.liquidLongwaveAbsorption[g]+ice*spectralCloudOptics.iceLongwaveAbsorption[g];
    sw.cloudMeanAbsorptionDepth[k]=liquid*spectralCloudOptics.liquidShortwaveAbsorption[g]+ice*spectralCloudOptics.iceShortwaveAbsorption[g];
    sw.cloudTransportDepth[k]=liquid*spectralCloudOptics.liquidShortwaveTransport[g]+ice*spectralCloudOptics.iceShortwaveTransport[g];
    cloudMeanAbsorptionDepth[k]+=lw.weight*lw.cloudMeanAbsorptionDepth[k];cloudTransportDepth[k]+=sw.weight*sw.cloudTransportDepth[k];opticalDepth[k]+=lw.weight*lw.opticalDepth[k];
   }
  }
  const exposure=Math.max(0,[0,1,2].reduce((a,k)=>a+this.grid.directions[i*3+k]*e.sun[k],0));
  return {temperature,opticalDepth,cloudTransportDepth,cloudFraction,cloudMeanAbsorptionDepth,cloudOverlap:'maximum-random',longwaveBands,shortwaveBands,surfaceTemperature:s[i*STRIDE+F.temperature],surfaceAlbedo:albedoOverride??climateSurfaceAlbedo(s,i),solar:solarOverride??1361*e.sunlight*exposure};
 }
 /** Diagnostic only: current atmosphere held fixed. */
 surfaceRadiativeTarget(s:Float32Array,i:number,e:Environment){const f=radiativeFluxes(this.radiationColumn(s,i,e));return ((f.surfaceSolar+f.down[0])/SIGMA)**.25-273.15;}
 surfaceLight(s:Float32Array,i:number,e:Environment){
  const p=i*3,exposure=this.grid.directions[p]*e.sun[0]+this.grid.directions[p+1]*e.sun[1]+this.grid.directions[p+2]*e.sun[2];
  if(e.sunlight<=0||exposure<=0)return 0;
  return surfaceSolarDown(this.radiationColumn(s,i,e))/1361;
 }
 /** Tangent-vector parallel transport between sphere cells (Rodrigues). */
 private carriedVelocity(q:number,from:number,to:number){const g=this.grid,n=from*3,m=to*3,v=q*3,ax=g.directions[n+1]*g.directions[m+2]-g.directions[n+2]*g.directions[m+1],ay=g.directions[n+2]*g.directions[m]-g.directions[n]*g.directions[m+2],az=g.directions[n]*g.directions[m+1]-g.directions[n+1]*g.directions[m],c=g.directions[n]*g.directions[m]+g.directions[n+1]*g.directions[m+1]+g.directions[n+2]*g.directions[m+2],x=this.velocity[v],y=this.velocity[v+1],z=this.velocity[v+2],bx=ay*z-az*y,by=az*x-ax*z,bz=ax*y-ay*x;this.carried[0]=x+bx+(ay*bz-az*by)/Math.max(1e-9,1+c);this.carried[1]=y+by+(az*bx-ax*bz)/Math.max(1e-9,1+c);this.carried[2]=z+bz+(ax*by-ay*bx)/Math.max(1e-9,1+c);}
 private queue(d:number,r:number,fraction:number){
  if(fraction<=0||this.layerMass(d)<1e-18)return;
  const di=Math.floor(d/AIR_LAYERS),ri=Math.floor(r/AIR_LAYERS),m=this.layerMass(d)*fraction,h=this.layerEnergy(d)*fraction;
  if(di!==ri)this.carriedVelocity(d,di,ri);
  for(let f=0;f<6;f++){const a=this.mass[d*6+f]*fraction;this.delta[d*6+f]-=a;this.delta[r*6+f]+=a;}this.heat[d]-=h;this.heat[r]+=h;
  for(let k=0;k<3;k++){this.momentum[d*3+k]-=m*this.velocity[d*3+k];this.momentum[r*3+k]+=m*(di===ri?this.velocity[d*3+k]:this.carried[k]);}
 }
 private commit(){
  for(let q=0;q<this.temperature.length;q++){
   const oldMass=this.layerMass(q),h=this.layerEnergy(q)+this.heat[q];
   for(let f=0;f<6;f++)this.mass[q*6+f]+=this.delta[q*6+f];const m=this.layerMass(q);
   for(let k=0;k<3;k++)this.velocity[q*3+k]=m>1e-18?(oldMass*this.velocity[q*3+k]+this.momentum[q*3+k])/m:0;
   this.setEnergy(q,h);
  }
 }
 private clearFlux(){this.delta.fill(0);this.heat.fill(0);this.momentum.fill(0);this.out.fill(0);}
 private dynamics(dt:number,e:Environment){
  const acceleration=this.acceleration,rt=this.rt,virtual=this.virtualTemperature,logPressure=this.logPressure;
  acceleration.fill(0);
  for(let i=0;i<this.grid.count;i++){let above=0;for(let k=AIR_LAYERS-1;k>=0;k--){const q=i*AIR_LAYERS+k,m=this.layerMass(q);rt[q]=this.gasConstant(q)*(this.temperature[q]+273.15);virtual[q]=this.virtual(q);logPressure[q]=Math.log(Math.max(.01,(above+m*.5)*COLUMN_KG*9.81*this.gravity));above+=m;}}
  let edgeIndex=0;for(const {i,j,distance} of this.edges){let thermal=0,previous=0;for(let k=0;k<AIR_LAYERS;k++){
   const a=i*AIR_LAYERS+k,b=j*AIR_LAYERS+k;
   if(this.layerMass(a)<1e-12||this.layerMass(b)<1e-12)continue;
   // Linearized hypsometric pressure anomaly at a fixed reference height:
   // ∂z ln p = -g/(R Tv). Heating expands the column and creates horizontal
   // pressure differences even before total column mass has redistributed.
   const lower=k===0?0:this.height(k-1),relative=2*(virtual[b]-virtual[a])/Math.max(1,virtual[b]+virtual[a]);thermal+=9.81*this.gravity*(this.height(k)-lower)*(k===0?relative:(previous+relative)*.5);previous=relative;
   const force=-((rt[a]+rt[b])*.5*(logPressure[b]-logPressure[a])+thermal)/(distance*AIR_RADIUS);
   for(let v=0;v<3;v++){acceleration[a*3+v]+=force*this.gradients[edgeIndex*6+v];acceleration[b*3+v]+=force*this.gradients[edgeIndex*6+3+v];}
  }edgeIndex++;}
  const groundDrag=Math.exp(-dt/86400),airDrag=Math.exp(-dt/604800),g=this.grid.directions;
  let previousCell=-1,c=1,sn=0;
  for(let q=0;q<this.temperature.length;q++){
   const h=this.layerEnergy(q),i=Math.floor(q/AIR_LAYERS),v=q*3,n=i*3;
   if(i!==previousCell){const angle=-2*(e.rotationRate??0)/AIR_SECONDS*g[n+1]*dt;c=Math.cos(angle);sn=Math.sin(angle);previousCell=i;}
   for(let k=0;k<3;k++)this.velocity[v+k]+=acceleration[v+k]*dt;
   const dot=this.velocity[v]*g[n]+this.velocity[v+1]*g[n+1]+this.velocity[v+2]*g[n+2];for(let k=0;k<3;k++)this.velocity[v+k]-=dot*g[n+k];
   const x=this.velocity[v],y=this.velocity[v+1],z=this.velocity[v+2],drag=q%AIR_LAYERS===0?groundDrag:airDrag;
   this.velocity[v]=(x*c+(g[n+1]*z-g[n+2]*y)*sn)*drag;this.velocity[v+1]=(y*c+(g[n+2]*x-g[n]*z)*sn)*drag;this.velocity[v+2]=(z*c+(g[n]*y-g[n+1]*x)*sn)*drag;
   // Pressure work, drag and upwind mixing exchange kinetic/internal energy;
   // dissipation is retained as heat rather than silently discarded.
   this.setEnergy(q,h);
  }
  this.clearFlux();
  let speedIndex=0;
  for(const {i,j,distance,t} of this.edges)for(let k=0;k<AIR_LAYERS;k++){
   const a=i*AIR_LAYERS+k,b=j*AIR_LAYERS+k,speed=t.reduce((v,x,l)=>v+x*(this.velocity[a*3+l]+this.velocity[b*3+l])*.5,0),d=speed>=0?a:b;
   this.edgeSpeeds[speedIndex++]=speed;
   this.out[d]+=Math.abs(speed)*dt/(distance*AIR_RADIUS*3);
  }
  let max=0;for(const v of this.out)max=Math.max(max,v);if(max>.45)throw new Error('대기 수평 CFL 한계를 넘었습니다.');
  speedIndex=0;
  for(const {i,j,distance} of this.edges)for(let k=0;k<AIR_LAYERS;k++){const a=i*AIR_LAYERS+k,b=j*AIR_LAYERS+k,speed=this.edgeSpeeds[speedIndex++];this.queue(speed>=0?a:b,speed>=0?b:a,Math.abs(speed)*dt/(distance*AIR_RADIUS*3));}
  this.commit();
  this.clearFlux();
  for(let i=0;i<this.grid.count;i++)for(let k=0;k<AIR_LAYERS-1;k++){
   const a=i*AIR_LAYERS+k,b=a+1;if(this.layerMass(a)<1e-12||this.layerMass(b)<1e-12){this.updraft[i*(AIR_LAYERS-1)+k]=0;continue;}const z=this.height(k+1)-this.height(k);
   let dryCapacity=0;for(let f=1;f<4;f++)dryCapacity+=this.mass[a*6+f]*cp[f];
   const ma=this.layerMass(a),mb=this.layerMass(b),mix=-Math.expm1(-PLUME_ENTRAINMENT*z),da=this.dry(a),db=this.dry(b);
   // Compensate DRY air, not moist total mass. Otherwise every evaporation /
   // precipitation cycle pumps noncondensable air into the bottom layer.
   // This is the dry-mass-coordinate principle, not the full WRF equations.
   const useDry=da.mass>1e-12&&db.mass>1e-12,referenceA=useDry?da.mass:ma,referenceB=useDry?db.mass:mb,scale=referenceA/referenceB,mixedMass=(1-mix)*ma+mix*scale*mb;
   let envCapacity=0;for(let f=1;f<4;f++)envCapacity+=this.mass[b*6+f]*cp[f];
   const dryMoles=(1-mix)*da.moles+mix*scale*db.moles,water=(1-mix)*(this.mass[a*6]+this.mass[a*6+4]+this.mass[a*6+5])+mix*scale*(this.mass[b*6]+this.mass[b*6+4]+this.mass[b*6+5]),
    dryMass=(1-mix)*da.mass+mix*scale*db.mass,mixedH=(1-mix)*(this.layerEnergy(a)-ma*this.speed2(a)*.5/1000)+mix*scale*(this.layerEnergy(b)-mb*this.speed2(b)*.5/1000),
    parcel=parcelEquilibrium((1-mix)*dryCapacity+mix*scale*envCapacity,dryMoles,water,mixedH,this.pressure(i,k+1),mixedMass*9.81*this.gravity*this.height(k+1)/1000),
    parcelGas=dryMass+parcel.vapor,parcelR=8.314462618*(dryMoles+parcel.vapor/.018015)/Math.max(1e-30,parcelGas),parcelVirtual=(parcel.temperature+273.15)*parcelR/287*parcelGas/mixedMass;
   const buoyancy=9.81*this.gravity*(parcelVirtual-this.virtual(b))/Math.max(1,this.virtual(b)),v=i*(AIR_LAYERS-1)+k;
   const old=this.updraft[v],w=Math.max(0,(old+buoyancy*dt)/(1+PLUME_ENTRAINMENT*old*dt));this.updraft[v]=w;
   const m=Math.min(referenceA,referenceB)*w*dt/z,fa=m/referenceA,fb=m/referenceB;this.out[a]+=fa;this.out[b]+=fb;this.queue(a,b,fa);this.queue(b,a,fb);
  }
  for(const v of this.out)if(v>.45)throw new Error('대기 수직 CFL 한계를 넘었습니다.');this.commit();
 }
 private phase(q:number,i:number,k:number,condensed?:Float32Array){
  const total=this.mass[q*6]+this.mass[q*6+4]+this.mass[q*6+5];if(total<=0)return;
  const h=this.layerEnergy(q),d=this.dry(q),p=this.pressure(i,k);if(this.mass[q*6+4]+this.mass[q*6+5]<=1e-18&&statisticalCloud(total,saturatedVapor(d.mass,d.moles,this.temperature[q],p,this.temperature[q]<0)).condensate===0)return;
  let dryCapacity=0;for(let f=1;f<4;f++)dryCapacity+=this.mass[q*6+f]*cp[f];const potential=this.layerMass(q)*(9.81*this.gravity*this.height(k)+this.speed2(q)*.5)/1000;
  const equilibrium=(t:number)=>{const ice=t<0,sat=saturatedVapor(d.mass,d.moles,t,p,ice),v=total-statisticalCloud(total,sat).condensate,liquid=ice?0:total-v,frozen=ice?total-v:0,c=dryCapacity+v*cp[0]+liquid*cp[4]+frozen*cp[5],ph=v*latent[0]+frozen*latent[5];return {v,liquid,frozen,energy:c*t+ph+potential};},old=this.mass[q*6];
  // Mixed-phase water at 0 C fills the latent-energy gap continuously.
  const cold=equilibrium(-1e-9),warm=equilibrium(1e-9);
  if(h>=cold.energy&&h<=warm.energy){const cloud=statisticalCloud(total,saturatedVapor(d.mass,d.moles,0,p)).condensate,v=total-cloud;this.mass[q*6]=v;this.mass[q*6+5]=Math.min(cloud,Math.max(0,(warm.energy-h)/334));this.mass[q*6+4]=cloud-this.mass[q*6+5];}else{
   let lo=h<cold.energy?-150:1e-9,hi=h<cold.energy?-1e-9:2500,t=Math.max(lo,Math.min(hi,this.temperature[q])),r=equilibrium(t),converged=false;
   // Safeguarded Newton avoids 34 full saturation evaluations in every cloudy
   // layer every tick. Retain bisection for difficult/phase-boundary cases.
   for(let n=0;n<12;n++){r=equilibrium(t);const error=r.energy-h;if(Math.abs(error)<1e-11*Math.max(1,Math.abs(h))){converged=true;break;}if(error>0)hi=t;else lo=t;const epsilon=t+.01>=hi?-.01:.01,derivative=(equilibrium(t+epsilon).energy-r.energy)/epsilon,candidate=t-error/derivative;t=Number.isFinite(candidate)&&candidate>lo&&candidate<hi?candidate:(lo+hi)*.5;}
   if(!converged){for(let n=0;n<34;n++){t=(lo+hi)*.5;if(equilibrium(t).energy>h)hi=t;else lo=t;}t=(lo+hi)*.5;r=equilibrium(t);}
   this.mass[q*6]=r.v;this.mass[q*6+4]=r.liquid;this.mass[q*6+5]=r.frozen;
  }
  this.setEnergy(q,h);if(condensed)condensed[i]+=Math.max(0,old-this.mass[q*6]);
 }
 private surfaceExchange(s:Float32Array,i:number,dt:number,boundary?:PrescribedClimateBoundary){
  const p=i*STRIDE,q=i*AIR_LAYERS,m=this.layerMass(q),ca=this.layerCapacity(q);
  let ha=this.layerEnergy(q),hs=enthalpy(s,i),cs=capacity(s,i),t=s[p+F.temperature],air=this.temperature[q],u=boundary?.windSpeed??Math.hypot(...this.velocity.subarray(q*3,q*3+3));
  const rho=m*COLUMN_KG/this.thickness(0),transfer=rho*1004*.0015*Math.max(1,u)/COLUMN_KG/1000;
  if(ca>1e-18){const amount=(t-air)*(-Math.expm1(-transfer*(1/cs+1/ca)*dt))/(1/cs+1/ca);hs-=amount;ha+=amount;s[p+F.temperature]=(hs-phaseEnergy(s,i))/cs;this.roundoff[i]+=enthalpy(s,i)-hs;this.setEnergy(q,ha);}
  const source=s[p+F.water]>0?F.water:s[p+F.ice]>0?F.ice:null;if(source===null)return;
  t=s[p+F.temperature];const d=this.dry(q),sat=saturatedVapor(d.mass,d.moles,t,this.pressure(i,0),source===F.ice,waterActivity(s[p+F.water],s[p+F.dissolved])),v=this.mass[q*6];
  // At/below saturation pressure there is no finite bulk mixing ratio. Use
  // Hertz–Knudsen's kinetic flux (accommodation 0.01), including a vacuum.
  const kinetic=.01*Math.max(0,saturationPressure(t,source===F.ice?'ice':'water')*waterActivity(s[p+F.water],s[p+F.dissolved])-this.pressure(i,0))*Math.sqrt(.018015/(2*Math.PI*8.314462618*Math.max(123.15,t+273.15)))*dt/COLUMN_KG;
  const demand=Number.isFinite(sat)?Math.max(0,sat-v)*(-Math.expm1(-.0015*Math.max(1,u)*dt/this.thickness(0))):kinetic;
  const evaporated=Math.min(s[p+source],demand,Math.max(0,(t+100)*capacity(s,i)/(2809+9.81*this.gravity*this.height(0)/1000)));
  if(evaporated<=0)return;hs=enthalpy(s,i);ha=this.layerEnergy(q);const incoming=evaporated*(cp[0]*t+latent[0]+9.81*this.gravity*this.height(0)/1000);s[p+source]-=evaporated;this.mass[q*6]+=evaporated;this.setEnergy(q,ha+incoming);s[p+F.temperature]=(hs-incoming-phaseEnergy(s,i))/capacity(s,i);this.roundoff[i]+=enthalpy(s,i)-(hs-incoming);
 }
 /** Radiation coefficients sampled at most every 300 s. Solar transport
  * is linear in incident flux, so changing day/night rescales it exactly.
  * Rapid thermal, mass or cloud changes invalidate the cached coefficients.
  * Cache state is serialized to preserve bit-identical save/resume. */
 private radiation(s:Float32Array,i:number,dt:number,e:Environment,energy:Float32Array,boundary?:PrescribedClimateBoundary){
  const p=i*STRIDE,r=i*RAD_STRIDE,c=this.radiationCache,alb=boundary?.albedo??climateSurfaceAlbedo(s,i),mode=boundary?.ozone==='rcemip'?1:0;
  let update=c[r]<0||c[r]>=300||Math.abs(c[r+5]-s[p+F.temperature])>1||Math.abs(c[r+6]-alb)>.01||c[r+7]!==mode;
  for(let k=0;k<AIR_LAYERS&&!update;k++){const q=i*AIR_LAYERS+k,a=r+8+k*5,m=this.layerMass(q),cloud=(this.mass[q*6+4]+this.mass[q*6+5])*COLUMN_KG;update=Math.abs(c[a]-this.temperature[q])>1||Math.abs(m-c[a+1])>.02*Math.max(1e-15,m)||Math.abs(cloud-c[a+2])>.01;}
  if(update){
   const flux=radiativeFluxes(this.radiationColumn(s,i,e,1,alb,boundary?.ozone));c[r]=0;c[r+1]=flux.down[0]-flux.up[0];c[r+2]=flux.surfaceSolar;c[r+3]=-flux.olr;c[r+4]=1-flux.reflectedSolar;c[r+5]=s[p+F.temperature];c[r+6]=alb;c[r+7]=mode;
   for(let k=0;k<AIR_LAYERS;k++){const q=i*AIR_LAYERS+k,a=r+8+k*5,solarHeat=flux.swDown[k+1]-flux.swUp[k+1]-flux.swDown[k]+flux.swUp[k];c[a]=this.temperature[q];c[a+1]=this.layerMass(q);c[a+2]=(this.mass[q*6+4]+this.mass[q*6+5])*COLUMN_KG;c[a+3]=flux.heating[k]-solarHeat;c[a+4]=solarHeat;}
  }
  c[r]+=dt;const solar=1361*e.sunlight*Math.max(0,[0,1,2].reduce((a,k)=>a+this.grid.directions[i*3+k]*e.sun[k],0)),coefficient=dt/(COLUMN_KG*1000),hs=enthalpy(s,i),heat=coefficient*(c[r+1]+solar*c[r+2]);
  s[p+F.temperature]=(hs+heat-phaseEnergy(s,i))/capacity(s,i);this.roundoff[i]+=enthalpy(s,i)-(hs+heat);
  for(let k=0;k<AIR_LAYERS;k++){const q=i*AIR_LAYERS+k,a=r+8+k*5;this.setEnergy(q,this.layerEnergy(q)+coefficient*(c[a+3]+solar*c[a+4]));}
  energy[i*4]+=coefficient*(c[r+3]+solar*c[r+4]);
 }
 /** KK droplet-number-dependent warm autoconversion, Kessler accretion,
  * and Lin cloud-ice aggregation. Rain/snow are diagnostic downward
  * mass/enthalpy fluxes with evaporation, sublimation and heat-limited melt.
  * Rain's local mixing ratio
  * follows the published terminal velocity law, not cloud settling speed.
  * Clear-air evaporation is bounded by an implicit saturation/enthalpy solve.
  * Unaggregated 30-µm ice also sediments at its Stokes speed. */
 private depositPrecipitation(s:Float32Array,i:number,field:typeof F.water|typeof F.ice,amount:number,carried:number,precipitated?:Float32Array){
  const p=i*STRIDE,index=p+field,old=s[index],hs=enthalpy(s,i);
  // Do not discard sub-ULP rain on a large Float32 ocean. Transfer only
  // representable surface mass and retain the remainder in Float64 air.
  let stored=Math.fround(old+amount);
  if(stored-old>amount){const bits=new Uint32Array(new Float32Array([stored]).buffer);bits[0]--;stored=new Float32Array(bits.buffer)[0];}
  const received=Math.max(0,stored-old),ratio=amount>0?received/amount:0,residual=amount-received;
  s[index]=stored;s[p+F.temperature]=(hs+carried*ratio-phaseEnergy(s,i))/capacity(s,i);equilibrateWater(s,i);this.roundoff[i]+=enthalpy(s,i)-(hs+carried*ratio);
  if(residual>0){const q=i*AIR_LAYERS,h=this.layerEnergy(q);this.mass[q*6+(field===F.water?4:5)]+=residual;this.setEnergy(q,h+carried*(1-ratio));}
  if(precipitated)precipitated[i*2+(field===F.water?0:1)]+=received;
 }
 private precipitation(s:Float32Array,i:number,dt:number,precipitated?:Float32Array){
  const p=i*STRIDE;let rain=0,rainEnergy=0,snow=0,snowEnergy=0;
  for(let k=AIR_LAYERS-1;k>=0;k--){
   const q=i*AIR_LAYERS+k,a=q*6,fraction=this.layerCloudFraction(i,k),dryMass=this.dry(q).mass,gas=dryMass>1e-12?dryMass:sum(this.mass,a,4),density=gas*COLUMN_KG/this.thickness(k);
   const convert=(amount:number)=>{if(amount<=0)return;const h=this.layerEnergy(q),carried=amount*(cp[4]*this.temperature[q]+(9.81*this.gravity*this.height(k)+this.speed2(q)*.5)/1000);this.mass[a+4]-=amount;this.setEnergy(q,h-carried);rain+=amount;rainEnergy+=carried;};
   convert(this.mass[a+4]*warmAutoFraction(this.mass[a+4]/Math.max(1e-30,gas*fraction),dt));
   if(rain>0&&gas>0){
    const qr=diagnosticRainMixingRatio(rain*COLUMN_KG/dt,density);
    convert(this.mass[a+4]*kesslerAccretedFraction(qr,dt));
   }
   const aggregated=gas*fraction*iceAggregation(this.mass[a+5]/Math.max(1e-30,gas*fraction),this.temperature[q],density,dt);
   if(aggregated>0){const h=this.layerEnergy(q),carried=aggregated*(cp[5]*this.temperature[q]+latent[5]+(9.81*this.gravity*this.height(k)+this.speed2(q)*.5)/1000);this.mass[a+5]-=aggregated;this.setEnergy(q,h-carried);snow+=aggregated;snowEnergy+=carried;}
   if(snow>0){
    // Snow melting uses available sensible heat, retaining unmelted snow.
    const liquidH=(9.81*this.gravity*this.height(k)+this.speed2(q)*.5)/1000,snowH=snowEnergy/snow,change=snowH-liquidH;
    const melted=this.temperature[q]>0?Math.min(snow,change>=0?snow:this.layerCapacity(q)*this.temperature[q]/(-change)):0;
    if(melted>0){this.setEnergy(q,this.layerEnergy(q)+melted*change);snow-=melted;snowEnergy-=melted*snowH;rain+=melted;rainEnergy+=melted*liquidH;}
    if(snow>0){
     const oldH=this.layerEnergy(q),oldV=this.mass[a],oldMass=this.layerMass(q),oldC=this.layerCapacity(q),d=this.dry(q),pressure=this.pressure(i,k),potential=(9.81*this.gravity*this.height(k)+this.speed2(q)*.5)/1000,carried=snowEnergy/snow;
     let phase=0;for(let f=0;f<6;f++)phase+=this.mass[a+f]*latent[f];
     const temp=(evap:number)=>(oldH+evap*carried-phase-evap*latent[0]-(oldMass+evap)*potential)/(oldC+evap*cp[0]);
     const excess=(evap:number)=>oldV+evap-saturatedVapor(d.mass,d.moles,temp(evap),pressure,temp(evap)<0);
     if(excess(0)<0){let lo=0,hi=snow*(1-fraction);if(excess(hi)<=0&&temp(hi)>=-150)lo=hi;else for(let iteration=0;iteration<24;iteration++){const middle=(lo+hi)/2;if(excess(middle)>0||temp(middle)<-150)hi=middle;else lo=middle;}this.mass[a]+=lo;this.setEnergy(q,oldH+lo*carried);snow-=lo;snowEnergy-=lo*carried;}
    }
   }
   if(rain>0){
    const oldH=this.layerEnergy(q),oldV=this.mass[a],oldMass=this.layerMass(q),oldC=this.layerCapacity(q),d=this.dry(q),pressure=this.pressure(i,k),potential=(9.81*this.gravity*this.height(k)+this.speed2(q)*.5)/1000,rainH=rainEnergy/rain;
    let phase=0;for(let f=0;f<6;f++)phase+=this.mass[a+f]*latent[f];
    const temp=(evap:number)=>(oldH+evap*rainH-phase-evap*latent[0]-(oldMass+evap)*potential)/(oldC+evap*cp[0]);
    const excess=(evap:number)=>oldV+evap-saturatedVapor(d.mass,d.moles,temp(evap),pressure,temp(evap)<0);
    if(excess(0)<0){let lo=0,hi=rain*(1-fraction);
     if(excess(hi)<=0&&temp(hi)>=-150)lo=hi;else for(let iteration=0;iteration<24;iteration++){const middle=(lo+hi)/2;if(excess(middle)>0||temp(middle)<-150)hi=middle;else lo=middle;}
     this.mass[a]+=lo;this.setEnergy(q,oldH+lo*rainH);rain-=lo;rainEnergy-=lo*rainH;
    }
   }
   const ice=this.mass[a+5],fall=2*917*9.81*this.gravity*(30e-6)**2/(9*1.8e-5),iceAmount=ice*(-Math.expm1(-fall*dt/this.thickness(k)));
   if(iceAmount<=0)continue;
   const h=this.layerEnergy(q),carried=iceAmount*(cp[5]*this.temperature[q]+latent[5]+(9.81*this.gravity*this.height(k)+this.speed2(q)*.5)/1000);this.mass[a+5]-=iceAmount;this.setEnergy(q,h-carried);
   if(k>0){const lower=q-1,hr=this.layerEnergy(lower);this.mass[lower*6+5]+=iceAmount;this.setEnergy(lower,hr+carried);}else this.depositPrecipitation(s,i,F.ice,iceAmount,carried,precipitated);
  }
  if(snow>0)this.depositPrecipitation(s,i,F.ice,snow,snowEnergy,precipitated);
  if(rain>0)this.depositPrecipitation(s,i,F.water,rain,rainEnergy,precipitated);
 }
 advance(s:Float32Array,gameDt:number,e:Environment,energy:Float32Array,condensed?:Float32Array,precipitated?:Float32Array,escaped?:Float32Array,boundary?:PrescribedClimateBoundary){
  if(boundary&&(!Number.isFinite(boundary.temperature)||boundary.temperature< -150||boundary.temperature>2500||!Number.isFinite(boundary.albedo)||boundary.albedo<0||boundary.albedo>1||boundary.windSpeed!==undefined&&(!Number.isFinite(boundary.windSpeed)||boundary.windSpeed<0||boundary.windSpeed>100)))throw new Error('지정한 기후 경계 조건이 올바르지 않습니다.');
  if(!this.detached)this.detach(s,e);this.gravity=e.gravity??1;if(gameDt<=0){this.attach(s);for(let i=0;i<this.grid.count;i++)energy[i*4+3]+=this.roundoff[i];this.roundoff.fill(0);return;}
  const physicalDt=gameDt*AIR_SECONDS;let remaining=physicalDt;
  const prescribe=()=>{if(boundary)for(let i=0;i<this.grid.count;i++){const h=enthalpy(s,i);s[i*STRIDE+F.temperature]=boundary.temperature;energy[i*4+1]+=enthalpy(s,i)-h;}};
  prescribe();
  while(remaining>1e-10){
   let step=Math.min(this.maxStepSeconds,remaining);
   for(let i=0;i<this.grid.count;i++)for(let k=0;k<AIR_LAYERS-1;k++){
    const a=i*AIR_LAYERS+k,b=a+1,dz=this.height(k+1)-this.height(k),w=this.updraft[i*(AIR_LAYERS-1)+k];
    // A lifted moist parcel cannot be warmer than its starting virtual
    // temperature. Bound its acceleration before selecting the CFL step.
    const bound=9.81*this.gravity*Math.max(0,this.virtual(a)-this.virtual(b))/Math.max(1,this.virtual(b));
    step=Math.min(step,.12*dz/Math.max(1,w+bound*step));
   }
   for(const edge of this.edges)for(let k=0;k<AIR_LAYERS;k++){const a=edge.i*AIR_LAYERS+k,b=edge.j*AIR_LAYERS+k;step=Math.min(step,.12*edge.distance*AIR_RADIUS/Math.max(1,Math.sqrt(this.speed2(a)),Math.sqrt(this.speed2(b))));}
   for(let i=0;i<this.grid.count;i++){this.surfaceExchange(s,i,step,boundary);this.radiation(s,i,step,e,energy,boundary);}
   this.dynamics(step,e);
   for(let i=0;i<this.grid.count;i++){for(let k=0;k<AIR_LAYERS;k++)this.phase(i*AIR_LAYERS+k,i,k,condensed);this.precipitation(s,i,step,precipitated);}
   prescribe();
   remaining-=step;
  }
  for(let i=0;i<this.grid.count;i++)for(let k=0;k<AIR_LAYERS;k++)for(let f=0;f<4;f++){
   const q=i*AIR_LAYERS+k,before=this.mass[q*6+f];if(before<=0)continue;
   const amount=before*thermalEscapeFraction(this.temperature[q],e.gravity??1,escapeMolar[f],gameDt);if(amount===0)continue;
   const h=this.layerEnergy(q),carried=amount*(cp[f]*this.temperature[q]+latent[f]+(9.81*this.gravity*this.height(k)+this.speed2(q)*.5)/1000);
   this.mass[q*6+f]-=amount;this.setEnergy(q,h-carried);if(escaped)escaped[i*4+escapeIndex[f]]+=amount;energy[i*4+2]-=carried;
  }
  for(const t of this.temperature)if(!Number.isFinite(t)||t< -150.001||t>2500.001)throw new Error('대기 온도가 모델 범위를 벗어났습니다.');
  this.attach(s);for(let i=0;i<this.grid.count;i++)energy[i*4+3]+=this.roundoff[i];this.roundoff.fill(0);
 }
 surfaceWind(target:Float32Array){for(let i=0;i<this.grid.count;i++)for(let k=0;k<3;k++)target[i*3+k]=this.velocity[(i*AIR_LAYERS)*3+k]*AIR_SECONDS/AIR_RADIUS;}
}
