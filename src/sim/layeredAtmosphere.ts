import {assertInventoryAmount,validInventoryAmount,type PhysicalState} from './physicalState';
import {admitLocalChange,type LocalMechanics} from './mechanicalBoundary';
import {SOOT,particleLiftFlux,particleSettlingSpeed,aerosolOptics} from './aerosolPhysics';
import {buoyancyAcceleration,surfaceExchangeSpeed} from './buoyancy';
import {COMBUSTION_REACTIONS,oxidationRoutes,combust} from './ecology';
import {materialReaction,reactInventory,thermalReactionLimit} from './materialReaction';
import {waterEquilibrium,waterStateAtTemperature} from './phaseEquilibrium';
import {AIR_SECONDS,COLUMN_KG,radiationEnergy} from './climateUnits';
export {AIR_SECONDS,COLUMN_KG} from './climateUnits';
import {F,STRIDE,MASS_FIELDS,capacity,enthalpy,phaseEnergy,equilibrateWater,type Environment} from './model';
import {BASE_CAPACITY,SPECIFIC_HEAT,MATERIAL_ENERGY,MIN_THERMODYNAMIC_TEMPERATURE,validThermodynamicTemperature,thermalTransferLimit,specificEnthalpy,mechanicalEnergy,temperatureFromEnergy,conductiveExchange,writeFloat32ThermalEnergy} from './thermodynamics';
import {queueSpecies,carryVelocity,queueEnergyMomentum,commitMomentum} from './conservativeTransport';
import {GASES,thermalEscapeFraction} from './gases';
import {saturationPressure,waterActivity,REFERENCE_PRESSURE} from './waterPhysics';
import {albedo} from './materialPhysics';
import type {SphereGrid} from './sphere';
import {parcelEquilibrium,radiativeFluxes,surfaceSolarDown,PLUME_ENTRAINMENT,statisticalCloud,maximumRandomCloudArea,type RadiationColumn} from './climatePhysics';
import {diagnosticRainMixingRatio,kesslerAccretedFraction,warmAutoFraction,iceAggregation} from './cloudMicrophysics';
import {spectralGasOpticsInto,spectralSourceInto,spectralWeights,spectralCloudOptics,type SpectralGasLayer} from './spectralRadiation';
import {carbonDioxideSaturationPressure,CO2_TRIPLE_PRESSURE,CO2_EXCHANGE_SECONDS,roundedSurfaceStock} from './co2Ice';
import {DUST,DUST_CP,DUST_SHORTWAVE_EXTINCTION,DUST_LONGWAVE_ABSORPTION,DUST_SINGLE_SCATTER_ALBEDO,DUST_ASYMMETRY} from './dustPhysics';
import {assertPlanetSupport,physicalRadius,temperatureLimits,type RadiationModel} from './planetDefinition';

/** SI dynamics, with an explicit conversion from the existing column inventory.
 * Surface inventory is retained; .3 inventory kg represents an Earth 1-atm
 * column. One game second is 60 physical seconds on the 1000-km-radius planet.
 * This is a hydrostatic, finite-volume moist mass-flux model, not a DNS/GCM. */
export const AIR_LAYERS=11;
export const LEGACY_AIR_LAYERS=5;
// Numeric layout avoids a model ↔ climate module initialization cycle.
export const AIR_FIELDS=[9,13,14,15,16,17,27,35,36] as const;
export const AIR_SPECIES=AIR_FIELDS.length;
function spectralColumnScratch(){
 const n=AIR_LAYERS,longwaveBands=Array.from(spectralWeights.longwave,weight=>({weight,opticalDepth:new Float64Array(n),sourceTop:new Float64Array(n),sourceBottom:new Float64Array(n),surfaceSource:0,diffusivity:1.66,cloudMeanAbsorptionDepth:new Float64Array(n)})),shortwaveBands=Array.from(spectralWeights.shortwave,weight=>({weight,absorptionDepth:new Float64Array(n),rayleighDepth:new Float64Array(n),cloudTransportDepth:new Float64Array(n),cloudMeanAbsorptionDepth:new Float64Array(n)}));
 const column={temperature:new Float64Array(n),opticalDepth:new Float64Array(n),cloudTransportDepth:new Float64Array(n),cloudFraction:new Float64Array(n),cloudMeanAbsorptionDepth:new Float64Array(n),cloudOverlap:'maximum-random' as const,longwaveBands,shortwaveBands,surfaceTemperature:0,surfaceAlbedo:0,solar:0};
 return {column,pressure:new Float64Array(n),interfaces:new Float64Array(n+1),interfaceTemperature:new Float64Array(n+1),sources:Array.from({length:n+1},()=>new Float64Array(32)),surface:new Float64Array(32),gas:{longwave:new Float64Array(32),shortwave:new Float64Array(32),rayleigh:new Float64Array(32)},amounts:new Float64Array(8),gasLayer:{pressure:0,temperature:0,dryMoles:0,waterMoles:0,carbonDioxideMoles:0,methaneMoles:0} as SpectralGasLayer};
}
export interface RadiationCacheDiagnostics {
 calls:number;hits:number;rebuilds:number;deferred:number;initial:number;age:number;surfaceTemperature:number;albedo:number;mode:number;
 temperature:number;mass:number;cloud:number;dust:number;soot:number;gas:number[];
}
export const AIR_GAS_INDICES=[0,1,2,3,6,7] as const;
const DRY_GAS_INDICES=[1,2,3,6,7] as const;
export const airMassWidth=(s:LayeredSnapshot)=>s.version>=6?AIR_SPECIES:s.version===5?8:s.version===4?7:6;
export const ATMOSPHERE_MIRRORS=[...AIR_FIELDS,26] as const;
export const AIR_RADIUS=1e6;
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
export function climateSurfaceAlbedo(s:PhysicalState,i:number){
 const p=i*STRIDE,water=-Math.expm1(-Math.max(0,s[p+F.water])*COLUMN_KG/10),ice=-Math.expm1(-Math.max(0,s[p+F.ice])*COLUMN_KG/10);
 const underlying=(1-water)*albedo(s,p)+water*.07;
 const waterIce=(1-ice)*underlying+ice*.6,frost=-Math.expm1(-Math.max(0,s[p+F.carbonDioxideIce])*COLUMN_KG);
 return (1-frost)*waterIce+frost*.65;
}
const cp=AIR_FIELDS.map(f=>SPECIFIC_HEAT[f]);
const latent=AIR_FIELDS.map(f=>MATERIAL_ENERGY[f]);
const molar=[.018015,.028014,.016043,.04401,0,0,.032,.02801,0];
const escapeMolar=AIR_FIELDS.map(field=>GASES.find(g=>g.field===field)?.molarMass??0);
const escapeIndex=AIR_FIELDS.map(field=>GASES.findIndex(g=>g.field===field));
/** Declared solver tolerance, not physics: the band-weighted optical-depth
 * change per layer below which cached radiation coefficients stay in use.
 * Calibrated to the existing 1 K layer-temperature bound, whose flux error
 * 4σT³ΔT ≈ 5 W/m² at 288 K corresponds to Δτ ≈ 5/390 ≈ 0.013; rounded down.
 * A peer of the 1 K, 2% and 300 s reuse bounds; validated against climate
 * soak and radiative-convective statistics rather than bit equality. */
export const RADIATION_OPTICAL_DEPTH_TOLERANCE=.01;
let radiationGasFloorCache:Float64Array|undefined;
/** Absolute per-species drift (mass units of one layer) below which the
 * band-weighted optical-depth change cannot exceed the reuse tolerance.
 * Derived once by differencing the exact gas-optics call a rebuild runs, at
 * three pressure/temperature states, so the floor inherits reference-mole
 * subtraction and the water-vapor continuum instead of restating units.
 * Equal-mass substitution between species of different optical weight still
 * crosses the floor; an optically equivalent one cannot move the solve. */
export function radiationGasMassFloors():Float64Array{
 if(radiationGasFloorCache)return radiationGasFloorCache;
 // AIR_GAS_INDICES order → the SpectralGasLayer lever each species reaches
 // the solve through (fillRadiationColumn): vapor/water, nitrogen/dry,
 // methane, CO2, O2/dry, CO/dry. O2 and CO have no dedicated input; like
 // nitrogen they move dτ only through the dry composite.
 const gasInput=[1,0,3,2,0,0] as const,inputKeys=['dryMoles','waterMoles','carbonDioxideMoles','methaneMoles'] as const,
  states:[number,number][]=[[9e4,288],[9e3,255],[900,230]],
  gas={longwave:new Float64Array(32),shortwave:new Float64Array(32),rayleigh:new Float64Array(32)},
  moved={longwave:new Float64Array(32),shortwave:new Float64Array(32),rayleigh:new Float64Array(32)},amounts=new Float64Array(8);
 const sensitivity=new Float64Array(inputKeys.length);
 for(const [pressure,temperature] of states){
  const layer={pressure,temperature,dryMoles:3e4,waterMoles:300,carbonDioxideMoles:12,methaneMoles:.06,ozone:undefined,n2o:320e-9} as SpectralGasLayer;
  for(let f=0;f<inputKeys.length;f++){
   spectralGasOpticsInto(layer,gas,amounts);
   const key=inputKeys[f],original=layer[key],probe=original*1.01;
   layer[key]=probe;
   spectralGasOpticsInto(layer,moved,amounts);
   layer[key]=original;
   let weighted=0;
   for(let g=0;g<32;g++)weighted+=spectralWeights.longwave[g]*(moved.longwave[g]-gas.longwave[g])+spectralWeights.shortwave[g]*(moved.shortwave[g]-gas.shortwave[g])+spectralWeights.shortwave[g]*(moved.rayleigh[g]-gas.rayleigh[g]);
   sensitivity[f]+=weighted/(probe-original);
  }
 }
 const floors=new Float64Array(AIR_GAS_INDICES.length);
 for(let f=0;f<AIR_GAS_INDICES.length;f++){
  const response=sensitivity[gasInput[f]];
  // A zero-response probe would make the floor +Infinity and silently
  // disable drift invalidation for the cached session; fall back to the
  // pure relative rule instead, which is the conservative pre-change
  // behavior.
  floors[f]=response>0?RADIATION_OPTICAL_DEPTH_TOLERANCE*molar[AIR_GAS_INDICES[f]]*states.length/(response*COLUMN_KG):0;
 }
 radiationGasFloorCache=floors;
 return floors;
}
// Product liquid water occupies the cloud-liquid reservoir in an air layer.
const airReactionField=(f:number)=>AIR_FIELDS.indexOf((f===4?16:f) as typeof AIR_FIELDS[number]);
const gasCombustion=COMBUSTION_REACTIONS.filter(def=>AIR_FIELDS.includes(def.field as typeof AIR_FIELDS[number])).map(def=>{
 const rules=[def.reaction,...('incomplete' in def&&def.incomplete?[def.incomplete]:[]),...('smoky' in def&&def.smoky?[def.smoky]:[])];
 return {def,adapted:new Map(rules.map(rule=>[rule,materialReaction(rule.consumed.map(([f,m])=>[airReactionField(f),m]),rule.produced.map(([f,m])=>[airReactionField(f),m]))]))};
});

const RAD_STRIDE=8+5*AIR_LAYERS;
export interface LayeredSnapshot {version:1|2|3|4|5|6|7|8|9;geometryScale?:number;boundaryImpulse?:number[];gasRadiationCache?:number[];surfaceHeatCarry?:number[];evaporationCarry?:number[];dustMass?:number[];dustRadiationCache?:number[];sootRadiationCache?:number[];dustLiftCarry?:number[];sootLiftCarry?:number[];mass:number[];temperature:number[];velocity:number[];updraft:number[];gravity:number;radiationCache?:number[];radiusMeters?:number;minTemperature?:number;radiationModel?:RadiationModel;}
export interface LayeredCheckpoint {geometryScale:number;boundaryImpulse:Float64Array;gasRadiationCache:Float64Array;surfaceHeatCarry:Float64Array;evaporationCarry:Float64Array;dustMass:Float64Array;dustRadiationCache:Float64Array;sootRadiationCache:Float64Array;dustLiftCarry:Float64Array;sootLiftCarry:Float64Array;mass:Float64Array;temperature:Float64Array;velocity:Float64Array;updraft:Float64Array;roundoff:Float64Array;radiationCache:Float64Array;gravity:number;initialized:boolean;detached:boolean;radiusMeters:number;minTemperature:number;radiationModel:RadiationModel;}
export interface AirEdge {i:number;j:number;distance:number;t:number[];}
/** Explicit prescribed-SST boundary for offline RCE experiments. The caller
 * supplies it every step; external heat is recorded in the command channel. */
export interface PrescribedClimateBoundary {temperature:number;albedo:number;windSpeed?:number;ozone?:'earth'|'rcemip';}
const sum=(a:ArrayLike<number>,p:number,n:number)=>{let s=0;for(let k=0;k<n;k++)s+=a[p+k];return s;};
export function surfaceCapacity(s:PhysicalState,i:number){const p=i*STRIDE;return capacity(s,i)-ATMOSPHERE_MIRRORS.reduce((a,f)=>a+s[p+f]*SPECIFIC_HEAT[f],0);}
export function surfaceEnthalpy(s:PhysicalState,i:number){const p=i*STRIDE;return surfaceCapacity(s,i)*s[p+F.temperature]+phaseEnergy(s,i)-ATMOSPHERE_MIRRORS.reduce((a,f)=>a+s[p+f]*MATERIAL_ENERGY[f],0);}
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
 const stock=(v:unknown,len:number)=>Array.isArray(v)&&v.length===len&&v.every(validInventoryAmount);
 const kinetic=()=>a.temperature.every((_,q)=>{const v=q*3,speed2=a.velocity[v]**2+a.velocity[v+1]**2+a.velocity[v+2]**2,mass=sum(a.mass,q*airMassWidth(a),airMassWidth(a))+(a.dustMass?.[q]??0);return Number.isFinite(speed2)&&Number.isFinite(mass*speed2/2000);});
 const metadata=a.version>=9?Number.isFinite(a.geometryScale)&&a.geometryScale!>0&&a.geometryScale!<=1&&arr(a.boundaryImpulse,3,-Infinity,Infinity)&&stock(a.gasRadiationCache,n*AIR_GAS_INDICES.length):a.geometryScale===undefined&&a.boundaryImpulse===undefined&&a.gasRadiationCache===undefined;
 const dustValid=a.version>=3?stock(a.dustMass,n)&&stock(a.dustRadiationCache,n)&&stock(a.dustLiftCarry,count):a.dustMass===undefined&&a.dustRadiationCache===undefined&&a.dustLiftCarry===undefined;
 return metadata&&(a.version>=8?arr(a.surfaceHeatCarry,count,-Infinity,Infinity):a.surfaceHeatCarry===undefined||arr(a.surfaceHeatCarry,count,0,0))&&(a.version>=7?stock(a.evaporationCarry,count):a.evaporationCarry===undefined||arr(a.evaporationCarry,count,0,0))&&(a.version>=6?stock(a.sootRadiationCache,n):a.sootRadiationCache===undefined||arr(a.sootRadiationCache,n,0,0))&&(a.version>=6?stock(a.sootLiftCarry,count):a.sootLiftCarry===undefined||arr(a.sootLiftCarry,count,0,0))&&dustValid&&[1,2,3,4,5,6,7,8,9].includes(a.version)&&Number.isFinite(a.gravity)&&a.gravity>=.01&&a.gravity<=3&&(a.radiusMeters===undefined||Number.isFinite(a.radiusMeters)&&a.radiusMeters>=1e3&&a.radiusMeters<=2e8)&&(a.minTemperature===undefined||[-150,-220].includes(a.minTemperature))&&(a.radiationModel===undefined||['earth-spectral','thin-co2-grey'].includes(a.radiationModel))&&stock(a.mass,n*airMassWidth(a))&&arr(a.temperature,n,Math.fround(MIN_THERMODYNAMIC_TEMPERATURE),Infinity)&&a.temperature.every(validThermodynamicTemperature)&&arr(a.velocity,n*3,-Infinity,Infinity)&&kinetic()&&arr(a.updraft,count*((a.version===1?LEGACY_AIR_LAYERS:AIR_LAYERS)-1),0,Infinity)&&a.updraft.every(v=>Number.isFinite(v*v))&&(a.radiationCache===undefined||a.version!==1&&arr(a.radiationCache,count*RAD_STRIDE,-Infinity,Infinity));
}

