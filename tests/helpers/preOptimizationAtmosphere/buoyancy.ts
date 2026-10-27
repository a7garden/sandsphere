// @ts-nocheck -- immutable pre-optimization fixture; production nominal types may evolve.
// Only import paths differ; normalize them to verify the original captured source SHA-256.
/** The same density-temperature contrast drives resolved parcel ascent and
 * unresolved free convection at a stationary surface. No fuel labels enter. */
export function buoyancyAcceleration(parcelVirtualKelvin:number,environmentVirtualKelvin:number,gravity:number){
 return Math.max(0,gravity)*(parcelVirtualKelvin-environmentVirtualKelvin)/Math.max(1,environmentVirtualKelvin);
}
/** Bulk boundary-layer closure: wind and buoyancy contribute to exchange speed.
 * This is a conductance diagnostic, not a separately stored kinetic reservoir.
 * The paired heat exchanger pays every joule and cannot overshoot equilibrium. */
export function surfaceExchangeSpeed(wind:number,surfaceKelvin:number,airKelvin:number,height:number,gravity:number){
 const free=Math.max(0,buoyancyAcceleration(surfaceKelvin,airKelvin,gravity))*Math.max(0,height);
 return Math.sqrt(Math.max(1,wind*wind)+free);
}
