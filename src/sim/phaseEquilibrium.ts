import {SPECIFIC_HEAT,MATERIAL_ENERGY,MIN_THERMODYNAMIC_TEMPERATURE} from './thermodynamics';
import {saturationPressure,WATER_MOLAR_MASS} from './waterPhysics';

/** Solve a continuous, monotone branch of H(T). Phase plateaus are handled by
 * the caller before selecting a branch. Never hide an out-of-range energy by
 * clamping temperature or crediting an unexplained numerical heat source. */
export function solveEnthalpy<T extends {energy:number}>(at:(temperature:number)=>T,target:number,lo:number,hi:number,initial:number,relativeTolerance=1e-11){
 const tolerance=relativeTolerance*Math.max(1,Math.abs(target));
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
 temperature=(lo+hi)/2;value=at(temperature);
 if(Math.abs(value.energy-target)>tolerance)throw new Error('상평형 엔탈피 해가 수렴하지 않았습니다.');
 return {temperature,value};
}

const vapor=9,liquid=16,ice=17;
export type CondensateClosure=(total:number,saturated:number)=>number;
const homogeneous:CondensateClosure=(total,saturated)=>Math.max(0,total-saturated);

function waterState(dryCapacity:number,water:number,potential:number,t:number,frozen:boolean,condensed:number){
 const cloud=Math.max(0,Math.min(water,condensed)),v=water-cloud,l=frozen?0:cloud,i=frozen?cloud:0,
  capacity=dryCapacity+v*SPECIFIC_HEAT[vapor]+l*SPECIFIC_HEAT[liquid]+i*SPECIFIC_HEAT[ice],
  phase=v*MATERIAL_ENERGY[vapor]+i*MATERIAL_ENERGY[ice];
 return {temperature:t,vapor:v,liquid:l,ice:i,energy:capacity*t+phase+potential};
}

export function waterStateAtTemperature(dryCapacity:number,dryMoles:number,water:number,pressure:number,potential:number,t:number,frozen=t<0,condensate:CondensateClosure=homogeneous){
  // The shared pressure curve joins both phases at the model's 0°C melting
  // point, so the latent plateau has the same vapor stock at either end.
  const es=saturationPressure(t,frozen?'ice':'water'),saturated=es>=pressure?Infinity:WATER_MOLAR_MASS*dryMoles*es/(pressure-es);
  return waterState(dryCapacity,water,potential,t,frozen,condensate(water,saturated));
}

/** Near pure steam, a finite latent interval can be narrower than one T
 * quantum. Saturated stock is still a continuous coordinate: x=s/(s+water).
 * Invert the forward partial pressure, avoiding subtraction of nearly equal
 * total and saturation pressures. Each phase stays within its own domain. */
function stockEquilibrium(dryCapacity:number,dryMoles:number,water:number,enthalpy:number,pressure:number,potential:number,
 minTemperature:number,maxTemperature:number,condensate:CondensateClosure,frozen:boolean){
 const lo=frozen?minTemperature:Math.max(0,minTemperature),hi=Math.min(frozen?0:maxTemperature,647.096-273.15);
 if(water<=0||pressure<=0||lo>hi)return;
 const es=(t:number)=>saturationPressure(t,frozen?'ice':'water'),lowPressure=es(lo),highPressure=es(hi),dry=WATER_MOLAR_MASS*dryMoles;
 if(pressure<lowPressure||dryMoles===0&&pressure>highPressure)return;
 const xAtPressure=(p:number)=>p>=pressure?1:dry*p/(water*(pressure-p)+dry*p),
  lower=dryMoles===0?0:xAtPressure(lowPressure),upper=dryMoles===0?1:xAtPressure(highPressure);
 const at=(x:number)=>{
  const saturated=x===1?Infinity:water*x/(1-x),p=dryMoles===0?pressure:pressure/(1+dry/saturated);
  let a=lo,b=hi;
  for(let n=0;n<56;n++){const mid=(a+b)/2;if(es(mid)<p)a=mid;else b=mid;}
  return waterState(dryCapacity,water,potential,(a+b)/2,frozen,condensate(water,saturated));
 };
 // The closure returns condensed stock at the scale of total water. Taking
 // water-condensate cannot resolve a tiny vapor stock below that mass ULP;
 // its enthalpy quantum is that ULP times the material enthalpy difference.
 // Include the temperature/enthalpy arithmetic at the same inventory scale.
 // This bounds floating-point resolution, without replacing computed heat.
 const condensed=frozen?ice:liquid,temperatureScale=Math.max(273.15,Math.abs(lo),Math.abs(hi)),
  energyScale=Math.abs(potential)+dryCapacity*temperatureScale+water*(Math.abs(MATERIAL_ENERGY[vapor])+Math.abs(MATERIAL_ENERGY[condensed])+(SPECIFIC_HEAT[vapor]+SPECIFIC_HEAT[condensed])*temperatureScale),
  a=at(lower),b=at(upper),scale=Math.max(1,Math.abs(enthalpy)),tolerance=Math.max(1e-14*scale,4*Number.EPSILON*energyScale);
 if(enthalpy<a.energy-tolerance||enthalpy>b.energy+tolerance)return;
 if(Math.abs(enthalpy-a.energy)<=tolerance)return a;
 if(Math.abs(enthalpy-b.energy)<=tolerance)return b;
 if(dryMoles===0){
  // T is constant across the pure-material latent interval, so its finite
  // condensed mass follows from the exact linear material enthalpies.
  const fraction=(enthalpy-a.energy)/(b.energy-a.energy),cloud=a.liquid+a.ice,clear=b.liquid+b.ice;
  return waterState(dryCapacity,water,potential,a.temperature,frozen,cloud+fraction*(clear-cloud));
 }
 return solveEnthalpy(at,enthalpy,lower,upper,(lower+upper)/2,tolerance/scale).value;
}

