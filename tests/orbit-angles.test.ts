import {describe,it,expect} from 'vitest';
import {orbitAngles} from '../src/render/orbitAngles';
describe('pin camera orientation',()=>{
 it('faces the selected world direction with the existing orbit camera convention',()=>{
  for(const direction of [[1,2,3],[-2,-1,4],[0,0,-1]]){
   const {alpha,beta}=orbitAngles(direction,0),length=Math.hypot(...direction);
   const camera=[Math.cos(alpha)*Math.sin(beta),Math.cos(beta),Math.sin(alpha)*Math.sin(beta)];
   camera.forEach((v,i)=>expect(v).toBeCloseTo(direction[i]/length,12));
  }
 });
 it('crosses the angle wrap by the short arc instead of rotating a full turn',()=>{
  const yaw=-Math.PI+.1,current=Math.PI-.1;
  expect(orbitAngles([Math.cos(yaw),0,Math.sin(yaw)],current).alpha-current).toBeCloseTo(.2,12);
 });
 it('keeps pole orientations finite and inside the camera limits',()=>{
  expect(orbitAngles([0,1,0],4)).toEqual({alpha:4,beta:.12});
  expect(orbitAngles([0,-1,0],4)).toEqual({alpha:4,beta:Math.PI-.12});
 });
});
