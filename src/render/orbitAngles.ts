/** Aim an orbit camera along a world-space surface normal using the shortest yaw. */
export function orbitAngles(direction:readonly number[],currentAlpha:number){
 const [x,y,z]=direction,length=Math.hypot(x,y,z);
 const yaw=Math.hypot(x,z)>1e-8?Math.atan2(z,x):currentAlpha;
 return {alpha:currentAlpha+Math.atan2(Math.sin(yaw-currentAlpha),Math.cos(yaw-currentAlpha)),beta:Math.max(.12,Math.min(Math.PI-.12,Math.acos(Math.max(-1,Math.min(1,y/(length||1))))))};
}
