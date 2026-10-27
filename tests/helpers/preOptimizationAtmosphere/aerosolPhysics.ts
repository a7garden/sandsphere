// @ts-nocheck -- immutable pre-optimization fixture; production nominal types may evolve.
// Only import paths differ; normalize them to verify the original captured source SHA-256.
/** Effective particle properties for the spherical powder sandbox. The same
 * stress, settling and optical laws apply to mineral dust and carbon fines. */
export interface AerosolMaterial {radius:number;density:number;drag:number;liftThreshold:number;liftCoefficient:number;shortwave:number;longwave:number;singleScatter:number;asymmetry:number;}
export const SOOT:AerosolMaterial={radius:2e-6,density:1500,drag:.003,liftThreshold:.003,liftCoefficient:2e-5,shortwave:1200,longwave:60,singleScatter:.25,asymmetry:.5};
export function particleLiftFlux(material:AerosolMaterial,windSpeed:number,density:number,cover:number){
 return material.liftCoefficient*Math.max(0,Math.max(0,density)*material.drag*windSpeed**2-material.liftThreshold)*Math.exp(-Math.max(0,cover));
}
export function particleSettlingSpeed(material:Pick<AerosolMaterial,'radius'|'density'>,pressure:number,temperature:number,gravity:number){
 const viscosity=1e-5,kelvin=Math.max(53.15,temperature+273.15),path=viscosity/Math.max(.01,pressure)*Math.sqrt(Math.PI*188.9*kelvin/2),kn=path/material.radius;
 const slip=1+kn*(1.257+.4*Math.exp(-1.1/Math.max(1e-30,kn)));
 return Math.min(200,2*material.density*Math.max(0,gravity)*material.radius**2/(9*viscosity)*slip);
}
export function aerosolOptics(material:AerosolMaterial,column:number){
 const tau=Math.max(0,column)*material.shortwave;
 return {absorption:tau*(1-material.singleScatter),scattering:tau*material.singleScatter*(1-material.asymmetry),longwave:Math.max(0,column)*material.longwave};
}
