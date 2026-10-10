const TURN=Math.PI*2;
const wrap=(angle:number)=>((angle%TURN)+TURN)%TURN;

/** A viewing frame independent of the physical planet angle. Resuming stays continuous. */
export class RotationFrame {
 frozen=false;
 physicalAngle=0;
 displayAngle=0;
 private initialized=false;
 update(angle:number){
  if(!this.initialized){this.reset(angle);return;}
  const delta=Math.atan2(Math.sin(angle-this.physicalAngle),Math.cos(angle-this.physicalAngle));
  if(!this.frozen)this.displayAngle=wrap(this.displayAngle+delta);
  this.physicalAngle=angle;
 }
 reset(angle:number){this.physicalAngle=angle;this.displayAngle=angle;this.initialized=true;}
 /** Rotate the sun into the viewing frame, preserving illumination of each physical cell. */
 sun(direction:readonly number[],tiltDegrees:number):readonly [number,number,number]{
  const tilt=tiltDegrees*Math.PI/180,c=Math.cos(tilt),s=Math.sin(tilt);
  const delta=this.displayAngle-this.physicalAngle,cd=Math.cos(delta),sd=Math.sin(delta);
  const x=c*direction[0]+s*direction[1],y=-s*direction[0]+c*direction[1],z=direction[2];
  const rx=cd*x+sd*z,rz=-sd*x+cd*z;
  return [c*rx-s*y,s*rx+c*y,rz];
 }
}
