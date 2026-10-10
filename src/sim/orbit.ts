import type {Environment} from './model';

export const FIXED_SUN=[1,0,0];
export const orbitalPeriod=(distance:number)=>240*Math.pow(distance,1.5);
export const orbitalSun=(angle=0)=>[Math.cos(angle),0,-Math.sin(angle)];
export const solarEnergy=(distance:number)=>1/(distance*distance);
/** Distance follows inverse-square irradiance. Temperature is a game calibration at 18°C/1 AU. */
export function orbitalEnvironment(distance=1,gravity=1):Environment {
  return {orbitDistance:distance,gravity,sunlight:solarEnergy(distance),ambient:291.15/Math.sqrt(distance)-273.15,sun:[...FIXED_SUN]};
}
/** Inverse of the renderer's Rz(tilt) × Ry(spin): solar exposure uses planet-local directions. */
export function localSun(angle:number,tiltDegrees:number,orbitAngle=0) {
  const sun=orbitalSun(orbitAngle);
  const tilt=tiltDegrees*Math.PI/180,c=Math.cos(tilt),s=Math.sin(tilt);
  const x=c*sun[0]+s*sun[1],y=-s*sun[0]+c*sun[1],z=sun[2];
  return [Math.cos(angle)*x-Math.sin(angle)*z,y,Math.sin(angle)*x+Math.cos(angle)*z];
}
