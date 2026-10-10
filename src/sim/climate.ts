/** An external game heat bath, not a Stefan–Boltzmann or greenhouse solver.
 * One column shares a single sensible heat reservoir with its local gas/clouds. */
export const BATH_CONDUCTANCE=.032*28;
export function thermalTarget(ambient:number,sunlight:number,transmittedLight:number,albedo:number){
 return ambient+72*transmittedLight*(1-albedo)-24*sunlight;
}
/** Exact integration of C dT/dt = K(target-T), for fixed C/target in this substep.
 * expm1 preserves very small exchanges; no overshoot of the bath temperature. */
export function bathHeat(capacity:number,temperature:number,target:number,dt:number){
 if(dt<=0)return 0;
 return capacity*(target-temperature)*-Math.expm1(-Math.max(0,dt)*BATH_CONDUCTANCE/capacity);
}