/** One water/enthalpy law for stored layers and lifted diagnostic parcels.
 * A subgrid moisture closure may supply condensate; it cannot supply water or
 * heat. Both phases use the shared material table, including the 0°C plateau. */
export function waterEquilibrium(dryCapacity:number,dryMoles:number,water:number,enthalpy:number,pressure:number,potential:number,
 minTemperature=Math.fround(MIN_THERMODYNAMIC_TEMPERATURE),maxTemperature=Infinity,condensate:CondensateClosure=homogeneous){
 if(!Number.isFinite(pressure))throw new Error('상평형 압력이 유한하지 않습니다.');
 const at=(t:number,frozen=t<0)=>waterStateAtTemperature(dryCapacity,dryMoles,water,pressure,potential,t,frozen,condensate);
 const dryTemperature=(enthalpy-water*MATERIAL_ENERGY[vapor]-potential)/Math.max(1e-30,dryCapacity+water*SPECIFIC_HEAT[vapor]);
 if(dryTemperature>=minTemperature&&dryTemperature<=maxTemperature){const r=at(dryTemperature);if(r.vapor===water)return r;}
 const cold=at(0,true),warm=at(0,false);
 if(enthalpy>=cold.energy&&enthalpy<=warm.energy){
  const frozen=Math.min(water-warm.vapor,Math.max(0,(warm.energy-enthalpy)/(MATERIAL_ENERGY[liquid]-MATERIAL_ENERGY[ice])));
  return {...warm,liquid:water-warm.vapor-frozen,ice:frozen,energy:enthalpy};
 }
 // Do not evaluate the opposite phase at the edge of a discontinuous branch.
 const upper=Number.isFinite(maxTemperature)?maxTemperature:Math.max(1,(enthalpy-potential-water*MATERIAL_ENERGY[ice])/Math.max(1e-30,dryCapacity+water*Math.min(SPECIFIC_HEAT[vapor],SPECIFIC_HEAT[liquid],SPECIFIC_HEAT[ice])));
 const frozen=enthalpy<cold.energy,branch=(t:number)=>at(t,frozen);
 if(dryMoles===0){
  const result=stockEquilibrium(dryCapacity,dryMoles,water,enthalpy,pressure,potential,minTemperature,maxTemperature,condensate,frozen);
  if(result)return result;
 }
 try{return solveEnthalpy(branch,enthalpy,frozen?minTemperature:0,frozen?0:upper,dryTemperature).value;}
 catch(error){
  const result=stockEquilibrium(dryCapacity,dryMoles,water,enthalpy,pressure,potential,minTemperature,maxTemperature,condensate,frozen)
   ??stockEquilibrium(dryCapacity,dryMoles,water,enthalpy,pressure,potential,minTemperature,maxTemperature,condensate,!frozen);
  if(result)return result;
  throw error;
 }
}
