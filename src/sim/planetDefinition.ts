import {deepInitialSupport,validDeepHeight,type DeepInitialConditions} from './deepAtmosphereProfile';
/** Versioned physical inputs, independent of the surface inventory layout.
 * Composition uses mole fractions; inventory remains the existing game column.
 * Deep-atmosphere worlds have a finite gas column and an intrinsic heat flux. */
export type PlanetSpecies='vapor'|'nitrogen'|'methane'|'carbonDioxide'|'hydrogen'|'helium'|'ammonia'|'oxygen';
export type SurfacePrimary='rock'|'sand'|'clay'|'water'|'ice';
export type RadiationModel='earth-spectral'|'thin-co2-grey'|'hydrogen-helium';
export interface PlanetDefinition {
 version:1;
 preset:'sandbox'|'mars'|'jupiter'|'saturn'|'custom';
 kind:'rocky'|'gas-giant'|'ice-giant';
 radiusMeters:number;
 surfaceGravity:number; // m/s² at the reference radius
 timing:'sandbox'|'physical';
 orbit:{distanceAu:number;periodSeconds:number};
 rotation:{periodSeconds:number;tiltDegrees:number};
 atmosphere:{pressurePa:number;composition:{species:PlanetSpecies;moleFraction:number}[];radiation:RadiationModel};
 lowerBoundary:{kind:'solid-surface';primary:SurfacePrimary}|{kind:'deep-atmosphere';pressurePa:number;intrinsicFlux:number};
}
export const PLANET_SPECIES:Record<PlanetSpecies,{molarMass:number}>={
 oxygen:{molarMass:.032},vapor:{molarMass:.018015},nitrogen:{molarMass:.028014},methane:{molarMass:.016043},carbonDioxide:{molarMass:.04401},
 hydrogen:{molarMass:.002016},helium:{molarMass:.004003},ammonia:{molarMass:.017031},
};
export const PHYSICAL_SECONDS_PER_TICK=60;
/** Definition bounds also govern persisted physical orbit and spin inputs.
 * The narrower UI slider range is an editing convenience, not model support. */
