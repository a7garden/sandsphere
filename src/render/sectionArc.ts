import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {SphereGrid} from '../sim/sphere';

/** A short, oriented great-circle arc. v is its midpoint; u points from A to B. */
export interface SectionArc {a:Vector3;b:Vector3;u:Vector3;v:Vector3;normal:Vector3;halfRange:number;}
export interface SectionWindow {u:Vector3;v:Vector3;halfRange:number;cells?:ReadonlySet<number>;wholeCells?:boolean;}
/** Keep endpoints on real cells even at the maximum permitted arc length. */
export function snapSectionEndpoint(grid:SphereGrid,anchor:number,requested:number){
  const a=Vector3.FromArray(grid.directions,anchor*3).normalize(),p=Vector3.FromArray(grid.directions,requested*3).normalize();
  let best=anchor,score=-Infinity;
  for(let i=0;i<grid.count;i++)if(i!==anchor){const d=Vector3.FromArray(grid.directions,i*3).normalize();if(Vector3.Dot(a,d)<-.5-1e-7)continue;const dot=Vector3.Dot(p,d);if(dot>score){score=dot;best=i;}}
  return best;
}
export function arcFromCells(grid:SphereGrid,a:number,b:number,previous?:SectionArc){
  const start=Vector3.FromArray(grid.directions,a*3).normalize(),end=Vector3.FromArray(grid.directions,b*3).normalize(),arc=arcFromEndpoints(start,end,previous);
  arc.a=start;arc.b=end;return arc;
}
export function arcFromBasis(u:Vector3,v:Vector3,halfRange:number):SectionArc {
  const h=Math.max(.01,Math.min(Math.PI/3,halfRange)),up=v.normalizeToNew();
  let right=u.subtract(up.scale(Vector3.Dot(u,up)));
  if(right.lengthSquared()<1e-10)right=Vector3.Cross(Math.abs(up.y)>.9?Vector3.Right():Vector3.Up(),up);
  right.normalize();
  return {a:up.scale(Math.cos(h)).subtract(right.scale(Math.sin(h))),b:up.scale(Math.cos(h)).add(right.scale(Math.sin(h))),u:right,v:up,normal:Vector3.Cross(right,up).normalize(),halfRange:h};
}
export function arcFromEndpoints(a:Vector3,b:Vector3,previous?:SectionArc):SectionArc {
  if(!a.asArray().every(Number.isFinite)||!b.asArray().every(Number.isFinite)||a.lengthSquared()<1e-10||b.lengthSquared()<1e-10)throw new Error('Invalid section endpoint');
  const start=a.normalizeToNew(),end=b.normalizeToNew(),angle=Math.acos(Math.max(-1,Math.min(1,Vector3.Dot(start,end))));
  let tangent=end.subtract(start.scale(Vector3.Dot(start,end)));
  if(tangent.lengthSquared()<1e-10)tangent=previous?.u.subtract(start.scale(Vector3.Dot(previous.u,start)))??Vector3.Cross(Math.abs(start.y)>.9?Vector3.Right():Vector3.Up(),start);
  if(tangent.lengthSquared()<1e-10)tangent=Vector3.Cross(Math.abs(start.y)>.9?Vector3.Right():Vector3.Up(),start);
  tangent.normalize();const h=Math.max(.01,Math.min(Math.PI/3,angle/2));
  return arcFromBasis(tangent.scale(Math.cos(h)).subtract(start.scale(Math.sin(h))),start.scale(Math.cos(h)).add(tangent.scale(Math.sin(h))),h);
}
/** Clip to the two radial boundaries before projection; partial end cells stay real cells. */
export function clipSectionWindow(points:Vector3[],window:SectionWindow){
  let result=points;
  for(const plane of [window.u.scale(Math.cos(window.halfRange)).add(window.v.scale(Math.sin(window.halfRange))),window.u.scale(-Math.cos(window.halfRange)).add(window.v.scale(Math.sin(window.halfRange)))]){
    const clipped:Vector3[]=[];
    for(let i=0;i<result.length;i++){const a=result[i],b=result[(i+1)%result.length],da=Vector3.Dot(a,plane),db=Vector3.Dot(b,plane);if(da>=-1e-9)clipped.push(a);if((da<0)!==(db<0))clipped.push(Vector3.Lerp(a,b,da/(da-db)));}
    result=clipped;
  }
  return result;
}
