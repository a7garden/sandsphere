import type {PhysicalState} from './physicalState';
import {MATERIAL_ENERGY} from './thermodynamics';
import {capacity,enthalpy,F,STRIDE,solidHeight,type Environment} from './model';
import {consumerTravelHabitat,openSurfaceWater} from './ecology';
import {edgeScale} from './materialPhysics';
import {INVALID,NEIGHBORS,type SphereGrid} from './sphere';

/** Surface water beyond soil's capillary store is a barrier for land animals. */
export function animalLand(water:number,soil:number,molten:number){
 return !openSurfaceWater(water,soil)&&molten<.01;
}

/** One navigation field per guild, rather than a graph search for every animal.
 * Costs measure grid-edge travel, food availability, slope, and grazer danger.
 * Scratch state is rebuilt from the committed world, so saves/retries need no AI clock. */
export class AnimalNavigation {
 readonly next:[Int32Array,Int32Array];
 readonly goals:[Int32Array,Int32Array];
 readonly land:Uint8Array;
 private distances:Float64Array;
 private heap:Int32Array;
 private positions:Int32Array;
 private heapSize=0;
 private heights:Float64Array;
 private risk:Float64Array;
 private suitability:[Float64Array,Float64Array];
 private changes:Float64Array;
 private heat:Float64Array;
 constructor(readonly grid:SphereGrid){
  const n=grid.count;this.next=[new Int32Array(n).fill(-1),new Int32Array(n).fill(-1)];this.goals=[new Int32Array(n).fill(-1),new Int32Array(n).fill(-1)];
  this.land=new Uint8Array(n);this.distances=new Float64Array(n);this.heap=new Int32Array(n);this.positions=new Int32Array(n);
  this.heights=new Float64Array(n);this.risk=new Float64Array(n);this.suitability=[new Float64Array(n),new Float64Array(n)];this.changes=new Float64Array(n*2);this.heat=new Float64Array(n);
 }
 private cheaper(a:number,b:number){return this.distances[a]<this.distances[b]||this.distances[a]===this.distances[b]&&a<b;}
 private enqueue(cell:number){
  let p=this.positions[cell];if(p<0){p=this.heapSize++;this.heap[p]=cell;}
  while(p>0){const parent=(p-1)>>1,other=this.heap[parent];if(!this.cheaper(cell,other))break;this.heap[p]=other;this.positions[other]=p;p=parent;}
  this.heap[p]=cell;this.positions[cell]=p;
 }
 private pop(){
  const cell=this.heap[0],last=this.heap[--this.heapSize];this.positions[cell]=-1;
  if(this.heapSize){let p=0;while(p*2+1<this.heapSize){let child=p*2+1;if(child+1<this.heapSize&&this.cheaper(this.heap[child+1],this.heap[child]))child++;const other=this.heap[child];if(!this.cheaper(other,last))break;this.heap[p]=other;this.positions[other]=p;p=child;}this.heap[p]=last;this.positions[last]=p;}
  return cell;
 }
 plan(state:PhysicalState,environment?:Environment){
  let active=false;
  for(let i=0;i<this.grid.count;i++){
   const p=i*STRIDE;this.land[i]=+animalLand(state[p+F.water],state[p+F.soil],state[p+F.molten]);this.heights[i]=solidHeight(state,i,this.grid);
   this.risk[i]=Math.min(6,state[p+F.carnivore]/(.05+state[p+F.herbivore]*.1));
   for(let kind=0;kind<2;kind++)this.suitability[kind][i]=this.land[i]?consumerTravelHabitat(state[p+F.temperature],state[p+F.water],state[p+F.dissolved],state[p+F.ice],kind===1):0;
   if(state[p+F.herbivore]>.000001||state[p+F.carnivore]>.000001)active=true;
  }
  for(let kind=0;kind<2;kind++){
   const route=this.next[kind],goals=this.goals[kind];route.fill(-1);goals.fill(-1);if(!active)continue;
   this.distances.fill(Infinity);this.positions.fill(-1);this.heapSize=0;
   for(let i=0;i<this.grid.count;i++){
    const p=i*STRIDE,food=state[p+(kind===0?F.plant:F.herbivore)];
    if(!this.land[i]||this.suitability[kind][i]<=0||food<.025)continue;
    const competition=kind===0?state[p+F.herbivore]*.25:state[p+F.carnivore]*.5;
    this.distances[i]=4/(1+food/(.1+competition))+(kind===0?this.risk[i]*2:0);goals[i]=i;this.enqueue(i);
   }
   while(this.heapSize){
    const cell=this.pop();
    for(let k=0;k<NEIGHBORS;k++){
     const edge=cell*NEIGHBORS+k,j=this.grid.neighbors[edge];if(j===INVALID||!this.land[j]||this.suitability[kind][j]<=0)continue;
     const distance=this.grid.distances[edge],travel=1/Math.sqrt(edgeScale(distance));
     const slope=Math.abs(this.heights[cell]-this.heights[j])/Math.max(.001,distance);
     const cost=this.distances[cell]+travel*(1+slope*.5+(kind===0?(this.risk[cell]+this.risk[j])*.5:0));
     if(cost+1e-12>=this.distances[j])continue;
     this.distances[j]=cost;route[j]=cell;goals[j]=goals[cell];this.enqueue(j);
    }
   }
  }
  return this.next;
 }
 /** Bounded donor flux moves guild mass and its sensible heat simultaneously. */
 move(state:PhysicalState,dt:number,environment:Environment,energyChanges:Float32Array){
  if(dt<=0)return false;
  let active=false;for(let p=0;p<state.length;p+=STRIDE)if(state[p+F.herbivore]>1e-6||state[p+F.carnivore]>1e-6){active=true;break;}if(!active)return false;
  this.plan(state,environment);this.changes.fill(0);this.heat.fill(0);
  for(let i=0;i<this.grid.count;i++)for(let kind=0;kind<2;kind++){
   const p=i*STRIDE,field=kind===0?F.herbivore:F.carnivore,mass=state[p+field];if(mass<=0)continue;
   for(let k=0;k<NEIGHBORS;k++){
    const edge=i*NEIGHBORS+k,j=this.grid.neighbors[edge];if(j===INVALID||this.suitability[kind][j]<=0)continue;
    // Low-rate dispersal supplies exploration when no reachable food remains.
    const rate=.012+(this.next[kind][i]===j?.2:0);
    const amount=mass*Math.min(dt*rate*edgeScale(this.grid.distances[edge]),1/NEIGHBORS)*this.suitability[kind][j];
    this.changes[i*2+kind]-=amount;this.changes[j*2+kind]+=amount;const heat=amount*state[p+F.temperature];this.heat[i]-=heat;this.heat[j]+=heat;
   }
  }
  let changed=false;
  for(let i=0;i<this.grid.count;i++){
   if(this.changes[i*2]===0&&this.changes[i*2+1]===0&&this.heat[i]===0)continue;
   changed=true;
   const p=i*STRIDE,before=enthalpy(state,i),sensible=capacity(state,i)*state[p+F.temperature]+this.heat[i];
   state[p+F.herbivore]=Math.max(0,state[p+F.herbivore]+this.changes[i*2]);state[p+F.carnivore]=Math.max(0,state[p+F.carnivore]+this.changes[i*2+1]);state[p+F.temperature]=sensible/capacity(state,i);
   const chemical=this.changes[i*2]*MATERIAL_ENERGY[F.herbivore]+this.changes[i*2+1]*MATERIAL_ENERGY[F.carnivore];
   energyChanges[i*4+3]+=enthalpy(state,i)-before-this.heat[i]-chemical;
  }
  return changed;
 }
}
