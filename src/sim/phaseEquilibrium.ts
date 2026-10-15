import {SPECIFIC_HEAT,MATERIAL_ENERGY,MIN_THERMODYNAMIC_TEMPERATURE} from './thermodynamics';
import {saturationPressure,WATER_MOLAR_MASS} from './waterPhysics';

/** Solve a continuous, monotone branch of H(T). Phase plateaus are handled by
 * the caller before selecting a branch. Never hide an out-of-range energy by
 * clamping temperature or crediting an unexplained numerical heat source. */
export function solveEnthalpy<T extends {energy:number}>(at:(temperature:number)=>T,target:number,lo:number,hi:number,initial:number){
 const tolerance=1e-11*Math.max(1,Math.abs(target));
 if(target<at(lo).energy-tolerance||target>at(hi).energy+tolerance)throw new Error('상평형 에너지가 계산 범위를 벗어났습니다.');
 let temperature=Math.max(lo,Math.min(hi,initial)),value=at(temperature);
 for(let n=0;n<12;n++){
  value=at(temperature);const error=value.energy-target;
  if(Math.abs(error)<=tolerance)return {temperature,value};
  if(error>0)hi=temperature;else lo=temperature;
  const epsilon=Math.min(.01,(hi-lo)/4),left=Math.max(lo,temperature-epsilon),right=Math.min(hi,temperature+epsilon);
  const derivative=(at(right).energy-at(left).energy)/(right-left),candidate=temperature-error/derivative;
  temperature=Number.isFinite(candidate)&&candidate>lo&&candidate<hi?candidate:(lo+hi)/2;
 }
 for(let n=0;n<40;n++){
  temperature=(lo+hi)/2;value=at(temperature);
  if(Math.abs(value.energy-target)<=tolerance)return {temperature,value};
  if(value.energy>target)hi=temperature;else lo=temperature;
 }
 temperature=(lo+hi)/2;return {temperature,value:at(temperature)};
}

const vapor=9,liquid=16,ice=17;
export type CondensateClosure=(total:number,saturated:number)=>number;
const homogeneous:CondensateClosure=(total,saturated)=>Math.max(0,total-saturated);

/** One water/enthalpy law for stored layers and lifted diagnostic parcels.
 * A subgrid moisture closure may supply condensate; it cannot supply water or
 * heat. Both phases use the shared material table, including the 0°C plateau. */
export function waterEquilibrium(dryCapacity:number,dryMoles:number,water:number,enthalpy:number,pressure:number,potential:number,
 minTemperature=MIN_THERMODYNAMIC_TEMPERATURE,maxTemperature=2500,condensate:CondensateClosure=homogeneous){
 const at=(t:number,frozen=t<0)=>{
  // Both sides of the melting plateau share the same vapor stock. The two
  // empirical pressure fits differ slightly at 0°C; that is not latent heat.
  const es=saturationPressure(t,frozen&&t<0?'ice':'water'),saturated=es>=pressure?Infinity:WATER_MOLAR_MASS*dryMoles*es/(pressure-es),
   cloud=Math.max(0,Math.min(water,condensate(water,saturated))),v=water-cloud,l=frozen?0:cloud,i=frozen?cloud:0,
   capacity=dryCapacity+v*SPECIFIC_HEAT[vapor]+l*SPECIFIC_HEAT[liquid]+i*SPECIFIC_HEAT[ice],
   phase=v*MATERIAL_ENERGY[vapor]+i*MATERIAL_ENERGY[ice];
  return {temperature:t,vapor:v,liquid:l,ice:i,energy:capacity*t+phase+potential};
 };
 const dryTemperature=(enthalpy-water*MATERIAL_ENERGY[vapor]-potential)/Math.max(1e-30,dryCapacity+water*SPECIFIC_HEAT[vapor]);
 if(dryTemperature>=minTemperature&&dryTemperature<=maxTemperature){const r=at(dryTemperature);if(r.vapor===water)return r;}
 const cold=at(0,true),warm=at(0,false);
 if(enthalpy>=cold.energy&&enthalpy<=warm.energy){
  const frozen=Math.min(water-warm.vapor,Math.max(0,(warm.energy-enthalpy)/(MATERIAL_ENERGY[liquid]-MATERIAL_ENERGY[ice])));
  return {...warm,liquid:water-warm.vapor-frozen,ice:frozen,energy:enthalpy};
 }
 // Do not evaluate the opposite phase at the edge of a discontinuous branch.
 const frozen=enthalpy<cold.energy,branch=(t:number)=>at(t,frozen),
  result=solveEnthalpy(branch,enthalpy,frozen?minTemperature:0,frozen?0:maxTemperature,dryTemperature);
 return result.value;
}