export const PLANET_DISTANCE_AU={min:.05,max:100} as const;
export const PLANET_PERIOD_SECONDS={min:1,max:1e12} as const;
export const LEGACY_RADIUS_METERS=1e6;
export const MARS_DEFINITION:PlanetDefinition={
 version:1,preset:'mars',kind:'rocky',radiusMeters:3389500,surfaceGravity:3.71,timing:'physical',
 orbit:{distanceAu:1.524,periodSeconds:59355072},rotation:{periodSeconds:88642.7,tiltDegrees:25.19},
 // Ar is not yet transported. Normalize the supported CO2/N2 approximation.
 atmosphere:{pressurePa:636,composition:[{species:'carbonDioxide',moleFraction:.97},{species:'nitrogen',moleFraction:.03}],radiation:'thin-co2-grey'},
 lowerBoundary:{kind:'solid-surface',primary:'sand'},
};
export const JUPITER_DEFINITION:PlanetDefinition={
 version:1,preset:'jupiter',kind:'gas-giant',radiusMeters:69911000,surfaceGravity:25.92,timing:'physical',
 orbit:{distanceAu:5.203,periodSeconds:4332.59*86400},rotation:{periodSeconds:35730,tiltDegrees:3.13},
 atmosphere:{pressurePa:1e5,composition:[{species:'hydrogen',moleFraction:.898*(1-.0033)},{species:'helium',moleFraction:.102*(1-.0033)},{species:'ammonia',moleFraction:.0003},{species:'vapor',moleFraction:.003}],radiation:'hydrogen-helium'},
 lowerBoundary:{kind:'deep-atmosphere',pressurePa:3e6,intrinsicFlux:5.4},
};
export const SATURN_DEFINITION:PlanetDefinition={
 version:1,preset:'saturn',kind:'gas-giant',radiusMeters:58232000,surfaceGravity:11.19,timing:'physical',
 orbit:{distanceAu:9.537,periodSeconds:10759.22*86400},rotation:{periodSeconds:38362,tiltDegrees:26.73},
 atmosphere:{pressurePa:1e5,composition:[{species:'hydrogen',moleFraction:.967*(1-.0022)},{species:'helium',moleFraction:.033*(1-.0022)},{species:'ammonia',moleFraction:.0002},{species:'vapor',moleFraction:.002}],radiation:'hydrogen-helium'},
 lowerBoundary:{kind:'deep-atmosphere',pressurePa:3e6,intrinsicFlux:2.0},
};
export const isDeepAtmosphere=(d?:PlanetDefinition)=>d?.lowerBoundary.kind==='deep-atmosphere';
const bounded=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function validPlanetDefinition(value:unknown):value is PlanetDefinition {
 if(!value||typeof value!=='object')return false;
 const d=value as PlanetDefinition,a=d.atmosphere,b=d.lowerBoundary;
 if(d.version!==1||!['sandbox','mars','jupiter','saturn','custom'].includes(d.preset)||!['rocky','gas-giant','ice-giant'].includes(d.kind)||!['sandbox','physical'].includes(d.timing)
  ||!bounded(d.radiusMeters,1e3,2e8)||!bounded(d.surfaceGravity,.0981,29.43)
  ||!d.orbit||!bounded(d.orbit.distanceAu,PLANET_DISTANCE_AU.min,PLANET_DISTANCE_AU.max)||!bounded(d.orbit.periodSeconds,PLANET_PERIOD_SECONDS.min,PLANET_PERIOD_SECONDS.max)
  ||!d.rotation||!bounded(d.rotation.periodSeconds,PLANET_PERIOD_SECONDS.min,PLANET_PERIOD_SECONDS.max)||!bounded(d.rotation.tiltDegrees,0,180)
  ||!a||!bounded(a.pressurePa,0,1e12)||!['earth-spectral','thin-co2-grey','hydrogen-helium'].includes(a.radiation)||!Array.isArray(a.composition)||a.composition.length>7)return false;
 const species=new Set<string>();let fraction=0;
 for(const c of a.composition){if(!c||!Object.hasOwn(PLANET_SPECIES,c.species)||species.has(c.species)||!bounded(c.moleFraction,0,1))return false;species.add(c.species);fraction+=c.moleFraction;}
 if(a.pressurePa>0?(Math.abs(fraction-1)>1e-8):(a.composition.length!==0))return false;
 if(!b)return false;
 return d.kind==='rocky'?b.kind==='solid-surface'&&['rock','sand','clay','water','ice'].includes(b.primary)
  :b.kind==='deep-atmosphere'&&bounded(b.pressurePa,1,1e9)&&b.pressurePa>=a.pressurePa&&bounded(b.intrinsicFlux,0,1e5);
}
export function planetSupport(d:PlanetDefinition,deep?:{initial?:DeepInitialConditions;existingHeight?:ArrayLike<number>}):{supported:boolean;reason?:string} {
 if(!validPlanetDefinition(d))return {supported:false,reason:'행성 물리 정의가 올바르지 않습니다.'};
 if(d.lowerBoundary.kind==='deep-atmosphere'){
  if(d.kind!=='gas-giant'||d.atmosphere.radiation!=='hydrogen-helium'||!d.atmosphere.composition.length||d.atmosphere.composition.some(c=>!['hydrogen','helium','ammonia','vapor'].includes(c.species))||d.atmosphere.composition.filter(c=>['hydrogen','helium'].includes(c.species)).reduce((a,c)=>a+c.moleFraction,0)<.9)return {supported:false,reason:'깊은 대기는 수소·헬륨 90% 이상과 암모니아·물 성분을 지원합니다.'};
  if(d.atmosphere.pressurePa<1e3||d.lowerBoundary.pressurePa>1e7||d.lowerBoundary.pressurePa<d.atmosphere.pressurePa*2)return {supported:false,reason:'깊은 대기 계산은 기준 압력 1kPa 이상, 아래 경계 2배 이상·100bar 이하를 지원합니다.'};
  // Existing saves own their fixed geometry. Do not regenerate it from a
  // possibly different default creation profile or rewrite valid old columns.
  return deep?.existingHeight
   ?validDeepHeight(deep.existingHeight)?{supported:true}:{supported:false,reason:'깊은 대기 높이가 3,000km 계산 범위를 벗어났습니다.'}
   :deepInitialSupport(d,deep?.initial);
 }
 if(d.atmosphere.radiation==='hydrogen-helium'||d.atmosphere.composition.some(c=>['hydrogen','helium','ammonia'].includes(c.species)))return {supported:false,reason:'선택한 대기 성분의 계산은 아직 지원하지 않습니다.'};
 return {supported:true};
}
export function assertPlanetSupport(d?:PlanetDefinition,existingHeight?:ArrayLike<number>){if(d){const support=planetSupport(d,existingHeight?{existingHeight}:undefined);if(!support.supported)throw new Error(support.reason);}}
/** Preserve the old radius, compressed year and radiation model on migration. */
export function sandboxDefinition(primary:SurfacePrimary,gravity=1,distance=1):PlanetDefinition {
 return {version:1,preset:'sandbox',kind:'rocky',radiusMeters:LEGACY_RADIUS_METERS,surfaceGravity:9.81*gravity,timing:'sandbox',
  orbit:{distanceAu:distance,periodSeconds:240*distance**1.5*PHYSICAL_SECONDS_PER_TICK},rotation:{periodSeconds:7200,tiltDegrees:0},
  atmosphere:{pressurePa:0,composition:[],radiation:'earth-spectral'},lowerBoundary:{kind:'solid-surface',primary}};
}
/** Legacy tool/initial-profile ranges, retained for UI and save metadata.
 * Evolved surface and ordinary air use the common thermodynamic domain. */
export function temperatureLimits(d?:PlanetDefinition){return isDeepAtmosphere(d)?{surfaceMin:-250,airMin:-250,max:2500}:d?.atmosphere.radiation==='thin-co2-grey'?{surfaceMin:-200,airMin:-220,max:2500}:{surfaceMin:-100,airMin:-150,max:2500};}
export const physicalRadius=(d?:PlanetDefinition)=>d?.radiusMeters??LEGACY_RADIUS_METERS;
export const maxSpinPeriod=(d?:PlanetDefinition)=>d?.timing==='physical'?2880:1200;
export const planetOrbitPeriod=(distance:number,d?:PlanetDefinition)=>d?d.orbit.periodSeconds/PHYSICAL_SECONDS_PER_TICK:240*distance**1.5;
