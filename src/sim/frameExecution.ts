import {SimulationClock} from './clock';

export interface FrameActivity {
 paused:boolean;operation:boolean;awaitingCreation:boolean;placementOpen:boolean;modeOpen:boolean;
 busy:boolean;cameraDragging:boolean;
}
/** Camera interaction may defer an expensive surface upload. It never changes
 * the physical clock, the active/background step batch, or orbital motion. */
export function frameExecution(activity:FrameActivity){
 const blocked=activity.operation||activity.awaitingCreation||activity.placementOpen||activity.modeOpen;
 return {calculate:!blocked,motionPaused:activity.paused||blocked,refreshSurface:!activity.busy&&!activity.operation&&!activity.cameraDragging};
}
export function takeFrameSteps(clock:SimulationClock,realDt:number,speed:number,limit:number,activity:FrameActivity){
 if(!frameExecution(activity).calculate){clock.reset();return 0;}
 clock.add(realDt,speed);
 return activity.busy?0:clock.take(limit);
}
/** Once taken from the clock, every step advances the background worlds too.
 * Worlds share no physical state and run in their own solvers, so the active
 * and background steps overlap. Both finish before the next step starts. */
export async function runFrameSteps(count:number,stepActive:()=>Promise<void>,stepBackground:()=>Promise<void>){
 for(let n=0;n<count;n++){
  const [active,background]=await Promise.allSettled([stepActive(),stepBackground()]);
  if(active.status==='rejected')throw active.reason;
  if(background.status==='rejected')throw background.reason;
 }
}
