/** Shared surface/section diagnostic: kg/cell/game-second, rain/snow phase. */
export const PRECIPITATION_THRESHOLD=1e-6;
export const PRECIPITATION_COLORS={rain:[.08,.66,1],snow:[.86,.55,1]} as const;
export function precipitationOpacity(rate:number){return rate>0?.12+.74*(1-Math.exp(-rate/.025)):0;}
export function precipitationSample(rain:number,snow:number,dt:number){
 rain=rain>PRECIPITATION_THRESHOLD?rain:0;snow=snow>PRECIPITATION_THRESHOLD?snow:0;
 const total=rain+snow;return {intensity:dt>0?precipitationOpacity(total/dt):0,snowFraction:total>0?snow/total:0};
}
