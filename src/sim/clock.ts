/** One game second has the same integration steps at every speed and on every planet. */
export const PHYSICS_DT=1/30;
export function physicsSteps(elapsed:number):number[] {
  if(elapsed<=0)return [0];
  const count=Math.floor((elapsed+1e-9)/PHYSICS_DT),steps=Array<number>(count).fill(PHYSICS_DT);
  const remainder=elapsed-count*PHYSICS_DT;
  if(remainder>1e-9)steps.push(remainder);
  return steps;
}

/** Keeps unprocessed time rather than dropping it when a GPU frame is slow. */
export class SimulationClock {
  private pending=0;
  add(realSeconds:number,speed:number){this.pending+=Math.max(0,realSeconds)*speed;}
  take(limit=8){const n=Math.min(limit,Math.floor((this.pending+1e-9)/PHYSICS_DT));this.pending-=n*PHYSICS_DT;return n;}
  reset(){this.pending=0;}
  get backlog(){return Math.max(0,this.pending);}
}
