import {INVALID,NEIGHBORS,type SphereGrid} from '../sim/sphere';

/** Refine only the renderer. Saved worlds retain the same conservative simulation grid. */
export function refineSurface(grid:SphereGrid,levels=1) {
  const vertices:number[][]=[];
  const parents:number[][]=[];
  for(let i=0;i<grid.count;i++) {
    vertices.push([...grid.directions.slice(i*3,i*3+3)]);
    parents.push([i,i]);
  }
  const cache=new Map<string,number>();
  function middle(a:number,b:number) {
    const key=a<b?a+':'+b:b+':'+a;
    const cached=cache.get(key);if(cached!==undefined)return cached;
    const v=vertices[a].map((value,k)=>(value+vertices[b][k])/2);
    const length=Math.hypot(...v),index=vertices.length;
    vertices.push(v.map(value=>value/length));parents.push([a,b]);cache.set(key,index);return index;
  }
  let indices=Array.from(grid.indices);
  for(let level=0;level<levels;level++) {
    const refined:number[]=[];
    for(let p=0;p<indices.length;p+=3) {
      const a=indices[p],b=indices[p+1],c=indices[p+2];
      const ab=middle(a,b),bc=middle(b,c),ca=middle(c,a);
      refined.push(a,ab,ca,b,bc,ab,c,ca,bc,ab,bc,ca);
    }
    indices=refined;
  }
  const adjacent=Array.from({length:vertices.length},()=>new Set<number>());
  for(let p=0;p<indices.length;p+=3)for(let k=0;k<3;k++){const a=indices[p+k],b=indices[p+(k+1)%3];adjacent[a].add(b);adjacent[b].add(a);}
  const neighbors=new Int32Array(vertices.length*6).fill(-1);
  adjacent.forEach((list,i)=>neighbors.set([...list],i*6));
  return {neighbors,count:vertices.length,directions:new Float32Array(vertices.flat()),
    indices:new Uint32Array(indices),parents:new Uint32Array(parents.flat())};
}

/** Extend the adjacent free surface below dry terrain. Interpolating nonnegative
 * stock alone paints almost every mixed triangle blue, producing sawtooth coasts.
 * This signed field is render-only; it never redistributes the stored water. */
export function shorelineDepths(grid:SphereGrid,heights:Float32Array,water:Float32Array) {
  const depth=new Float32Array(grid.count);
  for(let i=0;i<grid.count;i++) {
    if(water[i]>=.035){depth[i]=water[i];continue;}
    let head=0,weight=0;
    for(let k=0;k<NEIGHBORS;k++) {
      const j=grid.neighbors[i*NEIGHBORS+k];
      if(j===INVALID||water[j]<.035)continue;
      const w=1/Math.max(.001,grid.distances[i*NEIGHBORS+k]);
      head+=(heights[j]+water[j])*w;weight+=w;
    }
    depth[i]=weight?Math.min(water[i],head/weight-heights[i]):water[i]-.25;
  }
  return depth;
}

export interface WetVertex {x:number;y:number;z:number;depth:number;ice?:number;}
/** March each triangle against the wet/dry boundary; no alpha haze along the shore. */
export function clipWater(vertices:WetVertex[],threshold=0.035) {
  const polygon:WetVertex[]=[];
  let previous=vertices[vertices.length-1];
  for(const current of vertices) {
    const wasWet=previous.depth>=threshold,isWet=current.depth>=threshold;
    if(wasWet!==isWet) {
      const t=(threshold-previous.depth)/(current.depth-previous.depth);
      polygon.push({x:previous.x+(current.x-previous.x)*t,
        y:previous.y+(current.y-previous.y)*t,z:previous.z+(current.z-previous.z)*t,depth:threshold,ice:(previous.ice??0)+((current.ice??0)-(previous.ice??0))*t});
    }
    if(isWet)polygon.push(current);
    previous=current;
  }
  return polygon;
}


/** Round the reconstructed shoreline in render space. Smooth bed and depth
 * together so a constant hydraulic head remains constant; simulation is untouched. */
