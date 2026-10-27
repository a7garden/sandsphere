// @ts-nocheck -- immutable pre-optimization fixture; production nominal types may evolve.
// Only import paths differ; normalize them to verify the original captured source SHA-256.
import {AIR_SECONDS,radiationEnergy} from './climateUnits';
/** An external game heat bath, not a Stefan–Boltzmann or greenhouse solver.
 * One column shares a single sensible heat reservoir with its local gas/clouds. */
export const BATH_CONDUCTANCE=.032*28;
export function thermalTarget(ambient:number,_sunlight:number,transmittedLight:number,albedo:number){
 return ambient+absorbedSolarHeat(transmittedLight,albedo,1)/BATH_CONDUCTANCE;
}
/** Exact integration of C dT/dt = K(target-T), for fixed C/target in this substep.
 * expm1 preserves very small exchanges; no overshoot of the bath temperature. */
export function bathHeat(capacity:number,temperature:number,target:number,dt:number){
 if(dt<=0)return 0;
 return capacity*(target-temperature)*-Math.expm1(-Math.max(0,dt)*BATH_CONDUCTANCE/capacity);
}

/** Same solar flux and game-time/column conversion as the layered atmosphere.
 * The simple mode retains an explicit ambient heat bath, separate from light. */
export function absorbedSolarHeat(light:number,albedo:number,dt:number){
 return radiationEnergy(1361*Math.max(0,light)*(1-Math.max(0,Math.min(1,albedo))),Math.max(0,dt)*AIR_SECONDS);
}
