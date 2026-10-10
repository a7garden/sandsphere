/** Bound 3D pixel cost while leaving DOM text and controls at native resolution. */
export function renderScaling(width:number,height:number,pixelRatio:number){
 const ratio=Math.min(1.6,Math.max(1,pixelRatio));
 return Math.max(1/ratio,Math.sqrt(Math.max(1,width*height)/2_000_000));
}

/** Physics keeps every fixed step; only expensive surface uploads are coalesced. */
export class SurfaceRefreshClock {
 private dirty=false;
 private elapsed=0;
 private immediate=false;
 private previous=-Infinity;
 mark(dt:number){this.dirty=true;this.elapsed+=dt;this.immediate||=dt===0;}
 take(now:number):number|null{
  if(!this.dirty||!this.immediate&&now-this.previous<1000/15)return null;
  const dt=this.elapsed;this.reset();this.previous=now;return dt;
 }
 reset(){this.dirty=false;this.elapsed=0;this.immediate=false;}
}