export class LayeredAtmosphere {
 /** Physical surface heat below Float32 temperature resolution (kJ).
  * It stays with the fixed surface reservoir and is included in energy/saves. */
 readonly surfaceHeatCarry:Float64Array;
 /** Signed low bits of each public surface material projection. */
 readonly surfaceMassCarry:Float64Array;
 private surfaceMassMirror?:Float32Array;
 /** Impulse delivered to the fixed surface when no resolved liquid
  * mechanics adapter is installed. The bed/frame does no mechanical work. */
 readonly boundaryImpulse=new Float64Array(3);
 readonly dustMass:Float64Array;
 /** Absorbed SW during this advance, already included in total energy. Ephemeral. */
 readonly absorbedSolar:Float64Array;
 readonly mass:Float64Array;readonly temperature:Float64Array;readonly velocity:Float64Array;readonly updraft:Float64Array;
 private evaporationCarry:Float64Array;private roundoff:Float64Array;private dustDelta:Float64Array;private dustRadiationCache:Float64Array;private sootRadiationCache:Float64Array;private dustLiftCarry:Float64Array;private sootLiftCarry:Float64Array;
 private initialized=false;private detached=false;private gravity=1;private mechanics?:LocalMechanics;
 radiusMeters=AIR_RADIUS;
 /** Initial finite-volume mesh scale. A legacy reservoir may lack the heat
  * needed to populate the standard heights; its smaller mesh remains fixed
  * during evolution and is part of the saved physical state. */
 geometryScale=1;
 // Retained snapshot hint for initial profiles and surface boundary choices.
 // Evolved air uses the common positive-Kelvin enthalpy domain instead.
 private minTemperature=-150;private radiationModel:RadiationModel='earth-spectral';
 // Reused local rollback buffers for finite surface/air boundary admission.
 private boundarySurface=new Float64Array(STRIDE);
 private boundaryMass=new Float64Array(AIR_LAYERS*AIR_SPECIES);
 private boundaryDust=new Float64Array(AIR_LAYERS);
 private boundaryTemperature=new Float64Array(AIR_LAYERS);
 private boundaryVelocity=new Float64Array(AIR_LAYERS*3);
 private fluxMass:Float64Array;private fluxCapacity:Float64Array;private fluxEnergy:Float64Array;private delta:Float64Array;private heat:Float64Array;private relativeHeat:Float64Array;private mixingEnergy:Float64Array;private incomingMass:Float64Array;private incomingVelocity:Float64Array;private outgoingMass:Float64Array;private momentum:Float64Array;private out:Float64Array;
 private spectralScratch=spectralColumnScratch();
 private radiationCounters?:RadiationCacheDiagnostics;
 /** Opt-in inspector counters. Reasons are non-exclusive per column call;
  * enabling them never changes the physical cache or serialized state. */
 setRadiationDiagnostics(enabled=true){this.radiationCounters=enabled?{calls:0,hits:0,rebuilds:0,deferred:0,initial:0,age:0,surfaceTemperature:0,albedo:0,mode:0,temperature:0,mass:0,cloud:0,dust:0,soot:0,gas:AIR_GAS_INDICES.map(()=>0)}:undefined;}
 radiationDiagnostics(){const c=this.radiationCounters;return c?{...c,gas:[...c.gas]}:undefined;}
 private countRadiation(s:PhysicalState,i:number,albedo:number,mode:number,update:boolean,deferred:boolean){
  const d=this.radiationCounters!;d.calls++;if(update)d.rebuilds++;else if(deferred)d.deferred++;else d.hits++;
  const r=i*RAD_STRIDE,c=this.radiationCache;
  if(c[r]<0){d.initial++;return;}if(c[r]>=300)d.age++;if(Math.abs(c[r+5]-this.surfaceTemperature(s,i))>1)d.surfaceTemperature++;if(Math.abs(c[r+6]-albedo)>.01)d.albedo++;if(c[r+7]!==mode)d.mode++;
  let temperature=false,mass=false,cloud=false,dust=false,soot=false;
  for(let k=0;k<AIR_LAYERS;k++){
   const q=i*AIR_LAYERS+k,a=r+8+k*5,m=this.layerMass(q),water=(this.mass[q*AIR_SPECIES+4]+this.mass[q*AIR_SPECIES+5])*COLUMN_KG;
   temperature ||= Math.abs(c[a]-this.temperature[q])>1;mass ||= Math.abs(m-c[a+1])>.02*Math.max(1e-15,m);cloud ||= Math.abs(water-c[a+2])>.01;
   dust ||= Math.abs(this.dustMass[q]-this.dustRadiationCache[q])>Math.max(1e-15,.01*this.dustMass[q]);soot ||= Math.abs(this.mass[q*AIR_SPECIES+8]-this.sootRadiationCache[q])>Math.max(1e-15,.01*this.mass[q*AIR_SPECIES+8]);
  }
  if(temperature)d.temperature++;if(mass)d.mass++;if(cloud)d.cloud++;if(dust)d.dust++;if(soot)d.soot++;
  const floors=radiationGasMassFloors();
  for(let f=0;f<AIR_GAS_INDICES.length;f++)for(let k=0;k<AIR_LAYERS;k++){const q=i*AIR_LAYERS+k,m=this.mass[q*AIR_SPECIES+AIR_GAS_INDICES[f]],old=this.gasRadiationCache[q*AIR_GAS_INDICES.length+f];if(Math.abs(m-old)>Math.max(.01*Math.max(m,old),floors[f])){d.gas[f]++;break;}}
 }
 private gradients:Float64Array;private radiationCache:Float64Array;private gasRadiationCache:Float64Array;
 private acceleration:Float64Array;private rt:Float64Array;private virtualTemperature:Float64Array;private logPressure:Float64Array;private edgeSpeeds:Float64Array;private carried:Float64Array;
 constructor(readonly grid:SphereGrid,private edges:AirEdge[],private maxStepSeconds=1){if(!Number.isFinite(maxStepSeconds)||maxStepSeconds<=0||maxStepSeconds>60)throw new Error("대기 적분 간격은 0–60초 범위여야 합니다.");const n=grid.count*AIR_LAYERS;this.surfaceHeatCarry=new Float64Array(grid.count);this.surfaceMassCarry=new Float64Array(grid.count*STRIDE);this.evaporationCarry=new Float64Array(grid.count);this.absorbedSolar=new Float64Array(grid.count);this.dustMass=new Float64Array(n);this.dustDelta=new Float64Array(n);this.dustRadiationCache=new Float64Array(n);this.sootRadiationCache=new Float64Array(n);this.dustLiftCarry=new Float64Array(grid.count);this.sootLiftCarry=new Float64Array(grid.count);this.roundoff=new Float64Array(grid.count);this.mass=new Float64Array(n*AIR_SPECIES);this.temperature=new Float64Array(n);this.velocity=new Float64Array(n*3);this.updraft=new Float64Array(grid.count*(AIR_LAYERS-1));this.fluxMass=new Float64Array(n);this.fluxCapacity=new Float64Array(n);this.fluxEnergy=new Float64Array(n);this.delta=new Float64Array(n*AIR_SPECIES);this.heat=new Float64Array(n);this.relativeHeat=new Float64Array(n);this.mixingEnergy=new Float64Array(n);this.incomingMass=new Float64Array(n);this.incomingVelocity=new Float64Array(n*3);this.outgoingMass=new Float64Array(n);this.momentum=new Float64Array(n*3);this.out=new Float64Array(n);this.acceleration=new Float64Array(n*3);this.rt=new Float64Array(n);this.virtualTemperature=new Float64Array(n);this.logPressure=new Float64Array(n);this.edgeSpeeds=new Float64Array(edges.length*AIR_LAYERS);this.carried=new Float64Array(3);this.gradients=this.gradientGeometry();this.gasRadiationCache=new Float64Array(n*AIR_GAS_INDICES.length);this.radiationCache=new Float64Array(grid.count*RAD_STRIDE);for(let i=0;i<grid.count;i++)this.radiationCache[i*RAD_STRIDE]=-1;}
 /** Consistent tangent least-squares gradient, including the 12 pentagons.
  * A fixed division by 3 biases irregular neighbor fans as resolution grows. */
 private gradientGeometry(){
  const n=this.grid.count,u=new Float64Array(n*3),v=new Float64Array(n*3),matrix=new Float64Array(n*3),components=new Float64Array(this.edges.length*4),result=new Float64Array(this.edges.length*6);
  for(let i=0;i<n;i++){const p=i*3,[x,y,z]=this.grid.directions.subarray(p,p+3),axis=Math.abs(z)<.9?[0,0,1]:[1,0,0],cross=[y*axis[2]-z*axis[1],z*axis[0]-x*axis[2],x*axis[1]-y*axis[0]],l=Math.hypot(...cross);for(let k=0;k<3;k++)u[p+k]=cross[k]/l;v.set([y*u[p+2]-z*u[p+1],z*u[p]-x*u[p+2],x*u[p+1]-y*u[p]],p);}
  this.edges.forEach(({i,j,t},index)=>{for(const [cell,offset] of [[i,0],[j,2]]){const p=cell*3,x=t.reduce((s,a,k)=>s+a*u[p+k],0),y=t.reduce((s,a,k)=>s+a*v[p+k],0),l=Math.hypot(x,y),a=x/l,b=y/l;components[index*4+offset]=a;components[index*4+offset+1]=b;matrix[p]+=a*a;matrix[p+1]+=a*b;matrix[p+2]+=b*b;}});
  this.edges.forEach(({i,j},index)=>{for(const [cell,offset,target] of [[i,0,0],[j,2,3]]){const p=cell*3,a=components[index*4+offset],b=components[index*4+offset+1],det=matrix[p]*matrix[p+2]-matrix[p+1]**2,x=(matrix[p+2]*a-matrix[p+1]*b)/det,y=(matrix[p]*b-matrix[p+1]*a)/det;for(let k=0;k<3;k++)result[index*6+target+k]=x*u[p+k]+y*v[p+k];}});return result;
 }
 snapshot():LayeredSnapshot|undefined{return this.initialized?{version:9,geometryScale:this.geometryScale,boundaryImpulse:[...this.boundaryImpulse],gasRadiationCache:[...this.gasRadiationCache],surfaceHeatCarry:[...this.surfaceHeatCarry],evaporationCarry:[...this.evaporationCarry],dustMass:[...this.dustMass],dustRadiationCache:[...this.dustRadiationCache],sootRadiationCache:[...this.sootRadiationCache],dustLiftCarry:[...this.dustLiftCarry],sootLiftCarry:[...this.sootLiftCarry],mass:[...this.mass],temperature:[...this.temperature],velocity:[...this.velocity],updraft:[...this.updraft],gravity:this.gravity,radiationCache:[...this.radiationCache],radiusMeters:this.radiusMeters,minTemperature:this.minTemperature,radiationModel:this.radiationModel}:undefined;}
 /** Typed rollback state avoids serializing the entire atmosphere on every tick. */
 checkpoint():LayeredCheckpoint{return {geometryScale:this.geometryScale,boundaryImpulse:this.boundaryImpulse.slice(),gasRadiationCache:this.gasRadiationCache.slice(),surfaceHeatCarry:this.surfaceHeatCarry.slice(),evaporationCarry:this.evaporationCarry.slice(),dustMass:this.dustMass.slice(),dustRadiationCache:this.dustRadiationCache.slice(),sootRadiationCache:this.sootRadiationCache.slice(),dustLiftCarry:this.dustLiftCarry.slice(),sootLiftCarry:this.sootLiftCarry.slice(),mass:this.mass.slice(),temperature:this.temperature.slice(),velocity:this.velocity.slice(),updraft:this.updraft.slice(),roundoff:this.roundoff.slice(),radiationCache:this.radiationCache.slice(),gravity:this.gravity,initialized:this.initialized,detached:this.detached,radiusMeters:this.radiusMeters,minTemperature:this.minTemperature,radiationModel:this.radiationModel};}
 restoreCheckpoint(c:LayeredCheckpoint){this.geometryScale=c.geometryScale;this.boundaryImpulse.set(c.boundaryImpulse);this.gasRadiationCache.set(c.gasRadiationCache);this.surfaceHeatCarry.set(c.surfaceHeatCarry);this.evaporationCarry.set(c.evaporationCarry);this.dustMass.set(c.dustMass);this.dustRadiationCache.set(c.dustRadiationCache);this.sootRadiationCache.set(c.sootRadiationCache);this.dustLiftCarry.set(c.dustLiftCarry);this.sootLiftCarry.set(c.sootLiftCarry);this.mass.set(c.mass);this.temperature.set(c.temperature);this.velocity.set(c.velocity);this.updraft.set(c.updraft);this.roundoff.set(c.roundoff);this.radiationCache.set(c.radiationCache);this.gravity=c.gravity;this.initialized=c.initialized;this.detached=c.detached;this.radiusMeters=c.radiusMeters;this.minTemperature=c.minTemperature;this.radiationModel=c.radiationModel;}
 restore(s?:LayeredSnapshot){this.geometryScale=s?.geometryScale??1;this.boundaryImpulse.fill(0);if(s?.boundaryImpulse)this.boundaryImpulse.set(s.boundaryImpulse);this.gasRadiationCache.fill(0);if(s?.gasRadiationCache)this.gasRadiationCache.set(s.gasRadiationCache);this.surfaceHeatCarry.fill(0);if(s&&s.version>=8)this.surfaceHeatCarry.set(s.surfaceHeatCarry!);this.evaporationCarry.fill(0);if(s&&s.version>=7)this.evaporationCarry.set(s.evaporationCarry!);this.initialized=!!s;this.detached=false;this.dustMass.fill(0);this.dustRadiationCache.fill(0);this.sootRadiationCache.fill(0);this.dustLiftCarry.fill(0);this.sootLiftCarry.fill(0);this.mass.fill(0);this.temperature.fill(0);this.velocity.fill(0);this.updraft.fill(0);this.roundoff.fill(0);this.radiationCache.fill(0);for(let i=0;i<this.grid.count;i++)this.radiationCache[i*RAD_STRIDE]=-1;this.gravity=s?.gravity??1;if(s){
   const layers=s.version===1?LEGACY_AIR_LAYERS:AIR_LAYERS,width=airMassWidth(s);
   if(s.version>=6){this.sootLiftCarry.set(s.sootLiftCarry!);this.sootRadiationCache.set(s.sootRadiationCache!);}
   if(s.version>=3){this.dustMass.set(s.dustMass!);this.dustRadiationCache.set(s.dustRadiationCache!);this.dustLiftCarry.set(s.dustLiftCarry!);}
   for(let i=0;i<this.grid.count;i++){
    for(let k=0;k<layers;k++)this.mass.set(s.mass.slice((i*layers+k)*width,(i*layers+k+1)*width),(i*AIR_LAYERS+k)*AIR_SPECIES);
    this.temperature.set(s.temperature.slice(i*layers,(i+1)*layers),i*AIR_LAYERS);
    this.velocity.set(s.velocity.slice(i*layers*3,(i+1)*layers*3),i*AIR_LAYERS*3);
    this.updraft.set(s.updraft.slice(i*(layers-1),(i+1)*(layers-1)),i*(AIR_LAYERS-1));
   }
   if(s.version>=6&&s.radiationCache&&s.gasRadiationCache)this.radiationCache.set(s.radiationCache);
  }this.radiusMeters=s?.radiusMeters??AIR_RADIUS;this.minTemperature=s?.minTemperature??-150;this.radiationModel=s?.radiationModel??'earth-spectral';}
 setMechanics(mechanics:LocalMechanics){this.mechanics=mechanics;}
 /** A public edit replaces that field's inventory, while an unchanged
  * projection keeps its low bits. Float64 working states already contain them. */
 surfaceStock(s:PhysicalState,index:number){return s[index]+(s instanceof Float32Array&&(!this.surfaceMassMirror||this.surfaceMassMirror[index]===s[index])?this.surfaceMassCarry[index]:0);}
 /** A remembered public edit must reconcile rather than inherit old residuals.
  * Restored snapshots have no mirror; as in surfaceStock(), their supplied
  * projection and carries form the authoritative pair until first publication. */
 surfaceProjectionUnchanged(s:Float32Array){const mirror=this.surfaceMassMirror;if(!mirror)return true;if(mirror.length!==s.length)return false;for(let i=0;i<s.length;i++)if(!Object.is(mirror[i],s[i]))return false;return true;}
 forgetSurfaceProjection(){this.surfaceMassMirror=undefined;}
 rememberSurfaceProjection(s:Float32Array){this.surfaceMassMirror=s.slice();}
 physicalSurface(s:PhysicalState){const actual=new Float64Array(s);if(s instanceof Float32Array)for(let p=0;p<s.length;p+=STRIDE)for(const f of MASS_FIELDS)actual[p+f]=this.surfaceStock(s,p+f);return actual;}
 publishSurface(actual:PhysicalState){
  for(let p=0;p<actual.length;p+=STRIDE)for(const f of MASS_FIELDS)assertInventoryAmount(actual[p+f]);
  const projected=new Float32Array(actual);this.surfaceMassCarry.fill(0);
  for(let p=0;p<actual.length;p+=STRIDE)for(const f of MASS_FIELDS)if(!this.ready||!(ATMOSPHERE_MIRRORS as readonly number[]).includes(f))this.surfaceMassCarry[p+f]=actual[p+f]-projected[p+f];
  this.rememberSurfaceProjection(projected);
  for(let i=0;i<this.grid.count;i++)this.setSurfaceEnergy(projected,i,this.surfaceEnergy(actual,i));
  return projected;
 }
 /** Surface energy always excludes aggregate atmosphere mirrors. */
 surfaceCapacity(s:PhysicalState,i:number){const p=i*STRIDE;let c=BASE_CAPACITY;for(let f=0;f<SPECIFIC_HEAT.length;f++)if(!this.initialized||!(ATMOSPHERE_MIRRORS as readonly number[]).includes(f))c+=this.surfaceStock(s,p+f)*SPECIFIC_HEAT[f];return c;}
 surfacePhaseEnergy(s:PhysicalState,i:number){const p=i*STRIDE;let h=s[p+F.photonEnergy];for(const f of MASS_FIELDS)if(!this.initialized||!(ATMOSPHERE_MIRRORS as readonly number[]).includes(f))h+=this.surfaceStock(s,p+f)*MATERIAL_ENERGY[f];return h;}
 surfaceEnergy(s:PhysicalState,i:number){return this.surfaceCapacity(s,i)*s[i*STRIDE+F.temperature]+this.surfacePhaseEnergy(s,i)+this.surfaceHeatCarry[i];}
 surfaceTemperature(s:PhysicalState,i:number){return s[i*STRIDE+F.temperature]+this.surfaceHeatCarry[i]/this.surfaceCapacity(s,i);}
 setSurfaceEnergy(s:PhysicalState,i:number,target:number){
  this.surfaceHeatCarry[i]=writeFloat32ThermalEnergy(s,i*STRIDE+F.temperature,target,this.surfaceCapacity(s,i),this.surfacePhaseEnergy(s,i));
 }
 addSurfaceHeat(s:PhysicalState,i:number,heat:number){this.setSurfaceEnergy(s,i,this.surfaceEnergy(s,i)+heat);}
 /** Phase allocation owns the same complete thermal + mechanical budget. */
 equilibrateSurfaceWater(s:PhysicalState,i:number){
  if(s instanceof Float32Array){const actual=this.physicalSurface(s);this.equilibrateSurfaceWater(actual,i);s.set(this.publishSurface(actual));return;}
  const p=i*STRIDE;if(s[p+F.water]+s[p+F.ice]===0&&s[p+F.dissolved]===0)return;
  const saved=ATMOSPHERE_MIRRORS.map(f=>s[p+f]);
  for(const f of ATMOSPHERE_MIRRORS)s[p+f]=0;
  equilibrateWater(s,i,this.mechanics,this);
  ATMOSPHERE_MIRRORS.forEach((f,k)=>s[p+f]=saved[k]);
 }
 get ready(){return this.initialized;}
 height(k:number){return AIR_Z[k]*this.geometryScale/this.gravity;}
 thickness(k:number){return AIR_DZ[k]*this.geometryScale/this.gravity;}
 layerMass(q:number){return sum(this.mass,q*AIR_SPECIES,AIR_SPECIES)+this.dustMass[q];}
 layerCapacity(q:number){let c=this.dustMass[q]*DUST_CP;for(let f=0;f<AIR_SPECIES;f++)c+=this.mass[q*AIR_SPECIES+f]*cp[f];return c;}
 layerEnergy(q:number,mass=this.layerMass(q),capacity=this.layerCapacity(q)){let h=capacity*this.temperature[q];for(let f=0;f<AIR_SPECIES;f++)h+=this.mass[q*AIR_SPECIES+f]*latent[f];return h+mechanicalEnergy(mass,9.81*this.gravity,this.height(q%AIR_LAYERS),this.speed2(q));}
 private speed2(q:number){const v=q*3;return this.velocity[v]**2+this.velocity[v+1]**2+this.velocity[v+2]**2;}
 /** Interface impulse changes kinetic energy; only dissipative heat changes internal energy. */
 exchangeMomentum(q:number,impulse:readonly number[],heat:number){const m=this.layerMass(q);if(m<=1e-18)return;for(let k=0;k<3;k++)this.velocity[q*3+k]+=impulse[k]/m;const c=this.layerCapacity(q);if(c>1e-18)this.temperature[q]+=heat/c;}
 private setEnergy(q:number,h:number,mass=this.layerMass(q)){const c=this.layerCapacity(q);if(c<=1e-18){this.temperature[q]=0;this.velocity.fill(0,q*3,q*3+3);return;}let phase=0;for(let f=0;f<AIR_SPECIES;f++)phase+=this.mass[q*AIR_SPECIES+f]*latent[f];this.temperature[q]=temperatureFromEnergy(h,c,phase,mechanicalEnergy(mass,9.81*this.gravity,this.height(q%AIR_LAYERS),this.speed2(q)));}
 totalEnergy(){let h=0;for(let q=0;q<this.temperature.length;q++)h+=this.layerEnergy(q);return h;}
 columnEnergy(i:number){let h=0;for(let k=0;k<AIR_LAYERS;k++)h+=this.layerEnergy(i*AIR_LAYERS+k);return h;}
 /** Relative to the old aggregate-at-surface-temperature diagnostic. */
 energyOffset(s:PhysicalState,i:number){const p=i*STRIDE;return this.columnEnergy(i)+this.surfaceHeatCarry[i]-ATMOSPHERE_MIRRORS.reduce((a,f)=>a+s[p+f]*(SPECIFIC_HEAT[f]*s[p+F.temperature]+MATERIAL_ENERGY[f]),0);}
 initialize(s:PhysicalState,e:Environment,legacyWind?:Float32Array){
  if(s instanceof Float32Array){const actual=this.physicalSurface(s);this.initialize(actual,e,legacyWind);s.set(this.publishSurface(actual));return;}
  const initial=this.initialized?undefined:this.checkpoint();
  assertPlanetSupport(e.body);this.radiusMeters=physicalRadius(e.body);this.minTemperature=temperatureLimits(e.body).airMin;
  const model=e.body?.atmosphere.radiation??'earth-spectral';if(model!==this.radiationModel){for(let i=0;i<this.grid.count;i++)this.radiationCache[i*RAD_STRIDE]=-1;this.radiationModel=model;}
  if(this.initialized)return;
  try{
  this.initialized=true;this.gravity=e.gravity??1;this.geometryScale=1;
  const oldEnergy=new Float64Array(this.grid.count),totalCapacity=new Float64Array(this.grid.count),minimum=Math.fround(MIN_THERMODYNAMIC_TEMPERATURE);
  let standardProfileFits=true;
  for(let i=0;i<this.grid.count;i++){
   const p=i*STRIDE,old=enthalpy(s,i)+this.surfaceHeatCarry[i],t=s[p+F.temperature];
   oldEnergy[i]=old;totalCapacity[i]=capacity(s,i);
   let total=0,gasMass=0,moles=0;for(const f of AIR_GAS_INDICES){gasMass+=s[p+AIR_FIELDS[f]];moles+=s[p+AIR_FIELDS[f]]/molar[f];}
   const mars=this.radiationModel==='thin-co2-grey',gasR=mars&&gasMass>0?8.314462618*moles/gasMass:287;
   const weights=AIR_Z.map((z,k)=>{const low=z-AIR_DZ[k]/2,high=z+AIR_DZ[k]/2,w=Math.exp(-9.81*low/(gasR*Math.max(mars?53.15:173.15,t+273.15)))-Math.exp(-9.81*high/(gasR*Math.max(mars?53.15:173.15,t+273.15)));total+=w;return w;});
   for(let k=0;k<AIR_LAYERS;k++){const q=i*AIR_LAYERS+k;this.temperature[q]=Math.max(this.minTemperature,mars?t-.004*Math.min(11000,AIR_Z[k]):t-.0065*Math.min(11000,AIR_Z[k])+.001*Math.max(0,AIR_Z[k]-20000));for(let f=0;f<AIR_SPECIES;f++)this.mass[q*AIR_SPECIES+f]=s[p+AIR_FIELDS[f]]*weights[k]/total;this.dustMass[q]=s[p+F.airborneDust]*weights[k]/total;if(legacyWind)for(let v=0;v<3;v++)this.velocity[q*3+v]=legacyWind[i*3+v]*this.radiusMeters/AIR_SECONDS;}
   const surfaceTemperature=(old-this.columnEnergy(i)-this.surfacePhaseEnergy(s,i))/this.surfaceCapacity(s,i);
   standardProfileFits&&=validThermodynamicTemperature(surfaceTemperature);
  }
  if(!standardProfileFits){
   // Select an initial mesh from the actual finite sensible-energy budget.
   // At most half the heat above the common admissibility boundary is spent
   // on gravitational placement; this is a geometry choice, not added heat.
   // All columns share one mesh, so horizontal faces and layer heights agree.
   for(let i=0;i<this.grid.count;i++){
    let mass=0,kinetic=0;for(let k=0;k<AIR_LAYERS;k++){const q=i*AIR_LAYERS+k,m=this.layerMass(q);mass+=m;kinetic+=m*this.speed2(q)/2000;}
    if(mass===0)continue;
    const sensible=totalCapacity[i]*(s[i*STRIDE+F.temperature]-minimum)+this.surfaceHeatCarry[i],remaining=sensible-kinetic;
    if(!(remaining>0))throw new Error('기존 대기를 높이에 배치할 열에너지 재고가 없습니다.');
    this.geometryScale=Math.min(this.geometryScale,remaining/(2*mass*9.81*AIR_Z[AIR_LAYERS-1]/1000));
   }
   for(let i=0;i<this.grid.count;i++){
    const p=i*STRIDE,t=s[p+F.temperature],mars=this.radiationModel==='thin-co2-grey';
    let gasMass=0,moles=0;for(const f of AIR_GAS_INDICES){gasMass+=s[p+AIR_FIELDS[f]];moles+=s[p+AIR_FIELDS[f]]/molar[f];}
    const gasR=mars&&gasMass>0?8.314462618*moles/gasMass:287,scaleHeight=gasR*(t+273.15)/9.81;
    // expm1 retains the finite layer fractions even on a very shallow mesh.
    const weights=AIR_Z.map((z,k)=>Math.exp(-(z-AIR_DZ[k]/2)*this.geometryScale/scaleHeight)*-Math.expm1(-AIR_DZ[k]*this.geometryScale/scaleHeight)),total=weights.reduce((a,b)=>a+b,0);
    let work=0;for(let k=0;k<AIR_LAYERS;k++){
     const q=i*AIR_LAYERS+k;for(let f=0;f<AIR_SPECIES;f++)this.mass[q*AIR_SPECIES+f]=s[p+AIR_FIELDS[f]]*weights[k]/total;this.dustMass[q]=s[p+F.airborneDust]*weights[k]/total;
     work+=mechanicalEnergy(this.layerMass(q),9.81*this.gravity,this.height(k),this.speed2(q));
    }
    // The cold fallback starts isothermal. Both retained surface and air pay
    // the placement work from their old shared heat; no profile floor applies.
    const temperature=t+(this.surfaceHeatCarry[i]-work)/totalCapacity[i];
    if(!validThermodynamicTemperature(temperature))throw new Error('기존 대기의 초기 에너지 재고가 유효하지 않습니다.');
    for(let k=0;k<AIR_LAYERS;k++)this.temperature[i*AIR_LAYERS+k]=temperature;
   }
  }
  for(let i=0;i<this.grid.count;i++){
   // Opening the old shared reservoir is an internal transfer, including
   // potential and migrated kinetic energy, with no correction channel.
   this.setSurfaceEnergy(s,i,oldEnergy[i]-this.columnEnergy(i));
  }
  this.initialized=true;
  }catch(error){this.restoreCheckpoint(initial!);throw error;}
 }
 /** Remove aggregate mirrors before the surface CPU/WGSL kernel, so its heat
  * capacity, conduction and phase equilibrium contain surface matter only. */
 detach(s:PhysicalState,e:Environment,legacyWind?:Float32Array){this.initialize(s,e,legacyWind);if(this.detached)return;this.reconcile(s);this.reconcileDust(s);for(let i=0;i<this.grid.count;i++)for(const f of ATMOSPHERE_MIRRORS)s[i*STRIDE+f]=0;this.detached=true;}
 attach(s:PhysicalState){for(const amount of this.mass)assertInventoryAmount(amount);for(const amount of this.dustMass)assertInventoryAmount(amount);for(let i=0;i<this.grid.count;i++)for(let f=0;f<AIR_SPECIES;f++){let m=0;for(let k=0;k<AIR_LAYERS;k++)m+=this.mass[(i*AIR_LAYERS+k)*AIR_SPECIES+f];assertInventoryAmount(m);s[i*STRIDE+AIR_FIELDS[f]]=m;}for(let i=0;i<this.grid.count;i++){let dust=0;for(let k=0;k<AIR_LAYERS;k++)dust+=this.dustMass[i*AIR_LAYERS+k];assertInventoryAmount(dust);s[i*STRIDE+F.airborneDust]=dust;}this.detached=false;}
 /** Import an edited/save-time aggregate. Existing layer shape and temperature
  * survive; additions enter the boundary layer at the supply temperature. */
 reconcile(s:PhysicalState,only?:number,sourceTemperature=20){if(!this.initialized||this.detached)return;for(let i=only??0;i<(only===undefined?this.grid.count:only+1);i++)for(let f=0;f<AIR_SPECIES;f++){let old=0;for(let k=0;k<AIR_LAYERS;k++)old+=this.mass[(i*AIR_LAYERS+k)*AIR_SPECIES+f];const desired=s[i*STRIDE+AIR_FIELDS[f]],difference=desired-old;if(Math.abs(difference)<=Math.max(1e-12,old*2e-7))continue;if(difference>0){const q=i*AIR_LAYERS,h=this.layerEnergy(q);this.mass[q*AIR_SPECIES+f]+=difference;this.setEnergy(q,h+difference*(cp[f]*sourceTemperature+latent[f]+9.81*this.gravity*this.height(0)/1000));}else for(let k=0;k<AIR_LAYERS;k++)this.mass[(i*AIR_LAYERS+k)*AIR_SPECIES+f]*=desired/Math.max(1e-30,old);}}
 private reconcileDust(s:PhysicalState){
  if(!this.initialized||this.detached)return;
  for(let i=0;i<this.grid.count;i++){
   let old=0;for(let k=0;k<AIR_LAYERS;k++)old+=this.dustMass[i*AIR_LAYERS+k];
   const desired=s[i*STRIDE+F.airborneDust],difference=desired-old;if(Math.abs(difference)<=Math.max(1e-12,old*2e-7))continue;
   if(difference>0){const q=i*AIR_LAYERS,h=this.layerEnergy(q);this.dustMass[q]+=difference;this.setEnergy(q,h+difference*(DUST_CP*20+9.81*this.gravity*this.height(0)/1000));}
   else for(let k=0;k<AIR_LAYERS;k++)this.dustMass[i*AIR_LAYERS+k]*=desired/Math.max(1e-30,old);
  }
 }
 supplies(s:PhysicalState,commands:PhysicalState,stride:number,energy:Float32Array){
  for(let i=0;i<this.grid.count;i++){
   const p=i*STRIDE,q=i*AIR_LAYERS,c=i*stride,erase=commands[c+7]>0?0:Math.max(0,Math.min(1,commands[c+5]));
   this.evaporationCarry[i]*=1-Math.max(0,Math.min(1,commands[c+5]));
   if(erase){const before=this.columnEnergy(i);for(let k=0;k<AIR_LAYERS;k++){for(let f=0;f<AIR_SPECIES;f++)this.mass[(q+k)*AIR_SPECIES+f]*=1-erase;this.dustMass[q+k]*=1-erase;}energy[i*4+1]+=this.columnEnergy(i)-before;}
   let moved=0,h=enthalpy(s,i)+this.surfaceHeatCarry[i];
   for(let f=0;f<AIR_SPECIES;f++){const amount=s[p+AIR_FIELDS[f]];if(amount<=0)continue;const old=this.layerEnergy(q);this.mass[q*AIR_SPECIES+f]+=amount;const airHeat=amount*(cp[f]*20+latent[f]+9.81*this.gravity*this.height(0)/1000);this.setEnergy(q,old+airHeat);moved+=amount*(cp[f]*20+latent[f]);s[p+AIR_FIELDS[f]]=0;energy[i*4+1]+=amount*9.81*this.gravity*this.height(0)/1000;}
   this.setSurfaceEnergy(s,i,h-moved);
  }
 }
 pressure(i:number,k:number){let above=0;for(let l=k+1;l<AIR_LAYERS;l++)above+=this.layerMass(i*AIR_LAYERS+l);return Math.max(.01,(above+this.layerMass(i*AIR_LAYERS+k)*.5)*COLUMN_KG*9.81*this.gravity);}
 private dry(q:number){let mass=0,moles=0;for(const f of DRY_GAS_INDICES){mass+=this.mass[q*AIR_SPECIES+f];moles+=this.mass[q*AIR_SPECIES+f]/molar[f];}return {mass,moles};}
 private gasConstant(q:number){let mass=0,moles=0;for(const f of AIR_GAS_INDICES){mass+=this.mass[q*AIR_SPECIES+f];moles+=this.mass[q*AIR_SPECIES+f]/molar[f];}return mass>0?8.314462618*moles/mass:287;}
 private virtual(q:number,t=this.temperature[q]){const m=this.layerMass(q),gas=AIR_GAS_INDICES.reduce<number>((m,f)=>m+this.mass[q*AIR_SPECIES+f],0);return (t+273.15)*this.gasConstant(q)/287*gas/Math.max(1e-30,m);}
 conditions(s:PhysicalState,i:number){
  if(!this.initialized)return {temperature:s[i*STRIDE+F.temperature],humidity:0,pressure:0,saturation:0,excess:0,lift:0,height:0,layer:0};
  let k=0,largest=-1;for(let l=0;l<AIR_LAYERS;l++){const q=i*AIR_LAYERS+l,m=this.mass[q*AIR_SPECIES+4]+this.mass[q*AIR_SPECIES+5];if(m>largest){largest=m;k=l;}}
  // Clear columns report boundary-layer conditions, not an invented cloud layer.
  if(largest<=1e-12)k=0;const q=i*AIR_LAYERS+k,d=this.dry(q),p=this.pressure(i,k),ice=this.temperature[q]<0,sat=saturatedVapor(d.mass,d.moles,this.temperature[q],p,ice),v=this.mass[q*AIR_SPECIES],moles=v/.018015,partial=p*moles/Math.max(1e-30,moles+d.moles);
  return {temperature:this.temperature[q],humidity:partial/Math.max(1e-30,saturationPressure(this.temperature[q],ice?'ice':'water')),pressure:p,saturation:sat,excess:v-sat,lift:this.updraft[i*(AIR_LAYERS-1)+Math.min(k,AIR_LAYERS-2)],height:this.height(k),layer:k};
 }
 layerCloudFraction(i:number,k:number,pressure=this.pressure(i,k)){
  const q=i*AIR_LAYERS+k,d=this.dry(q),total=this.mass[q*AIR_SPECIES]+this.mass[q*AIR_SPECIES+4]+this.mass[q*AIR_SPECIES+5],sat=saturatedVapor(d.mass,d.moles,this.temperature[q],pressure,this.temperature[q]<0);
  return statisticalCloud(total,sat).fraction;
 }
 /** Maximum-random area, using the same subcolumns as radiation. */
 cloudFraction(i:number){return maximumRandomCloudArea(Array.from({length:AIR_LAYERS},(_,k)=>this.layerCloudFraction(i,k)));}
 /** Original ecCKD 32x32 gas tables, Mie liquid/Baum ice tables, pressure-
  * interpolated interface Planck sources, and maximum-random cloud overlap.
  * Ozone/N2O remain prescribed; non-Earth gas mixtures are outside the tables.
  * Solar transfer uses a conservative diffuse two-stream approximation. */
 radiationColumn(s:PhysicalState,i:number,e:Environment,solarOverride?:number,albedoOverride?:number,ozone:'earth'|'rcemip'='earth'):RadiationColumn{
  return this.fillRadiationColumn(s,i,e,solarOverride,albedoOverride,ozone);
 }
 /** Synchronous solver-only view. Public diagnostic calls allocate their own
  * column so a later cell/rebuild cannot change a previously returned result. */
 private fillRadiationColumn(s:PhysicalState,i:number,e:Environment,solarOverride?:number,albedoOverride?:number,ozone:'earth'|'rcemip'='earth',scratch?:ReturnType<typeof spectralColumnScratch>):RadiationColumn{
  if(this.radiationModel==='thin-co2-grey'){
   const temperature=this.temperature.subarray(i*AIR_LAYERS,(i+1)*AIR_LAYERS),opticalDepth=new Float64Array(AIR_LAYERS),cloudTransportDepth=new Float64Array(AIR_LAYERS),dustAbsorption=new Float64Array(AIR_LAYERS),dustScattering=new Float64Array(AIR_LAYERS);
   for(let k=0;k<AIR_LAYERS;k++){const a=(i*AIR_LAYERS+k)*AIR_SPECIES;opticalDepth[k]=COLUMN_KG*(.0015*this.mass[a+3]+.01*this.mass[a]+DUST_LONGWAVE_ABSORPTION*this.dustMass[i*AIR_LAYERS+k]+SOOT.longwave*this.mass[a+8]);const dustTau=this.dustMass[i*AIR_LAYERS+k]*COLUMN_KG*DUST_SHORTWAVE_EXTINCTION;const smoke=aerosolOptics(SOOT,this.mass[a+8]*COLUMN_KG);dustAbsorption[k]=(1-DUST_SINGLE_SCATTER_ALBEDO)*dustTau+smoke.absorption;dustScattering[k]=DUST_SINGLE_SCATTER_ALBEDO*(1-DUST_ASYMMETRY)*dustTau+smoke.scattering;cloudTransportDepth[k]=.15*CLOUD_OPTICAL_PER_KG*COLUMN_KG*(this.mass[a+4]+this.mass[a+5]);}
   const exposure=Math.max(0,[0,1,2].reduce((sum,k)=>sum+this.grid.directions[i*3+k]*e.sun[k],0));
   // Explicit grey CO₂/dust approximation with conservative scattering and
   // absorption; it does not predict observed Martian spectra or weather.
   return {temperature,opticalDepth,cloudTransportDepth,shortwaveBands:[{weight:1,absorptionDepth:dustAbsorption,rayleighDepth:dustScattering,cloudTransportDepth}],surfaceTemperature:this.surfaceTemperature(s,i),surfaceAlbedo:albedoOverride??climateSurfaceAlbedo(s,i),solar:solarOverride??1361*e.sunlight*exposure};
  }
  const n=AIR_LAYERS,work=scratch??spectralColumnScratch(),{column,pressure,interfaces,interfaceTemperature,sources,surface,gas,amounts,gasLayer}=work,{temperature,cloudFraction,cloudMeanAbsorptionDepth,cloudTransportDepth,opticalDepth,longwaveBands,shortwaveBands}=column;
  temperature.set(this.temperature.subarray(i*n,(i+1)*n));for(let k=0;k<n;k++)pressure[k]=this.pressure(i,k);
  cloudMeanAbsorptionDepth.fill(0);cloudTransportDepth.fill(0);opticalDepth.fill(0);
  let above=0;for(let k=n-1;k>=0;k--){interfaces[k+1]=above;above+=this.layerMass(i*n+k)*COLUMN_KG*9.81*this.gravity;}interfaces[0]=above;
  interfaceTemperature[n]=temperature[n-1]+273.15;
  for(let k=1;k<n;k++){const span=pressure[k-1]-pressure[k],weight=span>1e-20?(pressure[k-1]-interfaces[k])/span:.5;interfaceTemperature[k]=Math.max(0,273.15+temperature[k-1]+weight*(temperature[k]-temperature[k-1]));}
  // Reconstructed radiance cannot be negative. This does not edit the
  // atmospheric reservoir temperature or impose a 1-K emission source.
  const lowerSpan=pressure[0]-pressure[1];interfaceTemperature[0]=Math.max(0,273.15+temperature[0]+(lowerSpan>1e-20?(interfaces[0]-pressure[0])/lowerSpan*(temperature[0]-temperature[1]):0));
  for(let k=0;k<=n;k++)spectralSourceInto(interfaceTemperature[k],sources[k]);spectralSourceInto(this.surfaceTemperature(s,i)+273.15,surface);
  for(let g=0;g<32;g++){const band=longwaveBands[g];band.surfaceSource=surface[g];for(let k=0;k<n;k++){band.sourceTop[k]=sources[k+1][g];band.sourceBottom[k]=sources[k][g];}}
  for(let k=0;k<n;k++){
   const q=i*n+k,a=q*AIR_SPECIES,d=this.dry(q),p=pressure[k],o3=ozone==='rcemip'?3.6478e-6*(p/100)**.83209*Math.exp(-p/(100*11.3515)):undefined;
   gasLayer.pressure=p;gasLayer.temperature=temperature[k]+273.15;gasLayer.dryMoles=d.moles*COLUMN_KG;gasLayer.waterMoles=this.mass[a]*COLUMN_KG/.018015;gasLayer.carbonDioxideMoles=this.mass[a+3]*COLUMN_KG/.04401;gasLayer.methaneMoles=this.mass[a+2]*COLUMN_KG/.016043;gasLayer.ozone=o3;gasLayer.n2o=ozone==='rcemip'?306e-9:320e-9;
   spectralGasOpticsInto(gasLayer,gas,amounts);
   const smoke=aerosolOptics(SOOT,this.mass[a+8]*COLUMN_KG);
   const liquid=this.mass[a+4]*COLUMN_KG,ice=this.mass[a+5]*COLUMN_KG;cloudFraction[k]=this.layerCloudFraction(i,k,pressure[k]);
   for(let g=0;g<32;g++){
    const lw=longwaveBands[g],sw=shortwaveBands[g];lw.opticalDepth[k]=gas.longwave[g]+smoke.longwave;sw.absorptionDepth[k]=gas.shortwave[g]+smoke.absorption;sw.rayleighDepth[k]=gas.rayleigh[g]+smoke.scattering;
    lw.cloudMeanAbsorptionDepth[k]=liquid*spectralCloudOptics.liquidLongwaveAbsorption[g]+ice*spectralCloudOptics.iceLongwaveAbsorption[g];
    sw.cloudMeanAbsorptionDepth[k]=liquid*spectralCloudOptics.liquidShortwaveAbsorption[g]+ice*spectralCloudOptics.iceShortwaveAbsorption[g];
    sw.cloudTransportDepth[k]=liquid*spectralCloudOptics.liquidShortwaveTransport[g]+ice*spectralCloudOptics.iceShortwaveTransport[g];
    cloudMeanAbsorptionDepth[k]+=lw.weight*lw.cloudMeanAbsorptionDepth[k];cloudTransportDepth[k]+=sw.weight*sw.cloudTransportDepth[k];opticalDepth[k]+=lw.weight*lw.opticalDepth[k];
   }
  }
  const exposure=Math.max(0,[0,1,2].reduce((a,k)=>a+this.grid.directions[i*3+k]*e.sun[k],0));
  column.surfaceTemperature=this.surfaceTemperature(s,i);column.surfaceAlbedo=albedoOverride??climateSurfaceAlbedo(s,i);column.solar=solarOverride??1361*e.sunlight*exposure;return column;
 }
 /** Diagnostic only: current atmosphere held fixed. */
 surfaceRadiativeTarget(s:PhysicalState,i:number,e:Environment){const f=radiativeFluxes(this.radiationColumn(s,i,e));return ((f.surfaceSolar+f.down[0])/SIGMA)**.25-273.15;}
 surfaceLight(s:PhysicalState,i:number,e:Environment){
  const p=i*3,exposure=this.grid.directions[p]*e.sun[0]+this.grid.directions[p+1]*e.sun[1]+this.grid.directions[p+2]*e.sun[2];
  if(e.sunlight<=0||exposure<=0)return 0;
  return surfaceSolarDown(this.radiationColumn(s,i,e))/1361;
 }
 private queue(d:number,r:number,fraction:number){
  const mass=this.fluxMass[d];if(fraction<=0||mass<1e-18||mass*fraction===0)return;
  for(let f=0;f<AIR_SPECIES;f++)queueSpecies(this.mass,this.delta,AIR_SPECIES,d,r,f,fraction);
  queueSpecies(this.dustMass,this.dustDelta,1,d,r,0,fraction);
  carryVelocity(this.velocity,d,this.grid.directions,Math.floor(d/AIR_LAYERS),Math.floor(r/AIR_LAYERS),this.carried);
  queueEnergyMomentum(d,r,mass*fraction,this.fluxEnergy[d]*fraction,this.velocity,this.carried,this.heat,this.momentum);
  // Species carry their own capacity and phase reference through the new
  // inventories. Only a temperature difference and actual lifting work can
  // change a receiver's temperature; isothermal horizontal flow is neutral.
  this.relativeHeat[r]+=fraction*this.fluxCapacity[d]*(this.temperature[d]-this.temperature[r])+mass*fraction*9.81*this.gravity*(this.height(d%AIR_LAYERS)-this.height(r%AIR_LAYERS))/1000;
  const moved=mass*fraction,incoming=this.incomingMass[r],combined=incoming+moved;let relativeSpeed2=0;
  for(let k=0;k<3;k++){const delta=this.carried[k]-this.incomingVelocity[r*3+k];relativeSpeed2+=delta*delta;this.incomingVelocity[r*3+k]+=moved/combined*delta;}
  this.mixingEnergy[r]+=incoming*moved/combined*relativeSpeed2/2000;this.incomingMass[r]=combined;this.outgoingMass[d]+=moved;
 }
 private commit(){
  for(let q=0;q<this.temperature.length;q++){
   const oldMass=this.fluxMass[q],h=this.fluxEnergy[q]+this.heat[q],temperature=this.temperature[q],incoming=this.incomingMass[q],retained=Math.max(0,oldMass-this.outgoingMass[q]);
   let relativeSpeed2=0;for(let k=0;k<3;k++)relativeSpeed2+=(this.velocity[q*3+k]-this.incomingVelocity[q*3+k])**2;
   const mixing=this.mixingEnergy[q]+(incoming>0?retained*incoming/(retained+incoming)*relativeSpeed2/2000:0);
   for(let f=0;f<AIR_SPECIES;f++)this.mass[q*AIR_SPECIES+f]+=this.delta[q*AIR_SPECIES+f];this.dustMass[q]+=this.dustDelta[q];const m=this.layerMass(q);
   // Proportional outflow leaves the retained donor at its original velocity.
   // Incoming parcels use the existing conservative impulse accumulation.
   if(incoming>0)commitMomentum(q,oldMass,m,this.velocity,this.momentum);else if(m<=1e-18)this.velocity.fill(0,q*3,q*3+3);
   const c=this.layerCapacity(q);
   if(c<=1e-18){this.temperature[q]=0;this.velocity.fill(0,q*3,q*3+3);}
   else this.temperature[q]=temperature+(this.relativeHeat[q]+mixing)/c;
   // This is the measured reference/material arithmetic residual, not a
   // physical heat source used to admit an otherwise unaffordable exchange.
   this.roundoff[Math.floor(q/AIR_LAYERS)]+=this.layerEnergy(q,m)-h;
  }
 }
 /** Inventories, temperature and velocity stay fixed while fluxes are queued.
  * These donors are valid only until commit; every transport stage refreshes. */
 private clearFlux(){this.delta.fill(0);this.dustDelta.fill(0);this.heat.fill(0);this.relativeHeat.fill(0);this.mixingEnergy.fill(0);this.incomingMass.fill(0);this.incomingVelocity.fill(0);this.outgoingMass.fill(0);this.momentum.fill(0);this.out.fill(0);for(let q=0;q<this.fluxMass.length;q++){const m=this.layerMass(q),c=this.layerCapacity(q);this.fluxMass[q]=m;this.fluxCapacity[q]=c;this.fluxEnergy[q]=this.layerEnergy(q,m,c);}}
 private dynamics(dt:number,e:Environment){
  const acceleration=this.acceleration,rt=this.rt,virtual=this.virtualTemperature,logPressure=this.logPressure;
  acceleration.fill(0);
  for(let i=0;i<this.grid.count;i++){let above=0;for(let k=AIR_LAYERS-1;k>=0;k--){const q=i*AIR_LAYERS+k,m=this.layerMass(q);this.fluxMass[q]=m;rt[q]=this.gasConstant(q)*(this.temperature[q]+273.15);virtual[q]=this.virtual(q);logPressure[q]=Math.log(Math.max(.01,(above+m*.5)*COLUMN_KG*9.81*this.gravity));above+=m;}}
  let edgeIndex=0;for(const {i,j,distance} of this.edges){let thermal=0,previous=0;for(let k=0;k<AIR_LAYERS;k++){
   const a=i*AIR_LAYERS+k,b=j*AIR_LAYERS+k;
   if(this.fluxMass[a]<1e-12||this.fluxMass[b]<1e-12)continue;
   // Linearized hypsometric pressure anomaly at a fixed reference height:
   // ∂z ln p = -g/(R Tv). Heating expands the column and creates horizontal
   // pressure differences even before total column mass has redistributed.
   const lower=k===0?0:this.height(k-1),relative=2*(virtual[b]-virtual[a])/Math.max(1,virtual[b]+virtual[a]);thermal+=9.81*this.gravity*(this.height(k)-lower)*(k===0?relative:(previous+relative)*.5);previous=relative;
   const force=-((rt[a]+rt[b])*.5*(logPressure[b]-logPressure[a])+thermal)/(distance*this.radiusMeters);
   for(let v=0;v<3;v++){acceleration[a*3+v]+=force*this.gradients[edgeIndex*6+v];acceleration[b*3+v]+=force*this.gradients[edgeIndex*6+3+v];}
  }edgeIndex++;}
  const groundDrag=Math.exp(-dt/86400),airDrag=Math.exp(-dt/604800),g=this.grid.directions;
  let previousCell=-1,c=1,sn=0;
  for(let q=0;q<this.temperature.length;q++){
   const mass=this.fluxMass[q],h=this.layerEnergy(q,mass),i=Math.floor(q/AIR_LAYERS),v=q*3,n=i*3,capacity=this.layerCapacity(q),temperature=this.temperature[q],oldSpeed2=this.speed2(q),x0=this.velocity[v],y0=this.velocity[v+1],z0=this.velocity[v+2];
   if(i!==previousCell){const angle=-2*(e.rotationRate??0)/AIR_SECONDS*g[n+1]*dt;c=Math.cos(angle);sn=Math.sin(angle);previousCell=i;}
   const drag=q%AIR_LAYERS===0?groundDrag:airDrag;
   const forceTrial=(fraction:number)=>{
    let x=x0+fraction*acceleration[v]*dt,y=y0+fraction*acceleration[v+1]*dt,z=z0+fraction*acceleration[v+2]*dt;
    const dot=x*g[n]+y*g[n+1]+z*g[n+2];x-=dot*g[n];y-=dot*g[n+1];z-=dot*g[n+2];
    this.velocity[v]=(x*c+(g[n+1]*z-g[n+2]*y)*sn)*drag;this.velocity[v+1]=(y*c+(g[n+2]*x-g[n]*z)*sn)*drag;this.velocity[v+2]=(z*c+(g[n]*y-g[n+1]*x)*sn)*drag;
    const work=mass*(this.speed2(q)-oldSpeed2)/2000;
    if(capacity>1e-18)this.temperature[q]=temperature-work/capacity;else this.setEnergy(q,h,mass);
    return validThermodynamicTemperature(this.temperature[q])&&(capacity<=1e-18||work<=capacity*(temperature-Math.fround(MIN_THERMODYNAMIC_TEMPERATURE)));
   };
   if(!forceTrial(1)){
    if(!forceTrial(0))throw new Error('압력 작용의 초기 대기 에너지 재고가 유효하지 않습니다.');
    let lo=0,hi=1;for(let iteration=0;iteration<40;iteration++){const mid=(lo+hi)/2;if(forceTrial(mid))lo=mid;else hi=mid;}forceTrial(lo);
   }
   // Pressure work, drag and upwind mixing exchange kinetic/internal energy;
   // dissipation is retained as heat rather than silently discarded.
   this.roundoff[i]+=this.layerEnergy(q,mass)-h;
  }
  this.clearFlux();
  let speedIndex=0;
  for(const {i,j,distance,t} of this.edges)for(let k=0;k<AIR_LAYERS;k++){
   const a=i*AIR_LAYERS+k,b=j*AIR_LAYERS+k;let speed=0;for(let l=0;l<3;l++)speed+=t[l]*(this.velocity[a*3+l]+this.velocity[b*3+l])*.5;const d=speed>=0?a:b;
   this.edgeSpeeds[speedIndex++]=speed;
   this.out[d]+=Math.abs(speed)*dt/(distance*this.radiusMeters*3);
  }
  let max=0;for(const v of this.out)max=Math.max(max,v);if(max>.45)throw new Error('대기 수평 CFL 한계를 넘었습니다.');
  speedIndex=0;
  for(const {i,j,distance} of this.edges)for(let k=0;k<AIR_LAYERS;k++){const a=i*AIR_LAYERS+k,b=j*AIR_LAYERS+k,speed=this.edgeSpeeds[speedIndex++];this.queue(speed>=0?a:b,speed>=0?b:a,Math.abs(speed)*dt/(distance*this.radiusMeters*3));}
  this.commit();
  this.clearFlux();
  for(let i=0;i<this.grid.count;i++)for(let k=0;k<AIR_LAYERS-1;k++){
   const a=i*AIR_LAYERS+k,b=a+1;if(this.fluxMass[a]<1e-12||this.fluxMass[b]<1e-12){this.updraft[i*(AIR_LAYERS-1)+k]=0;continue;}const z=this.height(k+1)-this.height(k);
   let dryCapacity=this.dustMass[a]*DUST_CP+this.mass[a*AIR_SPECIES+8]*cp[8];for(const f of DRY_GAS_INDICES)dryCapacity+=this.mass[a*AIR_SPECIES+f]*cp[f];
   const ma=this.fluxMass[a],mb=this.fluxMass[b],mix=-Math.expm1(-PLUME_ENTRAINMENT*z),da=this.dry(a),db=this.dry(b);
   // Compensate DRY air, not moist total mass. Otherwise every evaporation /
   // precipitation cycle pumps noncondensable air into the bottom layer.
   // This is the dry-mass-coordinate principle, not the full WRF equations.
   const useDry=da.mass>1e-12&&db.mass>1e-12,referenceA=useDry?da.mass:ma,referenceB=useDry?db.mass:mb,scale=referenceA/referenceB,mixedMass=(1-mix)*ma+mix*scale*mb;
   let envCapacity=this.dustMass[b]*DUST_CP+this.mass[b*AIR_SPECIES+8]*cp[8];for(const f of DRY_GAS_INDICES)envCapacity+=this.mass[b*AIR_SPECIES+f]*cp[f];
   const dryMoles=(1-mix)*da.moles+mix*scale*db.moles,water=(1-mix)*(this.mass[a*AIR_SPECIES]+this.mass[a*AIR_SPECIES+4]+this.mass[a*AIR_SPECIES+5])+mix*scale*(this.mass[b*AIR_SPECIES]+this.mass[b*AIR_SPECIES+4]+this.mass[b*AIR_SPECIES+5]),
    dryMass=(1-mix)*da.mass+mix*scale*db.mass,mixedH=(1-mix)*(this.fluxEnergy[a]-ma*this.speed2(a)*.5/1000)+mix*scale*(this.fluxEnergy[b]-mb*this.speed2(b)*.5/1000),
    parcelCapacity=(1-mix)*dryCapacity+mix*scale*envCapacity,parcelH=mixedH-((1-mix)*this.dryChemicalEnergy(a)+mix*scale*this.dryChemicalEnergy(b)),pressure=this.pressure(i,k+1),potential=mixedMass*9.81*this.gravity*this.height(k+1)/1000;
   // A diagnostic parcel can run out of thermal energy before reaching the
   // next level. It cannot drive that exchange; leave actual stocks/heat intact.
   if(parcelH<waterStateAtTemperature(parcelCapacity,dryMoles,water,pressure,potential,Math.fround(MIN_THERMODYNAMIC_TEMPERATURE)).energy){this.updraft[i*(AIR_LAYERS-1)+k]=0;continue;}
   const parcel=parcelEquilibrium(parcelCapacity,dryMoles,water,parcelH,pressure,potential),
    parcelGas=dryMass+parcel.vapor,parcelR=8.314462618*(dryMoles+parcel.vapor/.018015)/Math.max(1e-30,parcelGas),parcelVirtual=(parcel.temperature+273.15)*parcelR/287*parcelGas/mixedMass;
   const buoyancy=buoyancyAcceleration(parcelVirtual,this.virtual(b),9.81*this.gravity),v=i*(AIR_LAYERS-1)+k;
   const old=this.updraft[v],w=Math.max(0,(old+buoyancy*dt)/(1+PLUME_ENTRAINMENT*old*dt));this.updraft[v]=w;
   const m=Math.min(referenceA,referenceB)*w*dt/z,fa=m/referenceA,fb=m/referenceB;this.out[a]+=fa;this.out[b]+=fb;this.queue(a,b,fa);this.queue(b,a,fb);
  }
  for(const v of this.out)if(v>.45)throw new Error('대기 수직 CFL 한계를 넘었습니다.');this.commit();
 }
 private dryChemicalEnergy(q:number){let h=this.mass[q*AIR_SPECIES+8]*latent[8];for(const f of DRY_GAS_INDICES)h+=this.mass[q*AIR_SPECIES+f]*latent[f];return h;}
 private phase(q:number,i:number,k:number,condensed?:Float32Array){
  const total=this.mass[q*AIR_SPECIES]+this.mass[q*AIR_SPECIES+4]+this.mass[q*AIR_SPECIES+5];if(total<=0)return;
  const h=this.layerEnergy(q),d=this.dry(q),p=this.pressure(i,k);if(this.mass[q*AIR_SPECIES+4]+this.mass[q*AIR_SPECIES+5]<=1e-18&&statisticalCloud(total,saturatedVapor(d.mass,d.moles,this.temperature[q],p,this.temperature[q]<0)).condensate===0)return;
  let dryCapacity=this.dustMass[q]*DUST_CP+this.mass[q*AIR_SPECIES+8]*cp[8];for(const f of DRY_GAS_INDICES)dryCapacity+=this.mass[q*AIR_SPECIES+f]*cp[f];const potential=this.layerMass(q)*(9.81*this.gravity*this.height(k)+this.speed2(q)*.5)/1000;
  const a=q*AIR_SPECIES,old=this.mass[a],liquid=this.mass[a+4],ice=this.mass[a+5],temperature=this.temperature[q],capacity=this.layerCapacity(q),mass=this.layerMass(q),minimum=Math.fround(MIN_THERMODYNAMIC_TEMPERATURE);
  const closure=(total:number,sat:number)=>statisticalCloud(total,sat).condensate,
   lower=waterStateAtTemperature(dryCapacity,d.moles,total,p,potential,minimum,true,closure),target=h-this.dryChemicalEnergy(q);
  // Constant capacities extrapolated far below freezing can make conversion
  // of supercooled liquid to ice endothermic. If full equilibrium needs more
  // energy than this valid reservoir owns, admit only the attainable extent
  // toward the boundary composition below; retain the rest as liquid.
  const r=target<lower.energy?lower:waterEquilibrium(dryCapacity,d.moles,total,target,p,potential,minimum,Infinity,closure);
  if(r.vapor===old&&r.liquid===liquid&&r.ice===ice)return;
  const dv=r.vapor-old,dl=r.liquid-liquid,di=r.ice-ice,mechanical=(9.81*this.gravity*this.height(k)+this.speed2(q)*.5)/1000,available=capacity*(temperature-minimum);
  const cost=(dv*cp[0]+dl*cp[4]+di*cp[5])*minimum+dv*latent[0]+dl*latent[4]+di*latent[5]+(dv+dl+di)*mechanical;
  let extent=cost>0?Math.min(1,Math.max(0,available/cost)):1;if(extent===0)return;
  // An equilibrium root's tolerance cannot supply energy for a tiny phase
  // conversion at an exhausted boundary. Admit its actual material extent.
  const trial=(fraction:number)=>{
   this.mass[a]=old+fraction*dv;this.mass[a+4]=liquid+fraction*dl;this.mass[a+5]=ice+fraction*di;
   const v=this.mass[a]-old,l=this.mass[a+4]-liquid,frozen=this.mass[a+5]-ice,dc=v*cp[0]+l*cp[4]+frozen*cp[5],phase=v*latent[0]+l*latent[4]+frozen*latent[5],work=(this.layerMass(q)-mass)*mechanical;
   this.temperature[q]=temperature-(dc*temperature+phase+work)/this.layerCapacity(q);
   return validThermodynamicTemperature(this.temperature[q])&&dc*minimum+phase+work<=available;
  };
  if(!trial(extent)){
   let lo=0,hi=extent;if(!trial(0))throw new Error('상변화의 초기 대기 에너지 재고가 유효하지 않습니다.');
   for(let iteration=0;iteration<40;iteration++){const mid=(lo+hi)/2;if(trial(mid))lo=mid;else hi=mid;}extent=lo;trial(extent);
  }
  this.roundoff[i]+=this.layerEnergy(q)-h;if(condensed)condensed[i]+=Math.max(0,old-this.mass[a]);
 }
 /** Replay actual local flux laws at a shorter interval if lifting the new
  * surface inventory cannot be paid by the finite surface + air energy. */
 private surfaceBoundaryStep(s:PhysicalState,i:number,dt:number,operation:(seconds:number)=>void,precipitated?:Float32Array){
  if(!this.mechanics){operation(dt);return;}
  const p=i*STRIDE,q=i*AIR_LAYERS,a=q*AIR_SPECIES,v=q*3;
  const initialSurface=this.surfaceEnergy(s,i),initialAir=this.columnEnergy(i),initialPotential=this.mechanics.potential(s,i),initialKinetic=this.mechanics.kinetic?.(i)??0;
  this.boundarySurface.set(s.subarray(p,p+STRIDE));this.boundaryMass.set(this.mass.subarray(a,a+AIR_LAYERS*AIR_SPECIES));
  this.boundaryDust.set(this.dustMass.subarray(q,q+AIR_LAYERS));this.boundaryTemperature.set(this.temperature.subarray(q,q+AIR_LAYERS));this.boundaryVelocity.set(this.velocity.subarray(v,v+AIR_LAYERS*3));
  const mechanical=this.mechanics.checkpointCell?.(i),impulse=this.boundaryImpulse.slice(),carry=this.surfaceHeatCarry[i],evaporation=this.evaporationCarry[i],dust=this.dustLiftCarry[i],soot=this.sootLiftCarry[i],roundoff=this.roundoff[i],rain=precipitated?.[i*2],snow=precipitated?.[i*2+1];
  const restore=()=>{
   if(mechanical!==undefined)this.mechanics!.restoreCell?.(i,mechanical);this.boundaryImpulse.set(impulse);
   s.set(this.boundarySurface,p);this.mass.set(this.boundaryMass,a);this.dustMass.set(this.boundaryDust,q);this.temperature.set(this.boundaryTemperature,q);this.velocity.set(this.boundaryVelocity,v);
   this.surfaceHeatCarry[i]=carry;this.evaporationCarry[i]=evaporation;this.dustLiftCarry[i]=dust;this.sootLiftCarry[i]=soot;this.roundoff[i]=roundoff;
   if(precipitated){precipitated[i*2]=rain!;precipitated[i*2+1]=snow!;}this.mechanics!.accept(s,i);
  };
  const trial=(fraction:number)=>{
   restore();if(fraction>0)operation(dt*fraction);
   const target=initialSurface+(initialAir-this.columnEnergy(i))+(initialPotential-this.mechanics!.potential(s,i))+(initialKinetic-(this.mechanics!.kinetic?.(i)??0));
   const minimum=this.surfacePhaseEnergy(s,i)+this.surfaceCapacity(s,i)*Math.fround(MIN_THERMODYNAMIC_TEMPERATURE);
   return {target,valid:Number.isFinite(target)&&target>=minimum&&this.temperature.subarray(q,q+AIR_LAYERS).every(validThermodynamicTemperature)};
  };
  let result=trial(1);
  if(!result.valid){let lo=0,hi=1;for(let n=0;n<32;n++){const mid=(lo+hi)/2;if(trial(mid).valid)lo=mid;else hi=mid;}result=trial(lo);}
  if(!result.valid){restore();throw new Error('지표·대기 경계의 에너지 재고가 유효하지 않습니다.');}
  this.setSurfaceEnergy(s,i,result.target);this.mechanics.accept(s,i);
 }
 /** The incoming parcel owns its energy and impulse. Invert total energy
  * after momentum mixing, so lost relative KE becomes local sensible heat. */
 private receiveMass(q:number,species:number,amount:number,energy:number,momentum:ArrayLike<number>){
  if(amount<=0)return;const oldMass=this.layerMass(q),h=this.layerEnergy(q);
  if(species<0)this.dustMass[q]+=amount;else this.mass[q*AIR_SPECIES+species]+=amount;
  for(let k=0;k<3;k++)this.velocity[q*3+k]=(oldMass*this.velocity[q*3+k]+momentum[k])/(oldMass+amount);
  this.setEnergy(q,h+energy);
 }
 private surfaceParcel(s:PhysicalState,i:number,field:number,amount:number){return this.mechanics?.massParcel?.(s,i,field,amount)??{momentum:[0,0,0],kinetic:0};}
 private surfaceMass(s:PhysicalState,i:number,field:number,amount:number,momentum:readonly number[]){
  if(this.mechanics?.transferMass)return this.mechanics.transferMass(s,i,field,amount,momentum);
  for(let k=0;k<3;k++)this.boundaryImpulse[k]+=momentum[k];return 0;
 }
 private surfaceExchange(s:PhysicalState,i:number,dt:number,boundary?:PrescribedClimateBoundary){
  const p=i*STRIDE,q=i*AIR_LAYERS,m=this.layerMass(q),ca=this.layerCapacity(q);
  let ha=this.layerEnergy(q),hs=this.surfaceEnergy(s,i),cs=capacity(s,i),t=this.surfaceTemperature(s,i),air=this.temperature[q],u=boundary?.windSpeed??Math.hypot(...this.velocity.subarray(q*3,q*3+3));
  const exchange=boundary?.windSpeed!==undefined?Math.max(1,u):surfaceExchangeSpeed(u,t+273.15,air+273.15,this.height(0),9.81*this.gravity);
  const rho=m*COLUMN_KG/this.thickness(0),transfer=rho*1004*.0015*exchange/COLUMN_KG/1000;
  if(ca>1e-18){const amount=conductiveExchange(t,air,cs,ca,transfer,dt);hs-=amount;this.setSurfaceEnergy(s,i,hs);this.temperature[q]+=amount/ca;this.roundoff[i]+=this.layerEnergy(q)-ha-amount;}
  const source=s[p+F.water]>0?F.water:s[p+F.ice]>0?F.ice:null;if(source===null){this.evaporationCarry[i]=0;return;}
  t=this.surfaceTemperature(s,i);const d=this.dry(q),sat=saturatedVapor(d.mass,d.moles,t,this.pressure(i,0),source===F.ice,waterActivity(s[p+F.water],s[p+F.dissolved])),v=this.mass[q*AIR_SPECIES];
  // At/below saturation pressure there is no finite bulk mixing ratio. Use
  // Hertz–Knudsen's kinetic flux (accommodation 0.01), including a vacuum.
  const kinetic=.01*Math.max(0,saturationPressure(t,source===F.ice?'ice':'water')*waterActivity(s[p+F.water],s[p+F.dissolved])-this.pressure(i,0))*Math.sqrt(.018015/(2*Math.PI*8.314462618*Math.max(123.15,t+273.15)))*dt/COLUMN_KG;
  const demand=Number.isFinite(sat)?Math.max(0,sat-v)*(-Math.expm1(-.0015*exchange*dt/this.thickness(0))):kinetic;
  const carried=specificEnthalpy(F.vapor,t)+9.81*this.gravity*this.height(0)/1000;
  const requested=thermalTransferLimit(Math.min(s[p+source],demand+this.evaporationCarry[i]),capacity(s,i),t,source,carried);
  const stored=roundedSurfaceStock(s[p+source],requested,false,s instanceof Float32Array),evaporated=s[p+source]-stored;
  // This is unfulfilled demand, not extra water. Both reservoirs exchange the
  // same actual Float32 debit; sub-ULP requests accumulate without making gas.
  this.evaporationCarry[i]=Math.max(0,requested-evaporated);
  if(evaporated<=0)return;hs=this.surfaceEnergy(s,i);const parcel=this.surfaceParcel(s,i,source,evaporated),incoming=evaporated*carried+parcel.kinetic;
  s[p+source]=stored;const kineticChange=this.surfaceMass(s,i,source,-evaporated,parcel.momentum.map(v=>-v));
  this.receiveMass(q,0,evaporated,incoming,parcel.momentum);this.setSurfaceEnergy(s,i,hs-incoming-kineticChange);
 }
 /** Surface exchange conserves the gas/solid inventory and actual layer+
  * surface enthalpy, including released potential and horizontal kinetic energy.
  * A bounded implicit amount prevents overshooting saturation or the thermal
  * limits; only a representable Float32 solid transfer is committed. */
 co2SurfaceExchange(s:PhysicalState,i:number,dt:number){
  if(dt<=0||this.radiationModel!=='thin-co2-grey')return;
  const p=i*STRIDE,q=i*AIR_LAYERS,index=p+F.carbonDioxideIce,ice=s[index],gas=this.mass[q*AIR_SPECIES+3],t=this.surfaceTemperature(s,i);
  let column=0;for(let k=0;k<AIR_LAYERS;k++)column+=this.layerMass(q+k);
  let moles=0;for(const f of AIR_GAS_INDICES)moles+=this.mass[q*AIR_SPECIES+f]/molar[f];
  const partial=(change:number)=>Math.max(0,(column+change)*COLUMN_KG*9.81*this.gravity)*(gas+change)/.04401/Math.max(1e-30,moles+change/.04401);
  const pressure=partial(0),saturation=carbonDioxideSaturationPressure(t);
  if(pressure>CO2_TRIPLE_PRESSURE||gas+ice<=0)return;
  const deposit=pressure>saturation;if(deposit?gas<=0:ice<=0)return;
  const sign=deposit?1:-1,hs=this.surfaceEnergy(s,i),ha=this.layerEnergy(q),c=capacity(s,i),phase=phaseEnergy(s,i),potential=9.81*this.gravity*this.height(0)/1000;
  const carried=deposit?cp[3]*this.temperature[q]+potential+this.speed2(q)*.5/1000:cp[3]*t+potential;
  const drive=deposit?(pressure-saturation)/Math.max(pressure,1e-30):(saturation-pressure)/Math.max(saturation,1e-30);
  let lo=0,hi=(deposit?gas:ice)*(-Math.expm1(-dt/CO2_EXCHANGE_SECONDS))*Math.min(1,Math.max(0,drive));
  const trial=(amount:number)=>{
   const temp=(hs+sign*amount*carried-phase-sign*amount*MATERIAL_ENERGY[F.carbonDioxideIce])/(c+sign*amount*SPECIFIC_HEAT[F.carbonDioxideIce]);
   const difference=partial(-sign*amount)-carbonDioxideSaturationPressure(temp);
   return validThermodynamicTemperature(temp)&&(deposit?difference>=0:difference<=0);
  };
  if(!trial(hi)){for(let n=0;n<32;n++){const mid=(lo+hi)/2;if(trial(mid))lo=mid;else hi=mid;}hi=lo;}
  const stored=roundedSurfaceStock(ice,hi,deposit,s instanceof Float32Array),amount=sign*(stored-ice);if(amount<=0)return;
  const impulse=[0,1,2].map(v=>deposit?amount*this.velocity[q*3+v]:0);
  s[index]=stored;const kinetic=this.surfaceMass(s,i,F.carbonDioxideIce,sign*amount,impulse);this.mass[q*AIR_SPECIES+3]-=sign*amount;
  if(!deposit){const oldMass=this.layerMass(q)-amount,newMass=oldMass+amount;for(let k=0;k<3;k++)this.velocity[q*3+k]*=oldMass/Math.max(1e-30,newMass);}
  this.setEnergy(q,ha-sign*amount*carried);
  const target=hs+sign*amount*carried-kinetic;this.setSurfaceEnergy(s,i,target);
 }
 /** Grains join air at rest. The ground pays lifting work; momentum dilution
  * and settling dissipation become heat through the common energy inversion. */
 private particleMass(q:number,soot:boolean){return soot?this.mass[q*AIR_SPECIES+8]:this.dustMass[q];}
 private addParticle(q:number,soot:boolean,amount:number){if(soot)this.mass[q*AIR_SPECIES+8]+=amount;else this.dustMass[q]+=amount;}
 private liftParticle(s:PhysicalState,i:number,dt:number,soot:boolean){
  if(dt<=0)return;
  const carry=soot?this.sootLiftCarry:this.dustLiftCarry,material=soot?SOOT:DUST,p=i*STRIDE,q=i*AIR_LAYERS,u=Math.sqrt(this.speed2(q));
  const gasMass=AIR_GAS_INDICES.reduce<number>((m,f)=>m+this.mass[q*AIR_SPECIES+f],0),density=gasMass*COLUMN_KG/this.thickness(0),cover=(s[p+F.ice]+s[p+F.carbonDioxideIce])*COLUMN_KG;
  const flux=particleLiftFlux(material,u,density,cover),source=soot?F.charcoal:s[p+F.surfaceDust]>0?F.surfaceDust:F.sand,old=s[p+source];
  if(flux<=0||old<=0){carry[i]=0;return;}
  const t=this.surfaceTemperature(s,i),potential=9.81*this.gravity*this.height(0)/1000,cp=SPECIFIC_HEAT[source],chemical=MATERIAL_ENERGY[source];
  const demand=thermalTransferLimit(Math.min(old,carry[i]+flux*dt/COLUMN_KG),capacity(s,i),t,source,cp*t+chemical+potential);
  const stored=roundedSurfaceStock(old,demand,false,s instanceof Float32Array),amount=old-stored;carry[i]=Math.max(0,demand-amount);
  if(amount<=0)return;
  const hs=this.surfaceEnergy(s,i),ha=this.layerEnergy(q),mass=this.layerMass(q),carried=amount*(cp*t+chemical+potential);
  s[p+source]=stored;this.receiveMass(q,soot?8:-1,amount,carried,[0,0,0]);const target=hs-carried;this.setSurfaceEnergy(s,i,target);
 }
 liftDust(s:PhysicalState,i:number,dt:number){if(this.radiationModel==='thin-co2-grey')this.liftParticle(s,i,dt,false);}
 liftSoot(s:PhysicalState,i:number,dt:number){this.liftParticle(s,i,dt,true);}
 private settleParticle(s:PhysicalState,i:number,dt:number,soot:boolean){
  if(dt<=0)return;const p=i*STRIDE,material=soot?SOOT:DUST,field=soot?F.charcoal:F.surfaceDust;
  for(let k=0;k<AIR_LAYERS;k++){
   const q=i*AIR_LAYERS+k,old=this.particleMass(q,soot);if(old<=0)continue;
   const fraction=-Math.expm1(-particleSettlingSpeed(material,this.pressure(i,k),this.temperature[q],9.81*this.gravity)*dt/this.thickness(k));
   let amount=old*fraction;const carriedPerMass=SPECIFIC_HEAT[field]*this.temperature[q]+MATERIAL_ENERGY[field]+(9.81*this.gravity*this.height(k)+this.speed2(q)*.5)/1000;
   const h=this.layerEnergy(q),hs=this.surfaceEnergy(s,i),target=p+field;
   const stored=k===0?roundedSurfaceStock(s[target],amount,true,s instanceof Float32Array):0;if(k===0)amount=stored-s[target];if(amount<=0)continue;
   const momentum=[0,1,2].map(v=>amount*this.velocity[q*3+v]);this.addParticle(q,soot,-amount);this.setEnergy(q,h-amount*carriedPerMass);
   if(k===0){s[target]=stored;const kinetic=this.surfaceMass(s,i,field,amount,momentum);this.setSurfaceEnergy(s,i,hs+amount*carriedPerMass-kinetic);}
   else this.receiveMass(q-1,soot?8:-1,amount,amount*carriedPerMass,momentum);
  }
 }
 settleDust(s:PhysicalState,i:number,dt:number){this.settleParticle(s,i,dt,false);}
 settleSoot(s:PhysicalState,i:number,dt:number){this.settleParticle(s,i,dt,true);}
 /** Cache-hit test: true when the stored coefficients no longer represent
  * this column within the declared reuse bounds (age, thermal, aerosol and
  * optically significant inventory drift). */
 private radiationStale(s:PhysicalState,i:number,alb:number,mode:number){
  const r=i*RAD_STRIDE,c=this.radiationCache;
  let update=c[r]<0||c[r]>=300||Math.abs(c[r+5]-this.surfaceTemperature(s,i))>1||Math.abs(c[r+6]-alb)>.01||c[r+7]!==mode;
  for(let k=0;k<AIR_LAYERS&&!update;k++){const q=i*AIR_LAYERS+k,a=r+8+k*5,m=this.layerMass(q),cloud=(this.mass[q*AIR_SPECIES+4]+this.mass[q*AIR_SPECIES+5])*COLUMN_KG;update=Math.abs(this.dustMass[q]-this.dustRadiationCache[q])>Math.max(1e-15,.01*this.dustMass[q])||Math.abs(this.mass[q*AIR_SPECIES+8]-this.sootRadiationCache[q])>Math.max(1e-15,.01*this.mass[q*AIR_SPECIES+8])||Math.abs(c[a]-this.temperature[q])>1||Math.abs(m-c[a+1])>.02*Math.max(1e-15,m)||Math.abs(cloud-c[a+2])>.01;}
  // Optical-significance rule: the 1% relative bound stands for grown
  // inventories; the band-weighted floor replaces it where that bound
  // degenerates toward zero (near-empty species, spin-up), so only drift
  // that can move optical depth forces a rebuild. Match aerosol cache
  // accuracy per constituent: equal-mass substitution between differently
  // absorbing species still invalidates; an arrival below the floor is
  // optically negligible by construction and stays cached.
  if(!update){const floors=radiationGasMassFloors();
   for(let k=0;k<AIR_LAYERS&&!update;k++)for(let f=0;f<AIR_GAS_INDICES.length;f++){
    const q=i*AIR_LAYERS+k,m=this.mass[q*AIR_SPECIES+AIR_GAS_INDICES[f]],old=this.gasRadiationCache[q*AIR_GAS_INDICES.length+f];
    if(Math.abs(m-old)>Math.max(.01*Math.max(m,old),floors[f])){update=true;break;}
   }
  }
  return update;
 }
 /** Deterministic rebuild budget: under saturation (spin-up, tool edits,
  * impacts) at most one full spectral solve per column per 300 s of physical
  * time, oldest stored coefficients first. Selection is a pure function of
  * the serialized cache, so save/resume continuity is unchanged. Mask values:
  * 1 rebuild now, 2 triggered but deferred, 0 fresh (initial builds stay
  * unmasked and always run). Unsaturated steps return undefined on purpose:
  * every column then re-tests at its own turn in the loop, after its surface
  * exchange, exactly at the pre-budget decision point — reusing a mask that
  * was computed before surfaceBoundaryStep would delay a fresh trigger by a
  * substep and change dry bit results. */
 private rebuildAllowance(s:PhysicalState,step:number,boundary?:PrescribedClimateBoundary){
  const count=this.grid.count,budget=Math.max(1,Math.ceil(count*step/300)),pending:number[]=[];
  for(let i=0;i<count;i++){
   const alb=boundary?.albedo??climateSurfaceAlbedo(s,i),mode=boundary?.ozone==='rcemip'?1:0;
   if(!this.radiationStale(s,i,alb,mode)||this.radiationCache[i*RAD_STRIDE]<0)continue;
   pending.push(i);
  }
  if(pending.length<=budget)return undefined;
  pending.sort((a,b)=>this.radiationCache[b*RAD_STRIDE]-this.radiationCache[a*RAD_STRIDE]||a-b);
  const allowance=this.radiationAllowance??(this.radiationAllowance=new Uint8Array(count));
  allowance.fill(0);
  for(let n=0;n<budget;n++)allowance[pending[n]]=1;
  for(let n=budget;n<pending.length;n++)allowance[pending[n]]=2;
  return allowance;
 }
 private radiationAllowance?:Uint8Array;
 /** Radiation coefficients sampled at most every 300 s. Solar transport
  * is linear in incident flux, so changing day/night rescales it exactly.
  * Rapid thermal, mass or cloud changes invalidate the cached coefficients.
  * Cache state is serialized to preserve bit-identical save/resume. */
 private radiation(s:PhysicalState,i:number,dt:number,e:Environment,energy:Float32Array,boundary?:PrescribedClimateBoundary,allowance?:Uint8Array){
  const p=i*STRIDE,r=i*RAD_STRIDE,c=this.radiationCache,alb=boundary?.albedo??climateSurfaceAlbedo(s,i),mode=boundary?.ozone==='rcemip'?1:0;
  let stale:boolean,update:boolean,deferred:boolean;
  if(allowance){const value=allowance[i];stale=value>0||c[r]<0;update=value===1||c[r]<0;deferred=value===2;}
  else{stale=this.radiationStale(s,i,alb,mode);update=stale;deferred=false;}
  if(this.radiationCounters)this.countRadiation(s,i,alb,mode,update,deferred);
  if(update){
   for(let k=0;k<AIR_LAYERS;k++)for(let f=0;f<AIR_GAS_INDICES.length;f++){const q=i*AIR_LAYERS+k;this.gasRadiationCache[q*AIR_GAS_INDICES.length+f]=this.mass[q*AIR_SPECIES+AIR_GAS_INDICES[f]];}
   const flux=radiativeFluxes(this.fillRadiationColumn(s,i,e,1,alb,boundary?.ozone,this.spectralScratch));c[r]=0;c[r+1]=flux.down[0]-flux.up[0];c[r+2]=flux.surfaceSolar;c[r+3]=-flux.olr;c[r+4]=1-flux.reflectedSolar;c[r+5]=this.surfaceTemperature(s,i);c[r+6]=alb;c[r+7]=mode;
   for(let k=0;k<AIR_LAYERS;k++){const q=i*AIR_LAYERS+k,a=r+8+k*5,solarHeat=flux.swDown[k+1]-flux.swUp[k+1]-flux.swDown[k]+flux.swUp[k];this.dustRadiationCache[q]=this.dustMass[q];this.sootRadiationCache[q]=this.mass[q*AIR_SPECIES+8];c[a]=this.temperature[q];c[a+1]=this.layerMass(q);c[a+2]=(this.mass[q*AIR_SPECIES+4]+this.mass[q*AIR_SPECIES+5])*COLUMN_KG;c[a+3]=flux.heating[k]-solarHeat;c[a+4]=solarHeat;}
  }
  c[r]+=dt;const solar=1361*e.sunlight*Math.max(0,[0,1,2].reduce((a,k)=>a+this.grid.directions[i*3+k]*e.sun[k],0)),coefficient=radiationEnergy(1,dt),hs=this.surfaceEnergy(s,i),heat=coefficient*(c[r+1]+solar*c[r+2]);
  this.absorbedSolar[i]+=Math.max(0,coefficient*solar*c[r+2]);
  this.setSurfaceEnergy(s,i,hs+heat);
  for(let k=0;k<AIR_LAYERS;k++){
   const q=i*AIR_LAYERS+k,a=r+8+k*5,before=this.layerEnergy(q),heat=coefficient*(c[a+3]+solar*c[a+4]),capacity=this.layerCapacity(q);
   // Radiation changes only sensible heat. A direct increment preserves a
   // zero/sub-ULP flux without subtracting fixed chemical/potential offsets.
   if(capacity>1e-18)this.temperature[q]+=heat/capacity;else this.setEnergy(q,before+heat);
   this.roundoff[i]+=this.layerEnergy(q)-before-heat;
  }
  energy[i*4]+=coefficient*(c[r+3]+solar*c[r+4]);
 }
 /** KK droplet-number-dependent warm autoconversion, Kessler accretion,
  * and Lin cloud-ice aggregation. Rain/snow are diagnostic downward
  * mass/enthalpy fluxes with evaporation, sublimation and heat-limited melt.
  * Rain's local mixing ratio
  * follows the published terminal velocity law, not cloud settling speed.
  * Clear-air evaporation is bounded by an implicit saturation/enthalpy solve.
  * Unaggregated 30-µm ice also sediments at its Stokes speed. */
 private depositPrecipitation(s:PhysicalState,i:number,field:typeof F.water|typeof F.ice,amount:number,carried:number,momentum:readonly number[],precipitated?:Float32Array){
  const p=i*STRIDE,index=p+field,old=s[index],hs=this.surfaceEnergy(s,i);
  // Do not discard sub-ULP rain on a large Float32 ocean. Transfer only
  // representable surface mass and retain the remainder in Float64 air.
  let stored=s instanceof Float32Array?Math.fround(old+amount):old+amount;
  if(s instanceof Float32Array&&stored-old>amount){const bits=new Uint32Array(new Float32Array([stored]).buffer);bits[0]--;stored=new Float32Array(bits.buffer)[0];}
  const received=Math.max(0,stored-old),ratio=amount>0?received/amount:0,residual=amount-received;
  s[index]=stored;const kinetic=this.surfaceMass(s,i,field,received,momentum.map(v=>v*ratio));
  this.setSurfaceEnergy(s,i,hs+carried*ratio-kinetic);this.equilibrateSurfaceWater(s,i);
  if(residual>0)this.receiveMass(i*AIR_LAYERS,field===F.water?4:5,residual,carried*(1-ratio),momentum.map(v=>v*(1-ratio)));
  if(precipitated)precipitated[i*2+(field===F.water?0:1)]+=received;
 }
 private precipitation(s:PhysicalState,i:number,dt:number,precipitated?:Float32Array){
  let rain=0,rainEnergy=0,snow=0,snowEnergy=0;const rainMomentum=[0,0,0],snowMomentum=[0,0,0];
  for(let k=AIR_LAYERS-1;k>=0;k--){
   const q=i*AIR_LAYERS+k,a=q*AIR_SPECIES;
   // Rain/snow are finite parcels with their own energy and horizontal
   // impulse while crossing air layers. They need not share receiver velocity.
   if(this.mass[a+4]===0&&this.mass[a+5]===0&&rain===0&&snow===0)continue;
   const fraction=this.layerCloudFraction(i,k),dryMass=this.dry(q).mass,gas=dryMass>1e-12?dryMass:sum(this.mass,a,4),density=gas*COLUMN_KG/this.thickness(k);
   const collect=(species:4|5,amount:number)=>{
    if(amount<=0)return;const h=this.layerEnergy(q),carried=amount*(cp[species]*this.temperature[q]+latent[species]+(9.81*this.gravity*this.height(k)+this.speed2(q)*.5)/1000);
    this.mass[a+species]-=amount;
    const momentum=species===4?rainMomentum:snowMomentum;for(let v=0;v<3;v++)momentum[v]+=amount*this.velocity[q*3+v];
    this.setEnergy(q,h-carried);
    if(species===4){rain+=amount;rainEnergy+=carried;}else{snow+=amount;snowEnergy+=carried;}
   };
   collect(4,this.mass[a+4]*warmAutoFraction(this.mass[a+4]/Math.max(1e-30,gas*fraction),dt));
   if(rain>0&&gas>0){const qr=diagnosticRainMixingRatio(rain*COLUMN_KG/dt,density);collect(4,this.mass[a+4]*kesslerAccretedFraction(qr,dt));}
   collect(5,gas*fraction*iceAggregation(this.mass[a+5]/Math.max(1e-30,gas*fraction),this.temperature[q],density,dt));
   if(snow>0){
    // Melt water retains the snow parcel's impulse, including when the
    // receiving air moves differently. Available sensible heat bounds melting.
    const parcelSpeed2=snowMomentum.reduce((v,p)=>v+(p/snow)**2,0),liquidH=(9.81*this.gravity*this.height(k)+parcelSpeed2*.5)/1000,snowH=snowEnergy/snow,change=snowH-liquidH;
    const melted=this.temperature[q]>0?Math.min(snow,change>=0?snow:this.layerCapacity(q)*this.temperature[q]/(-change)):0;
    if(melted>0){
     const ratio=melted/snow;for(let v=0;v<3;v++){const impulse=snowMomentum[v]*ratio;snowMomentum[v]-=impulse;rainMomentum[v]+=impulse;}
     this.setEnergy(q,this.layerEnergy(q)+melted*change);snow-=melted;snowEnergy-=melted*snowH;rain+=melted;rainEnergy+=melted*liquidH;
    }
   }
   const evaporate=(amount:number,energy:number,momentum:number[])=>{
    if(amount<=0)return 0;
    const oldH=this.layerEnergy(q),oldV=this.mass[a],oldMass=this.layerMass(q),oldC=this.layerCapacity(q),d=this.dry(q),pressure=this.pressure(i,k),carried=energy/amount;
    const impulse=momentum.map(v=>v/amount),oldMomentum=[0,1,2].map(v=>oldMass*this.velocity[q*3+v]);
    let phase=0;for(let f=0;f<AIR_SPECIES;f++)phase+=this.mass[a+f]*latent[f];
    const temp=(evap:number)=>{
     const mass=oldMass+evap,kinetic=mass>0?oldMomentum.reduce((h,p,v)=>h+(p+evap*impulse[v])**2,0)/(2000*mass):0;
     return (oldH+evap*carried-phase-evap*latent[0]-mass*9.81*this.gravity*this.height(k)/1000-kinetic)/(oldC+evap*cp[0]);
    };
    const excess=(evap:number)=>{const t=temp(evap);return oldV+evap-saturatedVapor(d.mass,d.moles,t,pressure,t<0);};
    if(excess(0)>=0)return 0;
    let lo=0,hi=amount*(1-fraction);
    if(excess(hi)<=0&&temp(hi)>=MIN_THERMODYNAMIC_TEMPERATURE)lo=hi;
    else for(let iteration=0;iteration<24;iteration++){const middle=(lo+hi)/2;if(excess(middle)>0||temp(middle)<MIN_THERMODYNAMIC_TEMPERATURE)hi=middle;else lo=middle;}
    this.receiveMass(q,0,lo,lo*carried,impulse.map(v=>v*lo));
    for(let v=0;v<3;v++)momentum[v]-=lo*impulse[v];return lo;
   };
   if(snow>0){const old=snow,evaporated=evaporate(snow,snowEnergy,snowMomentum);snow-=evaporated;snowEnergy*=1-evaporated/old;}
   if(rain>0){const old=rain,evaporated=evaporate(rain,rainEnergy,rainMomentum);rain-=evaporated;rainEnergy*=1-evaporated/old;}
   const ice=this.mass[a+5],fall=2*917*9.81*this.gravity*(30e-6)**2/(9*1.8e-5),iceAmount=ice*(-Math.expm1(-fall*dt/this.thickness(k)));
   if(iceAmount<=0)continue;
   const h=this.layerEnergy(q),carried=iceAmount*(cp[5]*this.temperature[q]+latent[5]+(9.81*this.gravity*this.height(k)+this.speed2(q)*.5)/1000),momentum=[0,1,2].map(v=>iceAmount*this.velocity[q*3+v]);
   this.mass[a+5]-=iceAmount;this.setEnergy(q,h-carried);
   if(k>0)this.receiveMass(q-1,5,iceAmount,carried,momentum);else this.depositPrecipitation(s,i,F.ice,iceAmount,carried,momentum,precipitated);
  }
  if(snow>0)this.depositPrecipitation(s,i,F.ice,snow,snowEnergy,snowMomentum,precipitated);
  if(rain>0)this.depositPrecipitation(s,i,F.water,rain,rainEnergy,rainMomentum,precipitated);
 }
 /** A surface catalyst only contacts the lowest air reservoir. Upper-layer
  * oxygen and CO₂ must arrive through atmospheric transport first. */
 surfaceReaction(s:PhysicalState,i:number,react:(fraction:number)=>void,resetDiagnostics?:()=>void){
  const p=i*STRIDE,q=i*AIR_LAYERS,airHeat=this.layerEnergy(q),temperature=this.surfaceTemperature(s,i);
  const mirrors=AIR_FIELDS.map(f=>s[p+f]);
  for(let f=0;f<AIR_SPECIES;f++)s[p+AIR_FIELDS[f]]=roundedSurfaceStock(0,this.mass[q*AIR_SPECIES+f],true,s instanceof Float32Array);
  const before=AIR_FIELDS.map(f=>s[p+f]),oldMass=this.layerMass(q),speed2=this.speed2(q);
  const carriedEnergy=()=>AIR_FIELDS.reduce((h,field,f)=>{const delta=s[p+field]-before[f];return h+delta*(cp[f]*temperature+latent[f]+9.81*this.gravity*this.height(0)/1000+(delta<0?speed2*.5/1000:0));},0);
  const airAdmissible=()=>{
   if(AIR_FIELDS.every((field,f)=>s[p+field]===before[f]))return validThermodynamicTemperature(this.temperature[q]);
   let mass=oldMass,c=this.layerCapacity(q),phase=0,removed=0;
   for(let f=0;f<AIR_SPECIES;f++){const delta=s[p+AIR_FIELDS[f]]-before[f];mass+=delta;c+=delta*cp[f];phase+=(this.mass[q*AIR_SPECIES+f]+delta)*latent[f];removed+=Math.max(0,-delta);}
   const speed=mass>1e-18?speed2*(Math.max(0,oldMass-removed)/mass)**2:0;
   const minimum=c*Math.fround(MIN_THERMODYNAMIC_TEMPERATURE)+phase+mechanicalEnergy(mass,9.81*this.gravity,this.height(0),speed);
   return Number.isFinite(minimum)&&airHeat+carriedEnergy()>=minimum;
  };
  const fraction=admitLocalChange(s,i,STRIDE,react,{
   energy:(state,cell)=>this.surfaceEnergy(state,cell),setEnergy:(state,cell,h)=>this.setSurfaceEnergy(state,cell,h),
   capacity:(state,cell)=>this.surfaceCapacity(state,cell),phase:(state,cell)=>this.surfacePhaseEnergy(state,cell),admissible:airAdmissible,
   potential:(state,cell)=>(this.mechanics?.potential(state,cell)??0)+carriedEnergy(),accept:(state,cell)=>this.mechanics?.accept(state,cell)
  });
  if(fraction===0)resetDiagnostics?.();
  let carried=0,removed=0,exchanged=false;
  for(let f=0;f<AIR_SPECIES;f++){
   const delta=s[p+AIR_FIELDS[f]]-before[f];exchanged||=delta!==0;this.mass[q*AIR_SPECIES+f]+=delta;
   carried+=delta*(cp[f]*temperature+latent[f]+9.81*this.gravity*this.height(0)/1000+(delta<0?speed2*.5/1000:0));removed+=Math.max(0,-delta);
   s[p+AIR_FIELDS[f]]=mirrors[f]+delta;
  }
  if(!exchanged)return;
  const newMass=this.layerMass(q);for(let v=0;v<3;v++)this.velocity[q*3+v]*=Math.max(0,oldMass-removed)/Math.max(1e-30,newMass);
  this.setEnergy(q,airHeat+carried);
 }
 private burnGas(q:number,gameDt:number){
  if(this.temperature[q]<=350||this.mass[q*AIR_SPECIES+6]<=0)return;
  for(const {def,adapted} of gasCombustion){
   const fuel=this.mass[q*AIR_SPECIES+airReactionField(def.field)],oxygen=this.mass[q*AIR_SPECIES+6];
   if(fuel<=0||oxygen<=0)continue;
   for(const {reaction,requested} of oxidationRoutes(def,fuel,oxygen,gameDt,this.temperature[q])){
    if(requested<=0)continue;
    const h=this.layerEnergy(q);
    reactInventory(this.mass,q*AIR_SPECIES,adapted.get(reaction)!,thermalReactionLimit(reaction,requested,this.temperature[q],this.layerCapacity(q)));
    this.setEnergy(q,h);
   }
  }
 }

