// @ts-nocheck -- immutable pre-optimization fixture; production nominal types may evolve.
// Only import paths differ; normalize them to verify the original captured source SHA-256.
import type {PlanetDefinition} from './planetDefinition';
import {DEEP_CP,DEEP_MOLAR} from './giantCloudPhysics';

export const DEEP_LAYERS=12;
/** Applicability limit of the existing fixed-height, constant-gravity column.
 * Admission and persistence share it; extending it requires a geometry model
 * change, rather than a larger serializer-only allowance. */
export const DEEP_MAX_HEIGHT=3e6;
/** Creation-only boundary data. Evolution never reads preset names. */
export interface DeepInitialConditions {
 referenceTemperatureKelvin:number;
 minimumTemperatureKelvin:number;
 jetSpeed:number;
 temperaturePerturbation?:number;
 cloudBands?:boolean;
}
export function defaultDeepInitialConditions(d:PlanetDefinition):DeepInitialConditions {
 return d.preset==='saturn'
  ?{referenceTemperatureKelvin:134,minimumTemperatureKelvin:82,jetSpeed:180,cloudBands:true}
  :{referenceTemperatureKelvin:165,minimumTemperatureKelvin:110,jetSpeed:100,cloudBands:true};
}
/** Shared hydrostatic initialization, in metres and kelvin. This only derives
 * geometry and the initial profile; it never changes any material stock. */
export function deepInitialProfile(d:PlanetDefinition,referenceKelvin:number,minimumKelvin:number){
 if(d.lowerBoundary.kind!=='deep-atmosphere')throw new Error('깊은 대기 정의가 필요합니다.');
 const indices={hydrogen:0,helium:1,ammonia:2,vapor:5} as const;
 const mole=d.atmosphere.composition.map(c=>[indices[c.species as keyof typeof indices],c.moleFraction] as const);
 const mean=mole.reduce((a,[f,x])=>a+x*DEEP_MOLAR[f],0),fraction=DEEP_CP.map((_,f)=>(mole.find(([k])=>k===f)?.[1]??0)*DEEP_MOLAR[f]/mean);
 const gasR=8.314462618/mean,cp=fraction.reduce((a,x,f)=>a+x*DEEP_CP[f]*1000,0),kappa=gasR/cp;
 const bottom=d.lowerBoundary.pressurePa,faces=Array.from({length:DEEP_LAYERS+1},(_,k)=>k===0?0:100*(bottom/100)**((k-1)/(DEEP_LAYERS-1)));
 const middle=faces.slice(1).map((p,k)=>(p+faces[k])*.5),profile=middle.map(p=>Math.max(minimumKelvin,referenceKelvin*(p/d.atmosphere.pressurePa)**kappa));
 const height=new Float64Array(DEEP_LAYERS);let z=0;
 for(let k=DEEP_LAYERS-1;k>=0;k--){const dz=gasR*profile[k]/d.surfaceGravity*Math.log(faces[k+1]/Math.max(1,faces[k]));height[k]=z+dz*.5;z+=dz;}
 return {fraction,faces,middle,profile,height};
}
export function validDeepHeight(height:ArrayLike<number>){return height.length===DEEP_LAYERS&&Array.from(height).every((h,k)=>Number.isFinite(h)&&h>=0&&h<=DEEP_MAX_HEIGHT&&(!k||h<height[k-1]));}
export function deepInitialSupport(d:PlanetDefinition,initial=defaultDeepInitialConditions(d)):{supported:boolean;reason?:string}{
 const {referenceTemperatureKelvin:ref,minimumTemperatureKelvin:floor,jetSpeed,temperaturePerturbation=1}=initial;
 if(![ref,floor,jetSpeed,temperaturePerturbation].every(Number.isFinite)||ref<23.15||floor<23.15||ref>2773.15||floor>2773.15||Math.abs(jetSpeed)>5000||initial.cloudBands!==undefined&&typeof initial.cloudBands!=='boolean')return {supported:false,reason:'깊은 대기 초기 온도·기류가 계산 범위를 벗어났습니다.'};
 const {height,profile}=deepInitialProfile(d,ref,floor);
 if(!validDeepHeight(height))return {supported:false,reason:'깊은 대기의 초기 높이가 고정 중력 기둥 모델의 3,000km 계산 범위를 벗어났습니다.'};
 if(profile.some(t=>t-273.15-4.8*Math.abs(temperaturePerturbation)<-250||t-273.15+4.8*Math.abs(temperaturePerturbation)>2500))return {supported:false,reason:'깊은 대기 초기 온도 분포가 −250~2500°C 계산 범위를 벗어났습니다.'};
 return {supported:true};
}
