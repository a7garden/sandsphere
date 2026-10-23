import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {F,STRIDE} from '../sim/model';
import {RADIUS,type SphereGrid} from '../sim/sphere';
import {altitude,columnGeometry,columnColor} from './columnGeometry';
import {precipitationSample} from './precipitation';
import {powderFractions} from './sectionPowder';
import {clipSectionWindow,type SectionWindow} from './sectionArc';
import {sectionProfileCurves} from './sectionProfile';
import {clipWater} from './surface';

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
export interface SectionMeshData {positions:number[];normals:number[];colors:number[];data:number[];snowFractions:number[];powders:number[];indices:number[];owners:number[];temperatureSamples:number[];}
export interface SectionSamples {cellOwners:Uint32Array;baseHeights:Float32Array;solidRadii:Float32Array;mobileWater:Float32Array;triangleVertices?:Uint32Array;bedrockHeights?:Float32Array;terrainVertices?:Float32Array;waterVertices?:Float32Array;waterDepths?:Float32Array;}
export function buildSectionMesh(terrain:Float32Array,water:Float32Array,owners:Uint32Array,state:Float32Array,grid:SphereGrid,normal:Vector3,halfWidth:number,precipitation?:Float32Array,precipDt=1/30,samples?:SectionSamples,hideBedrock=false,window?:SectionWindow,rounded=false){
  const output:SectionMeshData={positions:[],normals:[],colors:[],data:[],snowFractions:[],powders:[],indices:[],owners:[],temperatureSamples:[]};
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
    output.indices.push(start,start+1,start+2);output.owners.push(owner);output.temperatureSamples.push(owner>=0?sample:-1);
  };
  const tri=(points:Vector3[],owner:number,kind:number,color:readonly number[],sample=owner)=>{
    if(owner>=0&&window?.cells&&!window.cells.has(owner))return;
    const polygon=owner>=0&&window&&!window.wholeCells?clipSectionWindow(points,window):points;
    for(let i=1;i+1<polygon.length;i++)emitTriangle([polygon[0],polygon[i],polygon[i+1]],owner,kind,color,sample);
  };
  const solids:{hits:[Vector3,Vector3];bases:[Vector3,Vector3];owner:number;sample:number;color:readonly number[]}[]=[];
  for(let t=0;t<owners.length;t++){
    const sample=owners[t],owner=samples?.cellOwners[sample]??sample,points=[0,1,2].map(k=>rounded&&samples?.terrainVertices&&samples.triangleVertices?Vector3.FromArray(samples.terrainVertices,samples.triangleVertices[t*3+k]*3):Vector3.FromArray(terrain,(t*3+k)*3)),section=sectionHits(points,normal,offset),hits=section.map(h=>h.point);
    if(!hits.length)continue;

    // The same edge and endpoint attributes give exactly the same foundation
    // boundary in neighboring faces, even when their material owners differ.
    const bases=[0,1,2].map(k=>RADIUS+altitude((hideBedrock?samples?.bedrockHeights:samples?.baseHeights)?.[samples?.triangleVertices?.[t*3+k]??sample]??(grid.geometry[owner*4+3]+(hideBedrock?state[sample*STRIDE+F.rock]:0))));
    const baseAt=(index:number)=>Math.min(hits[index].length(),section[index].weights.reduce((sum,w,k)=>sum+w*bases[k],0));
    const a=inner(hits[0],baseAt(0)),b=inner(hits[1],baseAt(1)),color=columnColor(state,sample,hideBedrock);
    solids.push({hits:[hits[0],hits[1]],bases:[a,b],owner,sample,color});
  }
  const solidCurves=rounded?sectionProfileCurves(solids.map(s=>s.hits),normal,center,solids.map(s=>s.bases),.22*Math.sqrt(4*Math.PI/grid.count)):[];
  const baseCurves=rounded?sectionProfileCurves(solids.map(s=>s.bases),normal,center):[];
  const steps=rounded?8:1;
  for(let i=0;i<solids.length;i++){
    const {hits,bases,owner,sample,color}=solids[i];let top=rounded?solidCurves[i](0):hits[0],bottom=bases[0];
    for(let k=1;k<=steps;k++){
      const nextTop=rounded?solidCurves[i](k/steps):hits[1];
      let nextBottom=rounded?baseCurves[i](k/steps):bases[1];
      if(nextBottom.subtract(center).length()>nextTop.subtract(center).length())nextBottom=nextTop.clone();
      groundSegments.push({x:Vector3.Dot(top,tangent),y:Vector3.Dot(top,up),dx:Vector3.Dot(nextTop.subtract(top),tangent),dy:Vector3.Dot(nextTop.subtract(top),up)});
      tri([center,bottom,nextBottom],-1,0,[.22,.25,.27]);
      tri([bottom,top,nextTop],owner,1,color,sample);tri([bottom,nextTop,nextBottom],owner,1,color,sample);
      top=nextTop;bottom=nextBottom;
    }
  }
  // A rounded cut has many short edges. Index their angular intervals rather
  // than scanning every edge for every water vertex on each simulation frame.
  const groundIndex=rounded?groundSegments.flatMap(segment=>{
    const start=Math.atan2(segment.x,segment.y);let end=Math.atan2(segment.x+segment.dx,segment.y+segment.dy);
    if(end-start>Math.PI)end-=2*Math.PI;if(end-start< -Math.PI)end+=2*Math.PI;
    return [-2*Math.PI,0,2*Math.PI].map(shift=>({low:Math.min(start,end)+shift,high:Math.max(start,end)+shift,segment}));
  }).sort((a,b)=>a.low-b.low):[];
  const groundAt=(angle:number)=>{
    let low=0,high=groundIndex.length;
    while(low<high){const middle=(low+high)>>>1;if(groundIndex[middle].low<=angle)low=middle+1;else high=middle;}
    return groundIndex.slice(Math.max(0,low-2),low+1).filter(edge=>angle>=edge.low-1e-8&&angle<=edge.high+1e-8).map(edge=>edge.segment);
  };
  const bed=(point:Vector3,fallback:number)=>{
    const ray=point.subtract(center),rayLength=ray.length(),x=Vector3.Dot(ray,tangent),y=Vector3.Dot(ray,up);let nearest=Infinity,result:Vector3|undefined;
    // Intersect the cut ray with the actual rendered terrain polyline. The
    // liquid bed then coincides with the solid top instead of a per-cell radius.
    for(const segment of rounded?groundAt(Math.atan2(x,y)):groundSegments){
      const cross=x*segment.dy-y*segment.dx;if(Math.abs(cross)<1e-10)continue;
      const distance=(segment.x*segment.dy-segment.y*segment.dx)/cross,t=(segment.x*y-segment.y*x)/cross;
      if(distance<0||t<-.00001||t>1.00001)continue;
      const error=Math.abs((1-distance)*rayLength);if(error<nearest){nearest=error;result=center.add(ray.scale(Math.min(1,distance)));}
    }
    return result??inner(point,fallback);
  };
  // Use the continuous hydraulic surface in a flat cut. Globe styling may
  // inset entire wet hexagons or lift facet corners, neither is a real layer.
  const liquidTriangles:{sample:number;points:Vector3[]}[]=[];
  if(rounded&&samples?.waterVertices&&samples.waterDepths&&samples.triangleVertices){
    for(let t=0;t<owners.length;t++){
      const polygon=clipWater([0,1,2].map(k=>{const v=samples.triangleVertices![t*3+k],p=Vector3.FromArray(samples.waterVertices!,v*3);return {x:p.x,y:p.y,z:p.z,depth:samples.waterDepths![v]};}));
      for(let k=1;k+1<polygon.length;k++)liquidTriangles.push({sample:owners[t],points:[polygon[0],polygon[k],polygon[k+1]].map(p=>new Vector3(p.x,p.y,p.z))});
    }
  }else for(let t=0;t<water.length/9;t++){
    const sample=owners[Math.floor(t/2)];
    if((samples?.mobileWater[sample]??columnGeometry(state,sample,grid).water)>.0001)liquidTriangles.push({sample,points:[0,1,2].map(k=>Vector3.FromArray(water,(t*3+k)*3))});
  }
  const liquids:{hits:[Vector3,Vector3];owner:number;sample:number;solid:number}[]=[];
  for(const {sample,points} of liquidTriangles){
    const owner=samples?.cellOwners[sample]??sample,hits=triangleSection(points,normal,offset);
    if(!hits.length)continue;
    liquids.push({hits:[hits[0],hits[1]],owner,sample,solid:samples?.solidRadii[sample]??columnGeometry(state,owner,grid).solidRadius});
  }
  const waterCurves=rounded?sectionProfileCurves(liquids.map(s=>s.hits),normal,center):[];
  for(let i=0;i<liquids.length;i++){
    const {hits,owner,sample,solid}=liquids[i];let top=hits[0],bottom=bed(top,solid);
    for(let k=1;k<=steps;k++){
      const nextTop=rounded?waterCurves[i](k/steps):hits[1],nextBottom=bed(nextTop,solid);
      tri([bottom,top,nextTop],owner,2,[.10,.45,.63],sample);tri([bottom,nextTop,nextBottom],owner,2,[.10,.45,.63],sample);
      top=nextTop;bottom=nextBottom;
    }
  }
  return output;
}
