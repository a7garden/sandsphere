import type {PhysicalState} from './physicalState';
import {F,STRIDE,phaseEnergy,solidHeight,enthalpy,capacity} from './model';
import {SPECIFIC_HEAT,MATERIAL_ENERGY} from './thermodynamics';
import {SOLID_VOLUMES,mixedBedPotential,solidPotentialDerivative,exactStockTransfer} from './solidMechanics';
import {edgeScale,meltMobility} from './materialPhysics';
import {RADIUS,HEIGHT_SCALE} from './sphere';
import {AIR_LAYERS,AIR_SECONDS,COLUMN_KG,ATMOSPHERE_MIRRORS,surfaceEnthalpy,surfaceCapacity,type LayeredAtmosphere} from './layeredAtmosphere';
import {carryVelocity} from './conservativeTransport';
import type {SphereGrid} from './sphere';

export const mobileWater=(s:ArrayLike<number>,p:number)=>Math.max(0,s[p+F.water]-Math.min(1.2,s[p+F.soil]*.12));
export function currentMobility(s:PhysicalState,p:number){const x=Math.max(0,Math.min(1,(mobileWater(s,p)-.2)/.3));return x*x*(3-2*x);}
export const movingMass=(s:ArrayLike<number>,i:number)=>{const p=i*STRIDE,mobile=mobileWater(s,p);return mobile===0?0:mobile*(1+s[p+F.dissolved]/Math.max(1e-30,s[p+F.water]));};
/** Equal-area game columns use the atmospheric mass/area conversion. The liquid
 * mixture has a fixed bulk density of 1000 kg/m³; salt adds volume in this closure.
 * Rendered relief is exaggerated and is not used as physical metres. */
export const WATER_COLUMN_METERS=COLUMN_KG/1000;
type Edge={i:number;j:number;distance:number;t:number[]};
export interface OceanSnapshot {version:1|2|3;ready:boolean;mass:number[];momentum:number[];boundaryImpulse:number[];potential?:number[];datum?:number;gravity?:number;potentialReady?:boolean;solidPotential?:number[];solidDatum?:number;solidReady?:boolean;}
export interface OceanCheckpoint {potential:Float64Array;datum:number;gravity:number;potentialReady:boolean;solidPotential:Float64Array;solidDatum:number;solidReady:boolean;ready:boolean;mass:Float64Array;momentum:Float64Array;boundaryImpulse:Float64Array;}
export interface SurfaceThermal {physicalSurface?(s:PhysicalState):Float64Array;publishSurface?(s:PhysicalState):Float32Array;surfaceEnergy(s:PhysicalState,i:number):number;setSurfaceEnergy(s:PhysicalState,i:number,target:number):void;surfaceTemperature?(s:PhysicalState,i:number):number;surfaceCapacity?(s:PhysicalState,i:number):number;surfacePhaseEnergy?(s:PhysicalState,i:number):number;}
export function oceanEnergy(o:Pick<OceanSnapshot|OceanCheckpoint,'mass'|'momentum'|'potential'|'datum'|'solidPotential'|'solidDatum'>){let kinetic=0,liquid=0,solid=0;for(let i=0;i<o.mass.length;i++)if(o.mass[i]>0)for(let k=0;k<3;k++)kinetic+=o.momentum[i*3+k]**2/(2000*o.mass[i]);if(o.potential)for(const u of o.potential)liquid+=u;if(o.solidPotential)for(const u of o.solidPotential)solid+=u;return kinetic+(liquid-(o.datum??0))+(solid-(o.solidDatum??0));}
export function validOcean(value:unknown,count:number):value is OceanSnapshot{
 if(!value||typeof value!=='object')return false;const o=value as OceanSnapshot;
 const potentialValid=o.version===1?[o.potential,o.datum,o.gravity,o.potentialReady].every(v=>v===undefined):[2,3].includes(o.version)&&typeof o.potentialReady==='boolean'&&Number.isFinite(o.datum)&&Number.isFinite(o.gravity)&&o.gravity!>=0&&o.gravity!<=29.43&&Array.isArray(o.potential)&&o.potential.length===count&&o.potential.every(Number.isFinite)&& (o.potentialReady||o.datum===0&&o.potential.every(v=>v===0));
 const solidValid=o.version===3?typeof o.solidReady==='boolean'&&Number.isFinite(o.solidDatum)&&Array.isArray(o.solidPotential)&&o.solidPotential.length===count&&o.solidPotential.every(Number.isFinite)&&(o.solidReady||o.solidDatum===0&&o.solidPotential.every(v=>v===0)):[o.solidPotential,o.solidDatum,o.solidReady].every(v=>v===undefined);
 return potentialValid&&solidValid&&typeof o.ready==='boolean'&&[o.mass,o.momentum,o.boundaryImpulse].every((a,k)=>Array.isArray(a)&&a.length===(k===0?count:k===1?count*3:3)&&a.every(Number.isFinite))&&o.mass.every((m,i)=>m>=0&&(m===0||o.momentum.slice(i*3,i*3+3).every(v=>Number.isFinite(Math.fround(v/m))))&&(m>0||o.momentum.slice(i*3,i*3+3).every(v=>v===0)))&&Number.isFinite(oceanEnergy(o))&&(o.ready||[...o.mass,...o.momentum,...o.boundaryImpulse].every(v=>v===0));
}
/** Model kg, SI momentum, kJ. Mass is a mechanical partition of surface stocks,
 * never a second material inventory. The fixed bed/frame receives impulse but
 * performs no drag work; moving terrain is an explicit work boundary. Planet
 * rotation/spin is not dynamically resolved. */
