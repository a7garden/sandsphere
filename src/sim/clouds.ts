import {edgeScale,REFERENCE_EDGE} from './materialPhysics';
import {type SphereGrid} from './sphere';

/** Upper-air wind for the game: broad latitude bands plus day-to-night outflow.
 * This transports cloud stock, rather than moving a decorative cloud texture.
 * It is a circulation approximation, not a momentum/pressure solver.
 */
export function cloudWind(x:number,y:number,z:number,sun:readonly number[],rotationRate=0):readonly number[] {
  const latitude=Math.abs(y);
  const band=latitude<.5?-.55:latitude<.87?.8:-.35;
  const rotation=(rotationRate<0?-1:1)*(.35+Math.min(1.65,Math.abs(rotationRate)*120/(Math.PI*2)));
  const heating=x*sun[0]+y*sun[1]+z*sun[2];
  return [z*band*rotation-(sun[0]-x*heating)*.32,
    -(sun[1]-y*heating)*.32,-x*band*rotation-(sun[2]-z*heating)*.32];
}

/** Bounded outgoing fractions make advection conservative even for large time steps. */
export function cloudEdgeFraction(grid:SphereGrid,i:number,j:number,dt:number,sun:readonly number[],rotationRate=0) {
  const p=i*3,q=j*3,wind=cloudWind(grid.directions[p],grid.directions[p+1],grid.directions[p+2],sun,rotationRate);
  const dx=grid.directions[q]-grid.directions[p],dy=grid.directions[q+1]-grid.directions[p+1],dz=grid.directions[q+2]-grid.directions[p+2];
  const alignment=(wind[0]*dx+wind[1]*dy+wind[2]*dz)/Math.max(1e-6,Math.hypot(dx,dy,dz));
  let distance=REFERENCE_EDGE;for(let k=0;k<6;k++)if(grid.neighbors[i*6+k]===j){distance=grid.distances[i*6+k];break;}
  return dt*(.035*edgeScale(distance)+Math.max(0,alignment)*.85*REFERENCE_EDGE/distance);
}

export const CLOUD_COOLING=12;
export const RAIN_THRESHOLD=.18;
export const SNOW_THRESHOLD=.10;
