// @ts-nocheck -- immutable pre-optimization fixture; production nominal types may evolve.
// Only import paths differ; normalize them to verify the original captured source SHA-256.
/** Constant-latent-heat sublimation curve anchored to the CO2 triple point.
 * NIST WebBook: 216.58 K, 5.185 bar, 26.3 kJ/mol at 167 K.
 * https://webbook.nist.gov/cgi/cbook.cgi?ID=C124389&Mask=4
 * This low-pressure model has solid/gas phases; it does not represent liquid CO2. */
export const CO2_MOLAR_MASS=.04401;
export const CO2_TRIPLE_TEMPERATURE=216.58;
export const CO2_TRIPLE_PRESSURE=518500;
export const CO2_SUBLIMATION_HEAT=26.3/CO2_MOLAR_MASS; // kJ/kg
export const CO2_ICE_CP=.85; // same constant cp as the retained CO2 gas approximation
export const CO2_EXCHANGE_SECONDS=30;
export function carbonDioxideSaturationPressure(temperature:number){
 const kelvin=Math.max(1,temperature+273.15);
 return CO2_TRIPLE_PRESSURE*Math.exp(-26300/8.314462618*(1/kelvin-1/CO2_TRIPLE_TEMPERATURE));
}
export function carbonDioxideFrostPoint(partialPressure:number){
 return partialPressure>0?1/(1/CO2_TRIPLE_TEMPERATURE-8.314462618/26300*Math.log(Math.min(CO2_TRIPLE_PRESSURE,partialPressure)/CO2_TRIPLE_PRESSURE))-273.15:-273.15;
}
/** Transfer only a representable Float32 surface amount, never round a
 * deposit above the available donor or remove more than requested. */
export function roundedSurfaceStock(old:number,amount:number,deposit:boolean,float32=true){
 if(!float32)return Math.max(0,deposit?old+amount:old-amount);
 let next=Math.fround(Math.max(0,deposit?old+amount:old-amount));
 if(deposit?next-old>amount:old-next>amount){
  const bits=new Uint32Array(new Float32Array([next]).buffer);
  if(deposit&&bits[0]>0)bits[0]--;else if(!deposit)bits[0]++;
  next=new Float32Array(bits.buffer)[0];
 }
 return Math.max(0,next);
}