export class OceanDynamics {
 potentialReady=false;datum=0;gravity=9.81;readonly potential:Float64Array;private normals:Float64Array;
 solidReady=false;solidDatum=0;readonly solidPotential:Float64Array;private thermal?:SurfaceThermal;private coupled=true;
 ready=false;readonly mass:Float64Array;readonly momentum:Float64Array;readonly boundaryImpulse=new Float64Array(3);
 constructor(readonly grid:SphereGrid,private edges:Edge[]){this.potential=new Float64Array(grid.count);this.solidPotential=new Float64Array(grid.count);this.normals=Float64Array.from(grid.directions);for(let i=0;i<grid.count;i++){const norm=Math.hypot(...this.normals.subarray(i*3,i*3+3));for(let k=0;k<3;k++)this.normals[i*3+k]/=norm;}this.mass=new Float64Array(grid.count);this.momentum=new Float64Array(grid.count*3);}
 setThermal(thermal?:SurfaceThermal,coupled=true){this.thermal=thermal;this.coupled=coupled;}
 private canonical(s:PhysicalState,operation:(actual:Float64Array)=>void){
  if(!(s instanceof Float32Array)||!this.thermal?.physicalSurface||!this.thermal.publishSurface)return false;
  const actual=this.thermal.physicalSurface(s);operation(actual);s.set(this.thermal.publishSurface(actual));return true;
 }
 snapshot():OceanSnapshot{return {version:3,potential:[...this.potential],datum:this.datum,gravity:this.gravity,potentialReady:this.potentialReady,solidPotential:[...this.solidPotential],solidDatum:this.solidDatum,solidReady:this.solidReady,ready:this.ready,mass:[...this.mass],momentum:[...this.momentum],boundaryImpulse:[...this.boundaryImpulse]};}
 checkpoint():OceanCheckpoint{return {potential:this.potential.slice(),datum:this.datum,gravity:this.gravity,potentialReady:this.potentialReady,solidPotential:this.solidPotential.slice(),solidDatum:this.solidDatum,solidReady:this.solidReady,ready:this.ready,mass:this.mass.slice(),momentum:this.momentum.slice(),boundaryImpulse:this.boundaryImpulse.slice()};}
 restore(o?:OceanSnapshot|OceanCheckpoint){this.potentialReady=o?.potentialReady??false;this.datum=o?.datum??0;this.gravity=o?.gravity??9.81;this.potential.fill(0);if(o?.potential)this.potential.set(o.potential);this.solidReady=o?.solidReady??false;this.solidDatum=o?.solidDatum??0;this.solidPotential.fill(0);if(o?.solidPotential)this.solidPotential.set(o.solidPotential);this.ready=o?.ready??false;this.mass.fill(0);this.momentum.fill(0);this.boundaryImpulse.fill(0);if(o){this.mass.set(o.mass);this.momentum.set(o.momentum);this.boundaryImpulse.set(o.boundaryImpulse);}}
 energy(){return oceanEnergy(this);}
 kineticEnergy(){let h=0;for(let i=0;i<this.mass.length;i++)h+=this.kinetic(i);return h;}
 potentialAt(s:PhysicalState,i:number,liquid=s[i*STRIDE+F.water]+s[i*STRIDE+F.dissolved]){return liquid===0||this.gravity===0?0:this.gravity*WATER_COLUMN_METERS/1000*liquid*(solidHeight(s,i,this.grid)+liquid/2);}
 solidPotentialAt(s:PhysicalState,i:number){return mixedBedPotential(s,i*STRIDE,this.grid.geometry[i*4+3],this.gravity*WATER_COLUMN_METERS/1000);}
 columnPotential(s:PhysicalState,i:number){return this.potentialAt(s,i)+this.solidPotentialAt(s,i);}
 acceptPotential(s:PhysicalState,i:number){this.potential[i]=this.potentialAt(s,i);this.solidPotential[i]=this.solidPotentialAt(s,i);}
 /** A fixed energy datum introduces the newly tracked coordinate without
  * minting heat/kinetic energy in an old save. Never reset it during evolution. */
 configure(s:PhysicalState,gravity:number,ledger?:Float32Array){if(this.canonical(s,actual=>this.configure(actual,gravity,ledger)))return;
  if(!Number.isFinite(gravity)||gravity<0||gravity>29.43)throw new Error('해류 중력이 유효하지 않습니다.');
  const changed=this.gravity!==gravity;if(changed&&this.potentialReady&&!ledger)throw new Error('중력 편집에는 외부 에너지 장부가 필요합니다.');this.gravity=gravity;
  if(!this.solidReady){for(let i=0;i<this.mass.length;i++)this.solidPotential[i]=this.solidPotentialAt(s,i);this.solidDatum=this.solidPotential.reduce((a,b)=>a+b,0);this.solidReady=true;}
  if(!this.potentialReady){for(let i=0;i<this.mass.length;i++)this.potential[i]=this.potentialAt(s,i);this.datum=this.potential.reduce((a,b)=>a+b,0);this.potentialReady=true;}
  else if(changed){if(!ledger)throw new Error('중력 편집에는 외부 에너지 장부가 필요합니다.');this.externalPotential(s,ledger);}
 }
 externalPotential(s:PhysicalState,ledger:Float32Array){if(this.canonical(s,actual=>this.externalPotential(actual,ledger)))return;if(!this.potentialReady)return;for(let i=0;i<this.mass.length;i++){const next=this.columnPotential(s,i);ledger[i*4+1]+=next-this.potential[i]-this.solidPotential[i];this.acceptPotential(s,i);}}