 /** One local reaction half-step on detached surface stocks and actual layers.
  * The combined enthalpy inversion pays for air products, lifting and chemistry;
  * mirrors are cleared before the next surface/air exchange. */
 private combustionStep(s:PhysicalState,gameDt:number){
  for(let i=0;i<this.grid.count;i++){
   const p=i*STRIDE;
   if(this.surfaceTemperature(s,i)>250&&[F.soil,F.plant,F.herbivore,F.carnivore,F.seed,F.charcoal].some(f=>s[p+f]>0)){
    this.surfaceReaction(s,i,fraction=>combust(s,p,gameDt*fraction,this.surfaceTemperature(s,i),ATMOSPHERE_MIRRORS));
    for(const f of ATMOSPHERE_MIRRORS)s[p+f]=0;
   }
   this.equilibrateSurfaceWater(s,i);
   for(let k=0;k<AIR_LAYERS;k++)this.burnGas(i*AIR_LAYERS+k,gameDt);
  }
 }

 private escape(gameDt:number,e:Environment,energy:Float32Array,escaped?:Float32Array){
  for(let i=0;i<this.grid.count;i++)for(let k=0;k<AIR_LAYERS;k++)for(const f of AIR_GAS_INDICES){
   const q=i*AIR_LAYERS+k,index=q*AIR_SPECIES+f,before=this.mass[index];if(before<=0)continue;
   const after=before-before*thermalEscapeFraction(this.temperature[q],e.gravity??1,escapeMolar[f],gameDt,this.radiusMeters),amount=before-after;if(amount===0)continue;
   const h=this.layerEnergy(q),carried=amount*(cp[f]*this.temperature[q]+latent[f]+(9.81*this.gravity*this.height(k)+this.speed2(q)*.5)/1000);
   // Escaping material shares the layer's temperature and velocity. Removing
   // its own capacity, phase and mechanical energy leaves both unchanged;
   // an enthalpy inversion would introduce cancellation near absolute zero.
   this.mass[index]=after;
   this.roundoff[i]+=this.layerEnergy(q)-h+carried;
   if(escaped)escaped[i*GASES.length+escapeIndex[f]]+=amount;energy[i*4+2]-=carried;
  }
 }

