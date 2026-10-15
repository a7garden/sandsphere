import type {ClimateSnapshot,WeatherClimate} from './weatherClimate';
import {F,STRIDE,gravityMultiplier,type Environment} from './model';

import {REFERENCE_GAS_MASS} from './waterPhysics';
import {ALL_GASES as GASES,GAS_CONSTANT,EARTH_GRAVITY,ESCAPE_MODEL_RADIUS,bindingParameter,escapeRegime,type EscapeRegime} from './gases';
import {physicalRadius} from './planetDefinition';
import {COLUMN_KG,AIR_SPECIES,AIR_GAS_INDICES,airMassWidth} from './layeredAtmosphere';
import {dustOpticalDepth} from './dustPhysics';
import {deepMassWidth} from './deepAtmosphere';
export {ALL_GASES as GASES} from './gases';
export const REFERENCE_COLUMN_MASS=REFERENCE_GAS_MASS;
export const BOUNDARY_PRESSURE=.01;
export const MAX_ATMOSPHERE_HEIGHT_RATIO=.25; // Conservative game profile/display domain.
export interface PressureBoundary {
 heightKm:number|null;displayHeightKm:number;heightLimited:boolean;
 kind:'hidden'|'finite'|'unbounded';
}
/** Isothermal hydrostatic profile with g(r)=g0(R/r)^2:
 * log(p0/p)=R/H0 * h/(R+h). A finite level exists only when log(p0/p)<R/H0.
 * Its isothermal tail is not a globally finite-mass atmosphere. Limit the
 * rendered extent instead of presenting a divergent extrapolation as a height. */
export function pressureBoundary(pressure:number,scaleHeightKm:number,radiusMeters=ESCAPE_MODEL_RADIUS,boundaryPressure=BOUNDARY_PRESSURE):PressureBoundary{
 const radiusKm=radiusMeters/1000,limit=radiusKm*MAX_ATMOSPHERE_HEIGHT_RATIO;
 if(pressure<=boundaryPressure||scaleHeightKm<=0)return {heightKm:0,displayHeightKm:0,heightLimited:false,kind:'hidden'};
 const planar=scaleHeightKm*Math.log(pressure/boundaryPressure),denominator=1-planar/radiusKm;
 if(denominator<=0)return {heightKm:null,displayHeightKm:limit,heightLimited:true,kind:'unbounded'};
 const heightKm=planar/denominator;
 return {heightKm,displayHeightKm:Math.min(limit,heightKm),heightLimited:heightKm>limit,kind:'finite'};
}

export interface AtmosphereState {
  deep?:boolean;
  dustMass:number;dustOpticalDepth:number;
  mass:number;temperature:number;molarMass:number;pressure:number;scaleHeightKm:number;
  heightKm:number|null;displayHeightKm:number;boundaryKind:PressureBoundary['kind'];heightLimited:boolean;
  minimumBinding:number;escapeRegime:EscapeRegime;profileValid:boolean;
  species:{id:typeof GASES[number]['id'];mass:number;fraction:number}[];
  color:readonly number[];
  referenceRadiusKm:number;boundaryPressure:number;
}

/** Bulk diagnostics use prognostic layer temperatures when present. The outer
 * visual boundary is still an isothermal approximation using their mole mean. */
