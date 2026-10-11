import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {F,STRIDE} from '../sim/model';
import {RADIUS,type SphereGrid} from '../sim/sphere';
import {altitude,columnGeometry,columnColor} from './columnGeometry';
import {precipitationSample} from './precipitation';
import {powderFractions} from './sectionPowder';
import {clipSectionWindow,type SectionWindow} from './sectionArc';

/** Exact intersection of a rendered triangle and the cut plane. */
function sectionHits(points:readonly Vector3[],normal:Vector3,offset:number){
  const hits:{point:Vector3;weights:number[]}[]=[];
  const add=(point:Vector3,weights:number[])=>{if(!hits.some(q=>Vector3.DistanceSquared(point,q.point)<1e-10))hits.push({point,weights});};
  for(let k=0;k<3;k++){const a=points[k],b=points[(k+1)%3],rawA=Vector3.Dot(normal,a)-offset,rawB=Vector3.Dot(normal,b)-offset,da=Math.abs(rawA)<1e-6?0:rawA,db=Math.abs(rawB)<1e-6?0:rawB;
    if(da===0)add(a.clone(),[0,1,2].map(i=>i===k?1:0));
    if(da*db<0){const t=da/(da-db);add(Vector3.Lerp(a,b,t),[0,1,2].map(i=>i===k?1-t:i===(k+1)%3?t:0));}
  }
  return hits.length===2?hits:[];
}
export function triangleSection(points:readonly Vector3[],normal:Vector3,offset:number){return sectionHits(points,normal,offset).map(hit=>hit.point);}
export interface SectionMeshData {positions:number[];normals:number[];colors:number[];data:number[];snowFractions:number[];powders:number[];indices:number[];owners:number[];}
export interface SectionSamples {cellOwners:Uint32Array;baseHeights:Float32Array;solidRadii:Float32Array;mobileWater:Float32Array;triangleVertices?:Uint32Array;bedrockHeights?:Float32Array;}
export function buildSectionMesh(terrain:Float32Array,water:Float32Array,owners:Uint32Array,state:Float32Array,grid:SphereGrid,normal:Vector3,halfWidth:number,precipitation?:Float32Array,precipDt=1/30,samples?:SectionSamples,hideBedrock=false,window?:SectionWindow){
  const output:SectionMeshData={positions:[],normals:[],colors:[],data:[],snowFractions:[],powders:[],indices:[],owners:[]};
  // A selected great-circle plane has height-invariant cell membership.
  // Only the displayed cap is moved to the front of the observation slab.
  const offset=window?0:-halfWidth+.0001,center=normal.scale(offset),facing=normal.scale(-1);
  const tangent=Vector3.Cross(Math.abs(normal.y)>.9?Vector3.Right():Vector3.Up(),normal).normalize(),up=Vector3.Cross(normal,tangent);
  const groundSegments:{x:number;y:number;dx:number;dy:number}[]=[];
  const inner=(p:Vector3,radius:number)=>{const q=p.subtract(center),length=Math.sqrt(Math.max(0,radius*radius-offset*offset));return q.normalize().scale(length).add(center);};
  const emitTriangle=(points:Vector3[],owner:number,kind:number,color:readonly number[],sample=owner)=>{
    const start=output.positions.length/3,temperature=owner>=0?state[sample*STRIDE+F.temperature]:18;
    const sampleRain=owner>=0&&precipitation?precipitationSample(precipitation[owner*2],precipitation[owner*2+1],precipDt):{intensity:0,snowFraction:0};
    const fractions=owner>=0&&kind===1?powderFractions(state,sample):Array(12).fill(0);
    for(const p of points){output.positions.push(...p.asArray());output.normals.push(...facing.asArray());output.colors.push(...color,1);output.data.push(temperature,owner,kind,sampleRain.intensity);output.snowFractions.push(sampleRain.snowFraction);output.powders.push(...fractions);}
    output.indices.push(start,start+1,start+2);output.owners.push(owner);
  };
  const tri=(points:Vector3[],owner:number,kind:number,color:readonly number[],sample=owner)=>{
    if(owner>=0&&window?.cells&&!window.cells.has(owner))return;
    const polygon=owner>=0&&window&&!window.wholeCells?clipSectionWindow(points,window):points;
    for(let i=1;i+1<polygon.length;i++)emitTriangle([polygon[0],polygon[i],polygon[i+1]],owner,kind,color,sample);
  };
  for(let t=0;t<owners.length;t++){
    const sample=owners[t],owner=samples?.cellOwners[sample]??sample,points=[0,1,2].map(k=>Vector3.FromArray(terrain,(t*3+k)*3)),section=sectionHits(points,normal,offset),hits=section.map(h=>h.point);
    if(!hits.length)continue;
    groundSegments.push({x:Vector3.Dot(hits[0],tangent),y:Vector3.Dot(hits[0],up),dx:Vector3.Dot(hits[1].subtract(hits[0]),tangent),dy:Vector3.Dot(hits[1].subtract(hits[0]),up)});
    // The same edge and endpoint attributes give exactly the same foundation
    // boundary in neighboring faces, even when their material owners differ.
    const bases=[0,1,2].map(k=>RADIUS+altitude((hideBedrock?samples?.bedrockHeights:samples?.baseHeights)?.[samples?.triangleVertices?.[t*3+k]??sample]??(grid.geometry[owner*4+3]+(hideBedrock?state[sample*STRIDE+F.rock]:0))));
    const baseAt=(index:number)=>Math.min(hits[index].length(),section[index].weights.reduce((sum,w,k)=>sum+w*bases[k],0));
    const a=inner(hits[0],baseAt(0)),b=inner(hits[1],baseAt(1)),color=columnColor(state,sample,hideBedrock);
    tri([center,a,b],-1,0,[.22,.25,.27]);tri([a,hits[0],hits[1]],owner,1,color,sample);tri([a,hits[1],b],owner,1,color,sample);
  }
  const bed=(point:Vector3,fallback:number)=>{
    const ray=point.subtract(center),rayLength=ray.length(),x=Vector3.Dot(ray,tangent),y=Vector3.Dot(ray,up);let nearest=Infinity,result:Vector3|undefined;
    // Intersect the cut ray with the actual rendered terrain polyline. The
    // liquid bed then coincides with the solid top instead of a per-cell radius.
    for(const segment of groundSegments){
      const cross=x*segment.dy-y*segment.dx;if(Math.abs(cross)<1e-10)continue;
      const distance=(segment.x*segment.dy-segment.y*segment.dx)/cross,t=(segment.x*y-segment.y*x)/cross;
      if(distance<0||t<-.00001||t>1.00001)continue;
      const error=Math.abs((1-distance)*rayLength);if(error<nearest){nearest=error;result=center.add(ray.scale(Math.min(1,distance)));}
    }
    return result??inner(point,fallback);
  };
  // A water triangle is an actual clipped wet polygon, not an interpolated new cell.
  for(let t=0;t<water.length/9;t++){
    const sample=owners[Math.floor(t/2)],owner=samples?.cellOwners[sample]??sample,points=[0,1,2].map(k=>Vector3.FromArray(water,(t*3+k)*3)),hits=triangleSection(points,normal,offset);
    if(!hits.length||(samples?.mobileWater[sample]??columnGeometry(state,owner,grid).water)<=.0001)continue;
    const solid=samples?.solidRadii[sample]??columnGeometry(state,owner,grid).solidRadius,a=bed(hits[0],solid),b=bed(hits[1],solid);
    tri([a,hits[0],hits[1]],owner,2,[.10,.45,.63],sample);tri([a,hits[1],b],owner,2,[.10,.45,.63],sample);
  }
  return output;
}
