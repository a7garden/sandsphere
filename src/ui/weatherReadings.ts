/** Last completed physical step, retained while paused or making zero-time edits.
 * Transient diagnostics are reset on a planet switch/load, never invented from stock. */
export interface WeatherPulse {dt:number;condensation:number;rain:number;snow:number;rainCells:number;snowCells:number;}
export class WeatherReadings {
 pulse:WeatherPulse|null=null;
 record(dt:number,condensed:Float32Array,precipitated:Float32Array){
  if(dt<=0)return;
  let condensation=0,rain=0,snow=0,rainCells=0,snowCells=0;
  for(let i=0;i<condensed.length;i++){condensation+=condensed[i];rain+=precipitated[i*2];snow+=precipitated[i*2+1];if(precipitated[i*2]>1e-6)rainCells++;if(precipitated[i*2+1]>1e-6)snowCells++;}
  this.pulse={dt,condensation:condensation/dt,rain:rain/dt,snow:snow/dt,rainCells,snowCells};
 }
 reset(){this.pulse=null;}
}
/** Keep weak but real currents distinguishable from a motionless reservoir. */
export function formatFlowSpeed(speed:number){return speed===0?'0.00':speed<.0001?'<0.0001':speed<.01?speed.toFixed(4):speed.toFixed(2);}
