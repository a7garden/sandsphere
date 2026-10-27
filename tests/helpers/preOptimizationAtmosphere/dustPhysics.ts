// @ts-nocheck -- immutable pre-optimization fixture; production nominal types may evolve.
// Only import paths differ; normalize them to verify the original captured source SHA-256.
import {particleLiftFlux,particleSettlingSpeed,type AerosolMaterial} from './aerosolPhysics';
/** Declared monodisperse mineral-dust closure, not a fit to Mars observations.
 * Wind stress lifts a finite surface reservoir; Stokes/Cunningham sedimentation
 * and grey optics couple that same transported mass back to radiation. */
import {SPECIFIC_HEAT} from './thermodynamics';
export const DUST_CP=SPECIFIC_HEAT[26];
export const DUST_RADIUS=1.5e-6; // m
export const DUST_DENSITY=2500; // kg/m³
export const DUST_DRAG=.003;
export const DUST_LIFT_THRESHOLD=.01; // Pa, sensitivity parameter
export const DUST_LIFT_COEFFICIENT=2e-5; // kg/m²/s/Pa, sensitivity parameter
export const DUST_SHORTWAVE_EXTINCTION=600; // m²/kg, prescribed effective optics
export const DUST_LONGWAVE_ABSORPTION=30; // m²/kg
export const DUST_SINGLE_SCATTER_ALBEDO=.92;
export const DUST_ASYMMETRY=.65;
export const DUST:AerosolMaterial={radius:DUST_RADIUS,density:DUST_DENSITY,drag:DUST_DRAG,liftThreshold:DUST_LIFT_THRESHOLD,liftCoefficient:DUST_LIFT_COEFFICIENT,shortwave:DUST_SHORTWAVE_EXTINCTION,longwave:DUST_LONGWAVE_ABSORPTION,singleScatter:DUST_SINGLE_SCATTER_ALBEDO,asymmetry:DUST_ASYMMETRY};
export const dustLiftFlux=(windSpeed:number,density:number,iceCover:number)=>particleLiftFlux(DUST,windSpeed,density,iceCover);
export const dustSettlingSpeed=(pressure:number,temperature:number,gravity:number)=>particleSettlingSpeed(DUST,pressure,temperature,gravity);
export const dustOpticalDepth=(columnKgPerSquareMeter:number)=>Math.max(0,columnKgPerSquareMeter)*DUST_SHORTWAVE_EXTINCTION;
