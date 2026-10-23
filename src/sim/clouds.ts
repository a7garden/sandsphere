import {edgeScale,REFERENCE_EDGE} from './materialPhysics';
import {type SphereGrid} from './sphere';

/** Legacy single-reservoir atmosphere has no prognostic momentum. Its cloud
 * inventory therefore follows symmetric mixing, like its other gas tracers.
 * Resolved circulation belongs to the layered momentum solver; latitude and
 * rotation alone must not manufacture a wind or a prescribed cloud belt. */
export function cloudEdgeFraction(grid:SphereGrid,i:number,j:number,dt:number) {
  let distance=REFERENCE_EDGE;for(let k=0;k<6;k++)if(grid.neighbors[i*6+k]===j){distance=grid.distances[i*6+k];break;}
  return Math.max(0,dt)*.035*edgeScale(distance);
}

/** Compatibility export: there is no untracked colder reservoir. */
export const CLOUD_COOLING=0;
export const RAIN_THRESHOLD=.18;
export const SNOW_THRESHOLD=.10;
