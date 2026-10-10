import {F,STRIDE,gravityMultiplier,type Environment} from './model';

import {REFERENCE_GAS_MASS} from './waterPhysics';
import {GASES,GAS_CONSTANT,EARTH_GRAVITY,ESCAPE_MODEL_RADIUS,bindingParameter,escapeRegime,type EscapeRegime} from './gases';
export {GASES} from './gases';
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
export function pressureBoundary(pressure:number,scaleHeightKm:number):PressureBoundary{
 const radiusKm=ESCAPE_MODEL_RADIUS/1000,limit=radiusKm*MAX_ATMOSPHERE_HEIGHT_RATIO;
 if(pressure<=BOUNDARY_PRESSURE||scaleHeightKm<=0)return {heightKm:0,displayHeightKm:0,heightLimited:false,kind:'hidden'};
 const planar=scaleHeightKm*Math.log(pressure/BOUNDARY_PRESSURE),denominator=1-planar/radiusKm;
 if(denominator<=0)return {heightKm:null,displayHeightKm:limit,heightLimited:true,kind:'unbounded'};
 const heightKm=planar/denominator;
 return {heightKm,displayHeightKm:Math.min(limit,heightKm),heightLimited:heightKm>limit,kind:'finite'};
}

export interface AtmosphereState {
  mass:number;temperature:number;molarMass:number;pressure:number;scaleHeightKm:number;
  heightKm:number|null;displayHeightKm:number;boundaryKind:PressureBoundary['kind'];heightLimited:boolean;
  minimumBinding:number;escapeRegime:EscapeRegime;profileValid:boolean;
  species:{id:typeof GASES[number]['id'];mass:number;fraction:number}[];
  color:readonly number[];
}

/** A well-mixed, isothermal column model. Surface cells share their temperature with local gas.
 * p₀ ∝ column mass × g; H0 = RT/(Mg); spherical pressure profile at fixed T.
 * Game mass is normalised to the initial N₂ column at 1g, rather than claiming a real planet's kg.
 */
export function atmosphereState(state:Float32Array,e:Environment):AtmosphereState {
  const masses=GASES.map(()=>0);let moles=0,thermalMoles=0,minimumBinding=Infinity;
  for(let p=0;p<state.length;p+=STRIDE) {
    let localMoles=0;
    for(let k=0;k<GASES.length;k++) {
      const mass=Math.max(0,state[p+GASES[k].field]);masses[k]+=mass;localMoles+=mass/GASES[k].molarMass;
      if(mass>0)minimumBinding=Math.min(minimumBinding,bindingParameter(state[p+F.temperature],gravityMultiplier(e),GASES[k].molarMass));
    }
    moles+=localMoles;thermalMoles+=localMoles*Math.max(1,state[p+F.temperature]+273.15);
  }
  const mass=masses.reduce((a,b)=>a+b,0),kelvin=moles>0?thermalMoles/moles:273.15+e.ambient;
  const molarMass=moles>0?mass/moles:0;
  const pressure=mass/(state.length/STRIDE*REFERENCE_COLUMN_MASS)*gravityMultiplier(e);
  const scaleHeightKm=molarMass>0?GAS_CONSTANT*kelvin/(molarMass*EARTH_GRAVITY*gravityMultiplier(e))/1000:0;
  const boundary=pressureBoundary(pressure,scaleHeightKm);
  if(!Number.isFinite(minimumBinding))minimumBinding=0;
  const regime=escapeRegime(minimumBinding);
  const species=GASES.map((gas,k)=>({id:gas.id,mass:masses[k],fraction:moles>0?(masses[k]/gas.molarMass)/moles:0}));
  const color=[0,1,2].map(channel=>species.reduce((sum,gas,k)=>sum+gas.fraction*GASES[k].color[channel],0));
  return {mass,temperature:kelvin-273.15,molarMass,pressure,scaleHeightKm,heightKm:boundary.heightKm,displayHeightKm:boundary.displayHeightKm,boundaryKind:boundary.kind,heightLimited:boundary.heightLimited,minimumBinding,escapeRegime:regime,profileValid:mass>0&&!boundary.heightLimited&&regime==='jeans-shaped',species,color};
}

/** Player-facing interpretation of the shared spherical profile and loss proxy. */
export function atmosphereReadout(info:AtmosphereState){
 const height=info.boundaryKind==='unbounded'?'유한 경계 없음':info.heightLimited?'표시 상한 '+info.displayHeightKm.toFixed(0)+' km':info.heightKm!.toFixed(1)+' km';
 const regime=info.mass===0?'기체 없음':info.escapeRegime==='weak-binding'?'약한 결합 · 가속 손실 근사':info.escapeRegime==='transition'?'전이 영역 · 가속 손실 근사':'결합 강함 · 가속 손실 근사';
 const note=info.boundaryKind==='unbounded'?'등온 구면식으로 0.01atm 경계를 찾을 수 없습니다. 외곽선은 '+info.displayHeightKm.toFixed(0)+'km 표시 상한입니다.':info.heightLimited?'계산 높이가 기준 반경의 25%를 넘습니다. 외곽선은 '+info.displayHeightKm.toFixed(0)+'km 표시 상한입니다.':info.boundaryKind==='hidden'?'0.01atm 이하의 기체는 외곽선을 표시하지 않습니다.':'1000km 기준 반경의 등온 구면 근사입니다. 화면 높이는 압축합니다.';
 return {height,regime,note};
}
