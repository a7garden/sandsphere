import {Vector3} from '@babylonjs/core/Maths/math.vector';

/** Shape-preserving radial interpolation for the display-only cut. Shared
 * endpoints share a tangent; peaks flatten instead of overshooting into spikes.
 * Disconnected shorelines never borrow tangents across dry gaps. */
export function sectionProfileCurves(segments:readonly (readonly [Vector3,Vector3])[],normal:Vector3,center:Vector3,bases?:readonly (readonly [Vector3,Vector3])[],rounding=0):((t:number)=>Vector3)[]{
  const u=Vector3.Cross(Math.abs(normal.y)>.9?Vector3.Right():Vector3.Up(),normal).normalize(),v=Vector3.Cross(normal,u);
  type Side={span:number;slope:number};
  type Node={left?:Side;right?:Side};
  const nodes=new Map<string,Node>();
  const key=(p:Vector3)=>p.asArray().map(x=>Math.round(x*1e5)).join(',');
  const node=(p:Vector3)=>{const k=key(p);let n=nodes.get(k);if(!n){n={};nodes.set(k,n);}return n;};
  const foundation=bases?sectionProfileCurves(bases,normal,center):undefined;
  const curves=segments.map(([a,b],i)=>{
    const ra=a.subtract(center),rb=b.subtract(center),angle=Math.atan2(Vector3.Dot(ra,u),Vector3.Dot(ra,v));
    let delta=Math.atan2(Vector3.Dot(rb,u),Vector3.Dot(rb,v))-angle;
    if(delta>Math.PI)delta-=2*Math.PI;if(delta< -Math.PI)delta+=2*Math.PI;
    const r0=ra.length()-(bases?bases[i][0].subtract(center).length():0),r1=rb.length()-(bases?bases[i][1].subtract(center).length():0),n0=node(a),n1=node(b),span=Math.abs(delta);
    if(span>1e-8){const side={span,slope:(r1-r0)/delta};if(delta>0){n0.right=side;n1.left=side;}else {n0.left=side;n1.right=side;}}
    return {a,b,angle,delta,r0,r1,n0,n1};
  });
  const tangent=({left,right}:Node)=>{
    if(!left||!right)return (left??right)?.slope??0;
    if(left.slope*right.slope<=0)return 0;
    const w1=2*right.span+left.span,w2=right.span+2*left.span;
    return (w1+w2)/(w1/left.slope+w2/right.slope);
  };
  const depths=curves.map(c=>{
    const m0=tangent(c.n0)*c.delta,m1=tangent(c.n1)*c.delta;
    return (t:number)=>{
      const t2=t*t,t3=t2*t;
      return Math.max(Math.min(c.r0,c.r1),Math.min(Math.max(c.r0,c.r1),(2*t3-3*t2+1)*c.r0+(t3-2*t2+t)*m0+(-2*t3+3*t2)*c.r1+(t3-t2)*m1));
    };
  });
  const intervals=curves.flatMap((c,i)=>Math.abs(c.delta)<1e-8?[]:[-2*Math.PI,0,2*Math.PI].map(shift=>({i,start:Math.min(c.angle,c.angle+c.delta)+shift,end:Math.max(c.angle,c.angle+c.delta)+shift,shift}))).sort((a,b)=>a.start-b.start);
  const sample=(angle:number,fallback:number)=>{
    let low=0,high=intervals.length;
    while(low<high){const middle=(low+high)>>>1;if(intervals[middle].start<=angle)low=middle+1;else high=middle;}
    const interval=intervals[low-1];if(!interval||angle>interval.end+1e-8)return fallback;
    const c=curves[interval.i];return depths[interval.i](Math.max(0,Math.min(1,(angle-interval.shift-c.angle)/c.delta)));
  };
  return curves.map((c,i)=>(t:number)=>{
    if(!rounding&&t<=0)return c.a.clone();if(!rounding&&t>=1)return c.b.clone();
    const angle=c.angle+c.delta*t,depth=depths[i](t);
    // A small symmetric footprint prevents tightly clustered triangle vertices
    // from leaving a needle tip. Only the displayed thickness is reconstructed.
    const rounded=rounding?(sample(angle-rounding,depth)+4*sample(angle-rounding/2,depth)+6*depth+4*sample(angle+rounding/2,depth)+sample(angle+rounding,depth))/16:depth;
    const radius=rounded+(foundation?foundation[i](t).subtract(center).length():0);
    return center.add(u.scale(Math.sin(angle)*radius)).add(v.scale(Math.cos(angle)*radius));
  });
}