 advance(s:PhysicalState,gameDt:number,e:Environment,energy:Float32Array,condensed?:Float32Array,precipitated?:Float32Array,escaped?:Float32Array,boundary?:PrescribedClimateBoundary){
  if(s instanceof Float32Array){const actual=this.physicalSurface(s);this.advance(actual,gameDt,e,energy,condensed,precipitated,escaped,boundary);s.set(this.publishSurface(actual));return;}
  this.absorbedSolar.fill(0);
  if(boundary&&(!Number.isFinite(boundary.temperature)||boundary.temperature< -150||boundary.temperature>2500||!Number.isFinite(boundary.albedo)||boundary.albedo<0||boundary.albedo>1||boundary.windSpeed!==undefined&&(!Number.isFinite(boundary.windSpeed)||boundary.windSpeed<0||boundary.windSpeed>100)))throw new Error('지정한 기후 경계 조건이 올바르지 않습니다.');
  if(!this.detached)this.detach(s,e);this.gravity=e.gravity??1;if(gameDt<=0){this.attach(s);for(let i=0;i<this.grid.count;i++)energy[i*4+3]+=this.roundoff[i];this.roundoff.fill(0);return;}
  const physicalDt=gameDt*AIR_SECONDS;let remaining=physicalDt;
  const prescribe=()=>{if(boundary)for(let i=0;i<this.grid.count;i++){const h=this.surfaceEnergy(s,i);s[i*STRIDE+F.temperature]=boundary.temperature;this.surfaceHeatCarry[i]=0;energy[i*4+1]+=this.surfaceEnergy(s,i)-h;}};
  prescribe();
  while(remaining>1e-10){
   let step=Math.min(this.maxStepSeconds,remaining);
   for(let i=0;i<this.grid.count;i++)for(let k=0;k<AIR_LAYERS-1;k++){
    const a=i*AIR_LAYERS+k,b=a+1,dz=this.height(k+1)-this.height(k),w=this.updraft[i*(AIR_LAYERS-1)+k];
    // A lifted moist parcel cannot be warmer than its starting virtual
    // temperature. Bound its acceleration before selecting the CFL step.
    const bound=9.81*this.gravity*Math.max(0,this.virtual(a)-this.virtual(b))/Math.max(1,this.virtual(b));
    const speed=w+bound*step;if(speed>0)step=Math.min(step,.12*dz/speed);
   }
   for(const edge of this.edges)for(let k=0;k<AIR_LAYERS;k++){const a=edge.i*AIR_LAYERS+k,b=edge.j*AIR_LAYERS+k;step=Math.min(step,.12*edge.distance*this.radiusMeters/Math.max(1,Math.sqrt(this.speed2(a)),Math.sqrt(this.speed2(b))));}
   this.combustionStep(s,step/AIR_SECONDS/2);
   const allowance=this.rebuildAllowance(s,step,boundary);
   for(let i=0;i<this.grid.count;i++){
    this.surfaceBoundaryStep(s,i,step,seconds=>{this.surfaceExchange(s,i,seconds,boundary);this.co2SurfaceExchange(s,i,seconds);this.liftDust(s,i,seconds);this.liftSoot(s,i,seconds);});
    this.radiation(s,i,step,e,energy,boundary,allowance);
   }
   this.dynamics(step,e);
   this.combustionStep(s,step/AIR_SECONDS/2);
   for(let i=0;i<this.grid.count;i++){
    for(let k=0;k<AIR_LAYERS;k++)this.phase(i*AIR_LAYERS+k,i,k,condensed);
    this.surfaceBoundaryStep(s,i,step,seconds=>{this.precipitation(s,i,seconds,precipitated);this.settleDust(s,i,seconds);this.settleSoot(s,i,seconds);},precipitated);
   }
   prescribe();
   remaining-=step;
  }
  this.escape(gameDt,e,energy,escaped);
  for(const t of this.temperature)if(!validThermodynamicTemperature(t))throw new Error('대기 온도가 모델 범위를 벗어났습니다.');
  this.attach(s);for(let i=0;i<this.grid.count;i++)energy[i*4+3]+=this.roundoff[i];this.roundoff.fill(0);
 }
 surfaceWind(target:PhysicalState){for(let i=0;i<this.grid.count;i++)for(let k=0;k<3;k++){
  const index=i*3+k;target[index]=this.velocity[(i*AIR_LAYERS)*3+k]*AIR_SECONDS/this.radiusMeters;
  // A tiny negative SI wind can round to -0 in the public Float32 view.
  // Zero has no physical direction; keep its representation JSON-stable.
  if(target[index]===0)target[index]=0;
 }}
}
