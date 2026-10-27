// @ts-nocheck -- immutable pre-optimization fixture; production nominal types may evolve.
// Only import paths differ; normalize them to verify the original captured source SHA-256.
export interface SphereGrid {
  count: number;
  directions: Float32Array;
  indices: Uint32Array;
  geometry: Float32Array;
  neighbors: Uint32Array;
  distances: Float32Array;
}

export const RADIUS = 4.8;
export const HEIGHT_SCALE = 0.024;
export const NEIGHBORS = 6;
export const INVALID = 0xffffffff;

/** An icosphere has no latitude seam or polar singularity; every edge is reciprocal. */
export function createSphere(subdivisions = 4): SphereGrid {
  const p = (1 + Math.sqrt(5)) / 2;
  const vertices = [
    [-1,p,0],[1,p,0],[-1,-p,0],[1,-p,0],
    [0,-1,p],[0,1,p],[0,-1,-p],[0,1,-p],
    [p,0,-1],[p,0,1],[-p,0,-1],[-p,0,1],
  ].map(v => { const l = Math.hypot(...v); return v.map(x => x / l); });
  let faces = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
  ];
  for (let level = 0; level < subdivisions; level++) {
    const cache = new Map<string, number>();
    const midpoint = (a: number, b: number) => {
      const key = a < b ? a + ':' + b : b + ':' + a;
      const old = cache.get(key);
      if (old !== undefined) return old;
      const v = vertices[a].map((x,k) => (x + vertices[b][k]) / 2);
      const len = Math.hypot(...v);
      const index = vertices.push(v.map(x => x / len)) - 1;
      cache.set(key, index);
      return index;
    };
    faces = faces.flatMap(([a,b,c]) => {
      const ab = midpoint(a,b), bc = midpoint(b,c), ca = midpoint(c,a);
      return [[a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]];
    });
  }
  const count = vertices.length;
  const directions = new Float32Array(vertices.flat());
  const geometry = new Float32Array(count * 4);
  const neighborSets = Array.from({length:count}, () => new Set<number>());
  faces.forEach(([a,b,c]) => {
    neighborSets[a].add(b).add(c);
    neighborSets[b].add(a).add(c);
    neighborSets[c].add(a).add(b);
  });
  const neighbors = new Uint32Array(count * NEIGHBORS).fill(INVALID);
  const distances = new Float32Array(count * NEIGHBORS);
  vertices.forEach(([x,y,z],i) => {
    geometry.set([x,y,z,terrain(x,y,z)], i*4);
    [...neighborSets[i]].sort((a,b) => a-b).forEach((j,k) => {
      neighbors[i*NEIGHBORS+k] = j;
      distances[i*NEIGHBORS+k] =
        Math.hypot(x-vertices[j][0],y-vertices[j][1],z-vertices[j][2])*RADIUS/HEIGHT_SCALE;
    });
  });
  // Babylon's left-handed scene uses clockwise front faces.
  return {count,directions,geometry,neighbors,distances,indices:new Uint32Array(faces.flatMap(([a,b,c])=>[a,c,b]))};
}

function terrain(x:number,y:number,z:number) {
  return 3.5*Math.sin(x*3.1 + z*1.6)*Math.cos(y*3.8 - z*1.8)
    + 1.5*Math.sin(y*7.2 + x*2.0)*Math.cos(z*5.5)
    + 0.5*Math.sin(x*17+y*11-z*9);
}

export function brushWeights(grid:SphereGrid, direction:readonly number[], radius:number) {
  const indices:number[] = [], weights:number[] = [];
  const threshold = Math.cos(radius);
  let sum = 0;
  for(let i=0;i<grid.count;i++) {
    const dot = grid.directions[i*3]*direction[0] + grid.directions[i*3+1]*direction[1]
      + grid.directions[i*3+2]*direction[2];
    if(dot < threshold) continue;
    const w = Math.max(0.04,(dot-threshold)/(1-threshold));
    indices.push(i); weights.push(w); sum += w;
  }
  if (!indices.length) {
    let best=0, bestDot=-2;
    for(let i=0;i<grid.count;i++) {
      const dot=grid.directions[i*3]*direction[0]+grid.directions[i*3+1]*direction[1]+grid.directions[i*3+2]*direction[2];
      if(dot>bestDot) {best=i;bestDot=dot;}
    }
    return [{index:best,weight:1}];
  }
  return indices.map((index,k) => ({index,weight:weights[k]/sum}));
}

/** Discrete rings on the simulation grid. Radius zero always owns one cell,
 * including the twelve pentagons. Each included cell receives the same share. */
export function cellBrushWeights(grid:SphereGrid,center:number,rings:number){
  if(!Number.isInteger(center)||center<0||center>=grid.count)return [];
  const depth=Math.max(0,Math.min(grid.count,Math.floor(rings))),cells=[center],seen=new Set(cells);
  let start=0,end=1;
  for(let ring=0;ring<depth&&start<end;ring++){
    for(let p=start;p<end;p++)for(let k=0;k<NEIGHBORS;k++){
      const index=grid.neighbors[cells[p]*NEIGHBORS+k];
      if(index===INVALID||seen.has(index))continue;
      seen.add(index);cells.push(index);
    }
    start=end;end=cells.length;
  }
  return cells.map(index=>({index,weight:1/cells.length}));
}

/** Screen-space fallback for air tools and stroke spacing, never delivery. */
export function cellBrushAngle(grid:SphereGrid,center:number,rings:number){
  let angle=0,count=0;
  for(let k=0;k<NEIGHBORS;k++){
    const index=grid.neighbors[center*NEIGHBORS+k];if(index===INVALID)continue;
    const chord=grid.distances[center*NEIGHBORS+k]*HEIGHT_SCALE/RADIUS;
    angle+=2*Math.asin(Math.min(1,chord/2));count++;
  }
  return angle/Math.max(1,count)*(rings+.5);
}

/** Walk the closed convex grid from a nearby cell. Used for actual particle
 * contact, rather than depositing into a preselected destination off its path. */
export function nearestCell(grid:SphereGrid,x:number,y:number,z:number,start=0) {
  const dot=(i:number)=>grid.directions[i*3]*x+grid.directions[i*3+1]*y+grid.directions[i*3+2]*z;
  let best=start,score=dot(best);
  for(let step=0;step<grid.count;step++) {
    let next=best;
    for(let k=0;k<NEIGHBORS;k++) {
      const j=grid.neighbors[best*NEIGHBORS+k];if(j===INVALID)continue;
      const value=dot(j);if(value>score+1e-12){score=value;next=j;}
    }
    if(next===best)return best;
    best=next;
  }
  return best;
}