 kinetic(i:number){return this.mass[i]>0?(this.momentum[i*3]**2+this.momentum[i*3+1]**2+this.momentum[i*3+2]**2)/(2000*this.mass[i]):0;}
 private enthalpy(s:PhysicalState,i:number){return this.thermal?this.thermal.surfaceEnergy(s,i):this.coupled?surfaceEnthalpy(s,i):enthalpy(s,i);}
 private temperature(s:PhysicalState,i:number){return this.thermal?.surfaceTemperature?.(s,i)??s[i*STRIDE+F.temperature];}
 private setEnergy(s:PhysicalState,i:number,target:number,ledger:Float32Array){if(this.thermal){this.thermal.setSurfaceEnergy(s,i,target);return;}const p=i*STRIDE,phase=phaseEnergy(s,i)-(this.coupled?ATMOSPHERE_MIRRORS.reduce((a,f)=>a+s[p+f]*MATERIAL_ENERGY[f],0):0);s[p+F.temperature]=(target-phase)/(this.coupled?surfaceCapacity(s,i):capacity(s,i));ledger[i*4+3]+=this.enthalpy(s,i)-target;}
 private heat(s:PhysicalState,i:number,h:number,ledger:Float32Array){this.setEnergy(s,i,this.enthalpy(s,i)+h,ledger);}
 /** Added water enters at rest. Phase changes and moving terrain exchange
  * gravitational work with the surface thermal reservoir. Departing liquid
  * settles against the bed, returning its kinetic energy as local heat. */
 reconcile(s:PhysicalState,ledger:Float32Array){if(this.canonical(s,actual=>this.reconcile(actual,ledger)))return;
  if(!this.potentialReady)this.configure(s,this.gravity);
  for(let i=0;i<this.grid.count;i++)this.reconcileCell(s,i,ledger);this.ready=true;
 }
 reconcileCell(s:PhysicalState,i:number,ledger:Float32Array){if(this.canonical(s,actual=>this.reconcileCell(actual,i,ledger)))return;
   const work=this.potential[i]+this.solidPotential[i]-this.columnPotential(s,i);this.acceptPotential(s,i);
   const m=movingMass(s,i),old=this.mass[i],h=this.kinetic(i),scale=old>0?Math.min(1,m/old):0;
   for(let k=0;k<3;k++){const v=i*3+k;this.boundaryImpulse[k]+=this.momentum[v]*(1-scale);this.momentum[v]=this.momentum[v]*scale||0;}
   this.mass[i]=m;this.heat(s,i,work+(this.ready?h-this.kinetic(i):0),ledger);
 }
 /** Surface evaporation samples free liquid first; soil-bound water and
  * solids belong to the stationary bed. The parcel carries its actual KE. */
 massParcel(s:PhysicalState,i:number,field:number,amount:number){
  const mobile=field===F.water?Math.min(amount,mobileWater(s,i*STRIDE)):0,m=this.mass[i];
  const velocity=[0,1,2].map(k=>m>0?this.momentum[i*3+k]/m:0);
  return {momentum:velocity.map(v=>mobile*v),kinetic:mobile*velocity.reduce((a,v)=>a+v*v,0)/2000};
 }
 /** Signed material flux: positive enters the surface. Mobile water receives
  * the parcel impulse; the fixed bed receives the rest. Newly mobilized salt
  * starts at rest, while newly bound liquid gives its impulse to the bed.
  * Return ΔKE so the thermal reservoir receives the mixing dissipation. */
 transferMass(s:PhysicalState,i:number,field:number,amount:number,parcel:readonly number[]){
  const before=this.kinetic(i),old=this.mass[i],next=movingMass(s,i),p=i*3;
  if(amount>=0){
   const water=s[i*STRIDE+F.water],bound=Math.min(1.2,s[i*STRIDE+F.soil]*.12),mobile=mobileWater(s,i*STRIDE),previousMobile=Math.max(0,water-amount-bound);
   const admitted=field===F.water&&amount>0?Math.max(0,Math.min(1,(mobile-previousMobile)/amount)):0;
   for(let k=0;k<3;k++){this.momentum[p+k]+=parcel[k]*admitted;this.boundaryImpulse[k]+=parcel[k]*(1-admitted);}
  }else{
   // The outgoing parcel impulse is supplied with a negative sign.
   const removed=field===F.water?Math.min(-amount,Math.max(0,s[i*STRIDE+F.water]-amount-Math.min(1.2,s[i*STRIDE+F.soil]*.12))):0,remaining=Math.max(0,old-removed),scale=remaining>0?Math.min(1,next/remaining):0;
   for(let k=0;k<3;k++){const momentum=this.momentum[p+k]+parcel[k];this.boundaryImpulse[k]+=momentum*(1-scale);this.momentum[p+k]=momentum*scale;}
  }
  this.mass[i]=next;
  if(next===0)for(let k=0;k<3;k++){this.boundaryImpulse[k]+=this.momentum[p+k];this.momentum[p+k]=0;}
  return this.kinetic(i)-before;
 }
 checkpointCell(i:number){return {mass:this.mass[i],momentum:this.momentum.slice(i*3,i*3+3),boundaryImpulse:this.boundaryImpulse.slice()};}
 restoreCell(i:number,value:unknown){const saved=value as {mass:number;momentum:Float64Array;boundaryImpulse:Float64Array};this.mass[i]=saved.mass;this.momentum.set(saved.momentum,i*3);this.boundaryImpulse.set(saved.boundaryImpulse);}
 /** A user eraser exports the removed water's momentum/kinetic energy. */
 supplies(commands:PhysicalState,stride:number,ledger:Float32Array){if(!this.ready)return;for(let i=0;i<this.mass.length;i++){const fraction=Math.max(0,Math.min(1,commands[i*stride+5]));if(fraction===0)continue;const before=this.kinetic(i);this.mass[i]*=1-fraction;for(let k=0;k<3;k++){const v=i*3+k;this.boundaryImpulse[k]+=this.momentum[v]*fraction;this.momentum[v]*=1-fraction;}ledger[i*4+1]+=this.kinetic(i)-before;}}
 velocities(target:Float32Array,radius:number){for(let i=0;i<this.mass.length;i++)for(let k=0;k<3;k++)target[i*3+k]=Math.fround(this.mass[i]>0?this.momentum[i*3+k]/this.mass[i]*AIR_SECONDS/radius:0)||0;}
 /** Exact relaxation for frozen bulk drag coefficient: equal/opposite impulse,
  * nonnegative lost relative kinetic energy, split equally across the interface. */
 stress(s:PhysicalState,air:LayeredAtmosphere,seconds:number,ledger:Float32Array){if(this.canonical(s,actual=>this.stress(actual,air,seconds,ledger)))return;
  for(let i=0;i<this.grid.count;i++){
   const q=i*AIR_LAYERS,m=this.mass[i],a=air.layerMass(q),wet=currentMobility(s,i*STRIDE);if(m<=0||a<=1e-18||wet===0)continue;
   const relative=[0,1,2].map(k=>air.velocity[q*3+k]-this.momentum[i*3+k]/m),mu=a*m/(a+m),speed=Math.hypot(...relative);
   const fraction=-Math.expm1(-.0015*speed/air.thickness(0)*wet*(1+a/m)*seconds),impulse=relative.map(v=>mu*fraction*v);
   const dissipated=mu*speed*speed*fraction*(2-fraction)/2000;
   for(let k=0;k<3;k++)this.momentum[i*3+k]+=impulse[k];
   air.exchangeMomentum(q,impulse.map(v=>-v),dissipated/2);this.heat(s,i,dissipated/2,ledger);
  }
 }
 drag(s:PhysicalState,seconds:number,ledger:Float32Array){if(this.canonical(s,actual=>this.drag(actual,seconds,ledger)))return;const scale=Math.exp(-seconds/600);for(let i=0;i<this.mass.length;i++){const before=this.kinetic(i);for(let k=0;k<3;k++){const v=i*3+k;this.boundaryImpulse[k]+=this.momentum[v]*(1-scale);this.momentum[v]=this.momentum[v]*scale||0;}this.heat(s,i,before-this.kinetic(i),ledger);}}
 rotate(rate:number,dt:number){for(let i=0;i<this.mass.length;i++){const v=i*3,normal=this.grid.directions.subarray(v,v+3),length=Math.hypot(...normal),n=Array.from(normal,x=>x/length),p=Array.from(this.momentum.subarray(v,v+3)),angle=-2*rate*n[1]*dt,c=Math.cos(angle),s=Math.sin(angle);for(let k=0;k<3;k++){const next=p[k]*c+(n[(k+1)%3]*p[(k+2)%3]-n[(k+2)%3]*p[(k+1)%3])*s+n[k]*(n[0]*p[0]+n[1]*p[1]+n[2]*p[2])*(1-c);this.boundaryImpulse[k]+=p[k]-next;this.momentum[v+k]=next||0;}}}
 /** Overdamped granular/viscous bed motion. Material carries its enthalpy;
  * the exact combined bed + displaced-water potential drop becomes heat.
  * Static repose and viscosity remain empirical game constitutive laws. A
  * parcel that would raise total potential has no unresolved work source and
  * is not admitted, even if its bare bed height is downhill. */
 transportSolids(s:PhysicalState,dt:number,ledger:Float32Array){if(this.canonical(s,actual=>this.transportSolids(actual,dt,ledger)))return;
  if(dt<=0||this.gravity===0)return;
  if(!this.potentialReady||!this.solidReady)this.configure(s,this.gravity);
  const G=this.gravity*WATER_COLUMN_METERS/1000;
  for(const reverse of [false,true])for(let index=0;index<this.edges.length;index++){
   const edge=this.edges[reverse?this.edges.length-1-index:index],distance=2*Math.sin(edge.distance/2)*RADIUS/HEIGHT_SCALE;
   for(const field of [F.sand,F.clay,F.molten,F.charcoal]){
    if(s[edge.i*STRIDE+field]+s[edge.j*STRIDE+field]<=0)continue;
    const hi=solidHeight(s,edge.i,this.grid),hj=solidHeight(s,edge.j,this.grid),from=hi>hj?edge.i:edge.j,to=hi>hj?edge.j:edge.i,dp=from*STRIDE,rp=to*STRIDE;
    const stock=s[dp+field];if(stock<=0)continue;
    const wet=s[dp+F.water]/Math.max(.1,s[dp+F.sand]+s[dp+F.clay]);
    const repose=field===F.sand?(wet<.025?.58:wet<.35?.95:.28):field===F.clay?(wet>.5?.2:1.1):field===F.charcoal?.4:0;
    const rate=field===F.molten?meltMobility(this.temperature(s,from)):field===F.clay?.4:1.2;
    let amount=Math.min(stock/12,Math.max(0,Math.abs(hi-hj)-distance*repose)*dt*.5*rate*(this.gravity/9.81)*edgeScale(distance));
    if(amount<=0)continue;
    const volume=SOLID_VOLUMES.find(([f])=>f===field)![1];
    const derivative=(i:number)=>solidPotentialDerivative(s,i*STRIDE,this.grid.geometry[i*4+3],G,volume,s[i*STRIDE+F.water]+s[i*STRIDE+F.dissolved]);
    const derivativeD=derivative(from),derivativeR=derivative(to);
    amount=Math.min(amount,Math.max(0,(derivativeD-derivativeR)/(G*volume)));
    if(s instanceof Float32Array)amount=exactStockTransfer(stock,s[rp+field],amount);
    if(amount<=0)continue;
    const beforeD=this.columnPotential(s,from),beforeR=this.columnPotential(s,to),hd=this.enthalpy(s,from),hr=this.enthalpy(s,to),receiver=s[rp+field],oldDoseD=s[dp+F.clay]*s[dp+F.firing],oldDoseR=s[rp+F.clay]*s[rp+F.firing];
    s[dp+field]=stock-amount;s[rp+field]=receiver+amount;
    const nextD=this.columnPotential(s,from),nextR=this.columnPotential(s,to),deltaD=-amount*derivativeD+G*volume*amount*amount/2,deltaR=amount*derivativeR+G*volume*amount*amount/2,released=-(deltaD+deltaR);
    if(released<0){s[dp+field]=stock;s[rp+field]=receiver;continue;}
    const carried=amount*(SPECIFIC_HEAT[field]*this.temperature(s,from)+MATERIAL_ENERGY[field]);
    if(field===F.clay){const dose=amount*s[dp+F.firing];s[dp+F.firing]=s[dp+F.clay]>0?(oldDoseD-dose)/s[dp+F.clay]:0;s[rp+F.firing]=(oldDoseR+dose)/s[rp+F.clay];}
    this.acceptPotential(s,from);this.acceptPotential(s,to);
    this.setEnergy(s,from,hd-carried+released/2,ledger);this.setEnergy(s,to,hr+carried+released/2,ledger);
    ledger[from*4+3]+=nextD-beforeD-deltaD;ledger[to*4+3]+=nextR-beforeR-deltaR;
   }
  }
 }
 /** Energy-limited hydraulic parcels, split symmetrically over local edges.
  * A head difference launches a discharge; wind/current drift advects it. The
  * exact quadratic potential drop changes parcel kinetic energy before mixing.
  * Uphill parcels must pay with their forward kinetic energy, never local heat.
  * This is a dissipative hydraulic closure, not a shallow-water wave solver. */
 transport(s:PhysicalState,dt:number,radius:number,ledger:Float32Array){if(this.canonical(s,actual=>this.transport(actual,dt,radius,ledger)))return;
  if(dt<=0)return;if(!this.potentialReady)this.configure(s,this.gravity);
  for(const reverse of [false,true])for(let index=0;index<this.edges.length;index++){
   const {i,j,distance,t}=this.edges[reverse?this.edges.length-1-index:index];
   const liquid=(cell:number)=>s[cell*STRIDE+F.water]+s[cell*STRIDE+F.dissolved];
   const head=(cell:number)=>solidHeight(s,cell,this.grid)+liquid(cell);
   const velocity=(cell:number)=>[0,1,2].map(k=>this.mass[cell]>0?this.momentum[cell*3+k]/this.mass[cell]:0);
   const vi=velocity(i),vj=velocity(j),difference=head(i)-head(j),G=this.gravity*WATER_COLUMN_METERS/1000;
   const speed=t.reduce((a,v,k)=>a+v*(vi[k]+vj[k])/2,0)+Math.sign(difference)*Math.sqrt(2000*G*Math.abs(difference));
   if(speed===0)continue;const from=speed>0?i:j,to=speed>0?j:i,dp=from*STRIDE,rp=to*STRIDE,available=movingMass(s,from);
   if(available<=1e-18)continue;
   const vd=from===i?vi:vj,normal=this.normals.subarray(from*3,from*3+3),direction=t.map(v=>v*(speed>0?1:-1)),dot=direction.reduce((a,v,k)=>a+v*normal[k],0);
   for(let k=0;k<3;k++)direction[k]-=dot*normal[k];const length=Math.hypot(...direction);for(let k=0;k<3;k++)direction[k]/=length;
   const along=vd.reduce((a,v,k)=>a+v*direction[k],0),drop=head(from)-head(to);
   let amount=Math.min(available/12,available*Math.abs(speed)*dt*AIR_SECONDS/(radius*distance*6));
   // q <= head drop + forward kinetic head is the exact quadratic work bound.
   if(G>0)amount=Math.min(amount,Math.max(0,drop+Math.max(0,along)**2/(2000*G)));
   if(amount<=1e-18)continue;
   const oldLiquidD=liquid(from),oldLiquidR=liquid(to),waterShare=s[dp+F.water]/oldLiquidD,saltShare=s[dp+F.dissolved]/oldLiquidD;
   // Compute the trace constituent directly; subtraction of almost equal
   // water amounts can otherwise manufacture a negative salt parcel.
   const water=waterShare<saltShare?amount*waterShare:amount-amount*saltShare,salt=waterShare<saltShare?amount-water:amount*saltShare;
   const released=G*amount*(drop-amount),parcelK=amount*vd.reduce((a,v)=>a+v*v,0)/2000;
   const nextAlong=Math.sqrt(Math.max(0,along*along+2000*released/amount));
   const launch=new Float64Array(3),carried=new Float64Array(3);for(let k=0;k<3;k++)launch[k]=vd[k]+(nextAlong-along)*direction[k];
   // carryVelocity accepts a flat vector field; q=0 selects this one parcel.
   carryVelocity(launch,0,this.normals,from,to,carried);
   const temperature=this.temperature(s,from),receiverTemperature=this.temperature(s,to),parcelCapacity=water*SPECIFIC_HEAT[F.water]+salt*SPECIFIC_HEAT[F.dissolved],thermal=water*(SPECIFIC_HEAT[F.water]*temperature+MATERIAL_ENERGY[F.water])+salt*(SPECIFIC_HEAT[F.dissolved]*temperature+MATERIAL_ENERGY[F.dissolved]);
   const hd=this.enthalpy(s,from)-thermal,hr=this.enthalpy(s,to)+thermal,kd=this.kinetic(from),kr=this.kinetic(to);
   const idealD=this.potentialAt(s,from,oldLiquidD-amount),idealR=this.potentialAt(s,to,oldLiquidR+amount),oldReceiver=this.mass[to];
   s[dp+F.water]-=water;s[dp+F.dissolved]-=salt;s[rp+F.water]+=water;s[rp+F.dissolved]+=salt;
   this.mass[from]=movingMass(s,from);this.mass[to]=movingMass(s,to);
   const mobileShare=Math.max(0,Math.min(1,(this.mass[to]-oldReceiver)/amount));
   for(let k=0;k<3;k++){
    const departing=amount*vd[k],arriving=amount*mobileShare*carried[k];
    this.momentum[from*3+k]-=departing;this.momentum[to*3+k]+=arriving;this.boundaryImpulse[k]+=departing-arriving;
   }
   for(const [cell,h,ideal,kinetic] of [[from,hd,idealD,kd-parcelK],[to,hr,idealR,kr+parcelK+released]]){
    if(this.mass[cell]===0){for(let k=0;k<3;k++){this.boundaryImpulse[k]+=this.momentum[cell*3+k];this.momentum[cell*3+k]=0;}}
    // A parcel leaves at the donor's own velocity and temperature, so its
    // retained thermal state is unchanged. Reconstruct from the actual new
    // stocks, then mix the receiver by a temperature difference. This avoids
    // subtracting large Celsius/phase references at a zero sensible margin.
    const c=this.thermal?.surfaceCapacity?.(s,cell)??(this.coupled?surfaceCapacity(s,cell):capacity(s,cell)),p=cell*STRIDE,phase=this.thermal?.surfacePhaseEnergy?.(s,cell)??(phaseEnergy(s,cell)-(this.coupled?ATMOSPHERE_MIRRORS.reduce((h,f)=>h+s[p+f]*MATERIAL_ENERGY[f],0):0));
    const baseline=c*(cell===from?temperature:receiverTemperature)+phase;
    const target=cell===from?baseline:baseline+parcelCapacity*(temperature-receiverTemperature)+(kinetic-this.kinetic(cell));
    this.setEnergy(s,cell,target,ledger);
    // Measured arithmetic/material projection error remains distinct from
    // physical mixing heat and hydraulic work, including donor KE roundoff.
    ledger[cell*4+3]+=target-(h+(kinetic-this.kinetic(cell)));
    this.potential[cell]=this.potentialAt(s,cell);ledger[cell*4+3]+=this.potential[cell]-ideal;
   }
  }
 }
}
