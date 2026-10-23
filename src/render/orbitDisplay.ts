import {orbitalPeriod} from '../sim/orbit';
import type {Snapshot} from '../sim/model';

const delta=(a:number,b:number)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
export type MotionSnapshot=Pick<Snapshot,'time'|'environment'|'spin'|'paused'>;
/** Predict between solver snapshots, then gently correct the display only. */
export class OrbitDisplay {
 angle:number;spin:number;
 private time:number;private age=0;
 constructor(snapshot:MotionSnapshot){this.angle=snapshot.environment.orbitAngle??0;this.spin=snapshot.spin?.angle??0;this.time=snapshot.time;}
 update(snapshot:MotionSnapshot,dt:number,speed:number){
  const changed=snapshot.time!==this.time;
  if(changed){this.time=snapshot.time;this.age=0;}else this.age=Math.min(.25,this.age+dt);
  if(snapshot.paused){if(changed){this.angle=snapshot.environment.orbitAngle??0;this.spin=snapshot.spin?.angle??0;}return;}
  const elapsed=snapshot.paused?0:this.age*speed,spin=snapshot.spin;
  const orbitRate=Math.PI*2/orbitalPeriod(snapshot.environment.orbitDistance??1,snapshot.environment.body),spinRate=spin?.running?Math.PI*2/(spin.period??120):0;
  const angle=(snapshot.environment.orbitAngle??0)+elapsed*orbitRate;
  const rotation=(spin?.angle??0)+elapsed*spinRate;
  // Integrate every frame, then correct phase. Position-only easing slows down
  // between coarse samples and accelerates abruptly at each new sample.
  if(!snapshot.paused){this.angle+=Math.max(0,dt)*speed*orbitRate;this.spin+=Math.max(0,dt)*speed*spinRate;}
  const blend=1-Math.exp(-Math.max(0,dt)/.18);
  this.angle+=delta(angle,this.angle)*blend;if(spin?.running)this.spin+=delta(rotation,this.spin)*blend;
 }
}
