/** Keep an offscreen celestial direction on the viewport edge, including behind the camera. */
export function sceneMarker(x:number,y:number,inFront:boolean,width:number,height:number,inset=28){
 const cx=width/2,cy=height/2,rx=Math.max(1,cx-inset),ry=Math.max(1,cy-inset);
 const dx=x-cx,dy=y-cy,onScreen=inFront&&Math.abs(dx)<=rx&&Math.abs(dy)<=ry;
 if(onScreen)return {x,y,onScreen};
 const scale=Math.max(Math.abs(dx)/rx,Math.abs(dy)/ry);
 if(scale<1e-8)return {x:cx,y:inset,onScreen:false};
 return {x:cx+dx/scale,y:cy+dy/scale,onScreen:false};
}
