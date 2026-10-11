import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {F,STRIDE,solidHeight,gravityMultiplier,type Environment,type SurfaceMaterial} from './model';
import {RADIUS,HEIGHT_SCALE,nearestCell,type SphereGrid} from './sphere';
export interface FallingGrain {position:Vector3;velocity:Vector3;index:number;material:SurfaceMaterial;amount:number;size:number;age:number;spin:number;land:(i:number,mass:number)=>void;}
export function physicalContact(state:Float32Array,i:number,grid:SphereGrid){
  const p=i*STRIDE,water=Math.max(0,state[p+F.water]-Math.min(1.2,state[p+F.soil]*.12));
  return RADIUS+(solidHeight(state,i,grid)+water)*HEIGHT_SCALE;
}
/** The single owner of grain motion. No camera, scene, render heights or frame time. */
export function advanceFalling(grains:FallingGrain[],grid:SphereGrid,state:Float32Array,dt:number,e:Environment){
  if(dt<=0)return 0;let escaped=0,write=grains.length;
  const gravity=12*gravityMultiplier(e)*RADIUS*RADIUS;
  for(let n=grains.length-1;n>=0;n--){
    const g=grains[n],r=g.position.length();g.age+=dt;
    const acceleration=-gravity/(r*r*r)*dt;
    g.velocity.x+=g.position.x*acceleration;g.velocity.y+=g.position.y*acceleration;g.velocity.z+=g.position.z*acceleration;
    g.position.x+=g.velocity.x*dt;g.position.y+=g.velocity.y*dt;g.position.z+=g.velocity.z*dt;
    const radius=g.position.length(),specificEnergy=g.velocity.lengthSquared()/2-gravity/radius;
    if(radius>RADIUS*2.1&&Vector3.Dot(g.position,g.velocity)>0&&specificEnergy>0){escaped+=g.amount;continue;}
    g.index=nearestCell(grid,g.position.x,g.position.y,g.position.z,g.index);
    const floor=physicalContact(state,g.index,grid);
    if(radius<=floor){
      if(g.amount>0)g.land(g.index,g.amount);
      if(g.material==='water'&&g.amount>0){const normal=g.position.normalizeToNew();g.position=normal.scale(floor+.015);g.velocity=g.velocity.subtract(normal.scale(Vector3.Dot(g.velocity,normal))).scale(.2).add(normal.scale(.8));g.amount=0;g.size*=.65;}
      else continue;
    }
    grains[--write]=g;
  }
  // Keep particle and landing order while removing a whole batch in linear time.
  if(write){grains.copyWithin(0,write);grains.length-=write;}
  return escaped;
}