export function softenShore(heights:Float32Array,depths:Float32Array,neighbors:Int32Array,scratchHeight:Float32Array,scratchDepth:Float32Array){
 for(let pass=0;pass<5;pass++){
  for(let i=0;i<heights.length;i++){
   let h=0,d=0,count=0;
   for(let k=0;k<6;k++){const j=neighbors[i*6+k];if(j<0)continue;h+=heights[j];d+=depths[j];count++;}
   const weight=.6*Math.max(0,1-Math.abs(depths[i]-.035)/1.5);
   scratchHeight[i]=heights[i]+(h/Math.max(1,count)-heights[i])*weight;
   scratchDepth[i]=depths[i]+(d/Math.max(1,count)-depths[i])*weight;
  }
  heights.set(scratchHeight);depths.set(scratchDepth);
 }
}

/** Dual icosphere: one pentagon/hexagon per simulation cell. The internal fans
 * share a cell normal and palette, so no triangular confetti or drawn grid lines. */
export function dualSurface(grid:SphereGrid,refinement=0){
 const refined=refinement>0?refineSurface(grid,refinement):null,primal=refined??grid;
 const base=primal.count,count=base+primal.indices.length/3,directions=new Float32Array(count*3),parents=new Uint32Array(count*2),third=new Int32Array(count).fill(-1);
 directions.set(primal.directions);const around:number[][]=Array.from({length:base},()=>[]);
 for(let i=0;i<base;i++)parents.set(refined?refined.parents.subarray(i*2,i*2+2):[i,i],i*2);
 for(let f=0;f<primal.indices.length/3;f++){
  const ids=[primal.indices[f*3],primal.indices[f*3+1],primal.indices[f*3+2]],v=base+f;
  let x=0,y=0,z=0;for(const i of ids){x+=primal.directions[i*3];y+=primal.directions[i*3+1];z+=primal.directions[i*3+2];around[i].push(v);}
  const r=Math.hypot(x,y,z);directions.set([x/r,y/r,z/r],v*3);parents.set(ids.slice(0,2),v*2);third[v]=ids[2];
 }
 const indices:number[]=[],owners:number[]=[];
 for(let i=0;i<base;i++){
  const nx=directions[i*3],ny=directions[i*3+1],nz=directions[i*3+2];
  const tx=Math.abs(ny)>.9?0:-nz,ty=Math.abs(ny)>.9?nz:0,tz=Math.abs(ny)>.9?-ny:nx;
  const bx=ny*tz-nz*ty,by=nz*tx-nx*tz,bz=nx*ty-ny*tx;
  const angle=(v:number)=>Math.atan2(directions[v*3]*bx+directions[v*3+1]*by+directions[v*3+2]*bz,directions[v*3]*tx+directions[v*3+1]*ty+directions[v*3+2]*tz);
  const polygon=around[i].sort((a,b)=>angle(a)-angle(b));
  for(let k=0;k<polygon.length;k++){indices.push(i,polygon[(k+1)%polygon.length],polygon[k]);owners.push(i);}
 }
 const sets=Array.from({length:count},()=>new Set<number>());
 for(let p=0;p<indices.length;p+=3)for(let k=0;k<3;k++){const a=indices[p+k],b=indices[p+(k+1)%3];sets[a].add(b);sets[b].add(a);}
 const neighbors=new Int32Array(count*6).fill(-1);sets.forEach((set,i)=>neighbors.set([...set],i*6));
 return {count,tileCount:base,directions,parents,third,indices:new Uint32Array(indices),neighbors,owners:new Uint32Array(owners)};
}

/** Low-poly presentation owns complete mesh faces. Classification and tint are
 * constant on a face, and the shore uses its existing edges, never cut points.
 * Lifting only submerged render vertices above their bed avoids a second curved
 * coast caused by depth testing against the ground. Simulation stock is untouched. */
export function facetWater(vertices:WetVertex[],groundRadii:readonly number[],threshold=.035){
 const depth=vertices.reduce((sum,v)=>sum+v.depth,0)/vertices.length;
 if(depth<threshold)return [];
 const ice=vertices.reduce((sum,v)=>sum+(v.ice??0),0)/vertices.length;
 return vertices.map((v,i)=>{
  const radius=Math.hypot(v.x,v.y,v.z),scale=Math.max(radius,groundRadii[i]+.008)/radius;
  return {x:v.x*scale,y:v.y*scale,z:v.z*scale,depth,ice};
 });
}