export function atmosphereState(state:Float32Array,e:Environment,climate?:ClimateSnapshot|WeatherClimate):AtmosphereState {
  const radius=physicalRadius(e.body),boundaryPressure=e.body?.atmosphere.radiation==='thin-co2-grey'?1e-5:BOUNDARY_PRESSURE;
  const masses=GASES.map(()=>0);let moles=0,thermalMoles=0,minimumBinding=Infinity,dustMass=0,condensateMass=0,sootMass=0;
  for(let p=0;p<state.length;p+=STRIDE) {
    dustMass+=Math.max(0,state[p+F.airborneDust]);sootMass+=Math.max(0,state[p+F.soot]);
    let localMoles=0;
    for(let k=0;k<GASES.length;k++) {
      const mass=Math.max(0,state[p+GASES[k].field]);masses[k]+=mass;localMoles+=mass/GASES[k].molarMass;
      if(mass>0)minimumBinding=Math.min(minimumBinding,bindingParameter(state[p+F.temperature],gravityMultiplier(e),GASES[k].molarMass,radius));
    }
    moles+=localMoles;thermalMoles+=localMoles*Math.max(1,state[p+F.temperature]+273.15);
  }
  const air=climate&&'air' in climate?(climate.airReady?climate.air:undefined):climate?.atmosphere;
  if(air){
    thermalMoles=0;minimumBinding=Infinity;
    const width='ready' in air?AIR_SPECIES:airMassWidth(air);
    for(let q=0;q<air.temperature.length;q++)for(let k=0;k<AIR_GAS_INDICES.length;k++){
      const gas=GASES[k],mass=AIR_GAS_INDICES[k]<width?air.mass[q*width+AIR_GAS_INDICES[k]]:0,n=mass/gas.molarMass;
      thermalMoles+=n*Math.max(1,air.temperature[q]+273.15);
      if(mass>0)minimumBinding=Math.min(minimumBinding,bindingParameter(air.temperature[q],gravityMultiplier(e),gas.molarMass,radius));
    }
  }
  const giant=climate&&'giantReady' in climate?(climate.giantReady?climate.giant:undefined):climate?.giant;
  if(giant&&('ready' in giant?giant.ready:true)){
    masses.fill(0);moles=0;thermalMoles=0;minimumBinding=Infinity;
    const width='ready' in giant?8:deepMassWidth(giant);
    for(let q=0;q<giant.temperature.length;q++){
      for(const [f,k] of [[0,GASES.findIndex(g=>g.id==='hydrogen')],[1,GASES.findIndex(g=>g.id==='helium')],[2,GASES.findIndex(g=>g.id==='ammonia')],[5,0]]){if(f>=width)continue;const gas=GASES[k],mass=giant.mass[q*width+f],n=mass/gas.molarMass;masses[k]+=mass;moles+=n;thermalMoles+=n*(giant.temperature[q]+273.15);if(mass>0)minimumBinding=Math.min(minimumBinding,bindingParameter(giant.temperature[q],gravityMultiplier(e),gas.molarMass,radius));}
      if(width===8)for(const f of [3,4,6,7])condensateMass+=giant.mass[q*width+f];
    }
  }
  const mass=masses.reduce((a,b)=>a+b,0),kelvin=moles>0?thermalMoles/moles:273.15+e.ambient;
  const molarMass=moles>0?mass/moles:0;
  const pressure=(mass+dustMass+sootMass+condensateMass)/(state.length/STRIDE*REFERENCE_COLUMN_MASS)*gravityMultiplier(e);
  const scaleHeightKm=molarMass>0?GAS_CONSTANT*kelvin/(molarMass*EARTH_GRAVITY*gravityMultiplier(e))/1000:0;
  const boundary=pressureBoundary(pressure,scaleHeightKm,radius,boundaryPressure);
  if(!Number.isFinite(minimumBinding))minimumBinding=0;
  const regime=escapeRegime(minimumBinding);
  const species=GASES.map((gas,k)=>({id:gas.id,mass:masses[k],fraction:moles>0?(masses[k]/gas.molarMass)/moles:0}));
  const color=[0,1,2].map(channel=>species.reduce((sum,gas,k)=>sum+gas.fraction*GASES[k].color[channel],0));
  return {deep:e.body?.lowerBoundary.kind==='deep-atmosphere',mass,dustMass,dustOpticalDepth:dustOpticalDepth(dustMass/(state.length/STRIDE)*COLUMN_KG),temperature:kelvin-273.15,molarMass,pressure,scaleHeightKm,heightKm:boundary.heightKm,displayHeightKm:boundary.displayHeightKm,boundaryKind:boundary.kind,heightLimited:boundary.heightLimited,minimumBinding,escapeRegime:regime,profileValid:mass>0&&!boundary.heightLimited&&regime==='jeans-shaped',species,color,referenceRadiusKm:radius/1000,boundaryPressure};
}

/** Player-facing interpretation of the shared spherical profile and loss proxy. */
export function atmosphereReadout(info:AtmosphereState){
 const height=info.boundaryKind==='unbounded'?'유한 경계 없음':info.heightLimited?'표시 상한 '+info.displayHeightKm.toFixed(0)+' km':info.heightKm!.toFixed(1)+' km';
 if(info.deep)return {height,regime:'밀폐된 계산 대기',note:'아래 경계 기압은 계산 대기의 기둥 무게입니다. 물질 경계는 밀폐하며 외곽선은 등온 근사로 압축해 표시합니다.'};
 const regime=info.mass===0?'기체 없음':info.escapeRegime==='weak-binding'?'약한 결합 · 가속 손실 근사':info.escapeRegime==='transition'?'전이 영역 · 가속 손실 근사':'결합 강함 · 가속 손실 근사';
 const note=info.boundaryKind==='unbounded'?'등온 구면식으로 0.01atm 경계를 찾을 수 없습니다. 외곽선은 '+info.displayHeightKm.toFixed(0)+'km 표시 상한입니다.':info.heightLimited?'계산 높이가 기준 반경의 25%를 넘습니다. 외곽선은 '+info.displayHeightKm.toFixed(0)+'km 표시 상한입니다.':info.boundaryKind==='hidden'?'0.01atm 이하의 기체는 외곽선을 표시하지 않습니다.':'1000km 기준 반경의 등온 구면 근사입니다. 화면 높이는 압축합니다.';
 const planetNote=info.referenceRadiusKm!==1000?(info.boundaryKind==='hidden'?'지정한 압력 경계보다 얇은 대기는 외곽선을 표시하지 않습니다.':'행성 정의의 반지름을 사용하는 등온 구면 근사입니다. 얇은 대기의 외곽선은 1 Pa 부근이며 화면 높이는 압축합니다.'):note;
 return {height,regime,note:planetNote};
}
