import type {PhysicalState} from './physicalState';
import {OceanDynamics,validOcean,type OceanSnapshot,type OceanCheckpoint} from './oceanDynamics';
export {currentMobility} from './oceanDynamics';
import {F,STRIDE,MASS_FIELDS,enthalpy,phaseEnergy,solidHeight,equilibrateWater,type Environment} from './model';
import {NEIGHBORS,INVALID,HEIGHT_SCALE,RADIUS,type SphereGrid} from './sphere';
import {MATERIAL_ENERGY,assertThermodynamicTemperature} from './thermodynamics';
import {columnPressure,saturationMass} from './waterPhysics';
import {reactEcosystem} from './ecology';
import {outgoingScale} from './conservativeTransport';
import {dustOpticalDepth} from './dustPhysics';
import {LayeredAtmosphere,COLUMN_KG,AIR_SECONDS,validLayered,surfaceCapacity,surfaceEnthalpy,ATMOSPHERE_MIRRORS,type LayeredSnapshot,type LayeredCheckpoint} from './layeredAtmosphere';
import {DeepAtmosphere,DEEP_LAYERS,validDeep,type DeepSnapshot,type DeepCheckpoint} from './deepAtmosphere';
import {isDeepAtmosphere} from './planetDefinition';

export interface ClimateSnapshot {version:1|2|3|4|5|6|7;surfaceMassCarry?:number[];surfaceHeatCarry?:number[];ocean?:OceanSnapshot;wind:number[];currents:number[];seeds:number[];atmosphere?:LayeredSnapshot;giant?:DeepSnapshot;}
export interface ClimateCheckpoint {surfaceMassCarry:Float64Array;ocean:OceanCheckpoint;wind:Float32Array;currents:Float32Array;seeds:Float32Array;air:LayeredCheckpoint;giant?:DeepCheckpoint;}
export type ClimateLayer='none'|'temperature'|'pressure'|'wind'|'jets'|'ammonia'|'currents'|'humidity'|'airmass'|'clouds'|'moisture'|'seeds'|'dust'|'co2ice';
export const CLIMATE_LAYERS:Record<ClimateLayer,{name:string;legend:string}>= {
 none:{name:'물질',legend:'현재 표면 물질'},temperature:{name:'지표 온도',legend:'지표 열 저장층 · −30 → 50°C'},
 pressure:{name:'기압',legend:'기체 기둥 무게 · 0.6 → 1.4 atm'},wind:{name:'기류',legend:'색: 속도 · 화살표: 방향 · 0 → 100 m/s'},
 jets:{name:'동서 제트',legend:'서향 −250 ← 0 → 동향 250 m/s'},ammonia:{name:'암모니아 구름',legend:'NH₃ 액체 + 얼음 · 0 → 2 kg/m²'},
 currents:{name:'해류',legend:'색: 속도 · 화살표: 방향 · 0 → 2 m/s'},humidity:{name:'습도',legend:'응축물이 가장 많은 대기층 · 0 → 100%'},
 airmass:{name:'기단',legend:'차고 건조 · 차고 습함 · 따뜻하고 건조 · 따뜻하고 습함'},
 clouds:{name:'구름량',legend:'물방울 + 구름 얼음 · 0 → 0.3 kg/m²'},
 moisture:{name:'수분',legend:'식생 이용 가능 물 · 0 → 0.3 kg/셀'},seeds:{name:'씨앗',legend:'정착 가능 씨앗 · 0 → 1 (게임 지수)'},
 dust:{name:'대기 먼지',legend:'먼지 광학 깊이 · 0 → 3'},co2ice:{name:'CO₂ 얼음',legend:'지표 CO₂ 얼음 · 0 → 1 kg/m²'},
};
const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
/** Grey-body TOA energy balance in game kJ and time, not an Earth forecast.
 * Implicit longwave cooling is monotone even for furnace temperatures. */
export function radiativeHeat(c:number,t:number,shortwave:number,opticalDepth:number,dt:number){
 if(dt<=0)return 0;
 const area=.004,sigma=5.670374419e-8,emissivity=1/(1+.75*Math.max(0,opticalDepth));
 assertThermodynamicTemperature(t);
 // Bracket by absolute zero and the hotter of the starting and radiative
 // equilibrium temperatures, not by a preset temperature range.
 let lo=-273.15,hi=Math.max(t,Math.pow(Math.max(0,shortwave)/(emissivity*sigma),.25)-273.15);
 for(let k=0;k<40;k++){const mid=(lo+hi)/2,residual=c*(mid-t)-dt*area*(shortwave-emissivity*sigma*Math.pow(mid+273.15,4));if(residual>0)hi=mid;else lo=mid;}
 return c*((lo+hi)/2-t);
}
export function climateOpticalDepth(s:PhysicalState,p:number){return 1.4*Math.log1p(s[p+F.carbonDioxide]/.003)+.25*Math.log1p(s[p+F.vapor]/.002)+.4*Math.log1p(s[p+F.methane]/.0002)+.12*(s[p+F.cloud]+s[p+F.cloudIce]);}
export function pioneerRootability(s:PhysicalState,p:number){return clamp((s[p+F.sand]+s[p+F.clay]+s[p+F.soil])*4);}
/** Legacy/uninitialized fallback. Active climate uses stored layer state. */
export function cloudConditions(s:PhysicalState,i:number,e:Environment,lift=0){
 const p=i*STRIDE,temperature=s[p+F.temperature],mass=s[p+F.cloud]+s[p+F.cloudIce],iceShare=mass>1e-8?s[p+F.cloudIce]/mass:(temperature< -12.001?1:0);
 const saturation=saturationMass(temperature,'water',s[p+F.nitrogen],s[p+F.methane],s[p+F.carbonDioxide],e.gravity??1,1,s[p+F.oxygen],s[p+F.carbonMonoxide])*(1-iceShare)+saturationMass(temperature,'ice',s[p+F.nitrogen],s[p+F.methane],s[p+F.carbonDioxide],e.gravity??1,1,s[p+F.oxygen],s[p+F.carbonMonoxide])*iceShare;
 return {height:0,layer:0,temperature,lift,saturation,excess:s[p+F.vapor]-saturation,humidity:clamp(s[p+F.vapor]/Math.max(1e-12,saturation),0,2),pressure:columnPressure(s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide]+s[p+F.oxygen]+s[p+F.carbonMonoxide],e.gravity??1)};
}
export function relativeHumidity(s:PhysicalState,i:number,e:Environment,c?:WeatherClimate){return (c&&e.climate?c.conditions(s,i,e):cloudConditions(s,i,e)).humidity;}
export function flowCellSpeed(velocity:Float32Array,i:number,count:number){return Math.hypot(velocity[i*3],velocity[i*3+1],velocity[i*3+2])/Math.sqrt(4*Math.PI/count);}
type ClimateEdge={i:number;j:number;distance:number;t:number[]};
export function rotateCoriolis(v:readonly number[],n:readonly number[],rate:number,dt:number){
 const a=2*rate*n[1]*dt,c=Math.cos(a),s=-Math.sin(a);
 return [v[0]*c+(n[1]*v[2]-n[2]*v[1])*s,v[1]*c+(n[2]*v[0]-n[0]*v[2])*s,v[2]*c+(n[0]*v[1]-n[1]*v[0])*s];
}
export function validClimate(value:unknown,count:number):value is ClimateSnapshot{
 if(!value||typeof value!=='object')return false;const s=value as ClimateSnapshot;
 const simple=s.version===5||s.version===6,layered=s.version===4||s.version===7,resolved=layered||s.version===3;
 return ((layered||simple)?validOcean(s.ocean,count):s.ocean===undefined)&&[1,2,3,4,5,6,7].includes(s.version)
  &&((s.version===6||s.version===7)?Array.isArray(s.surfaceMassCarry)&&s.surfaceMassCarry.length===count*STRIDE&&s.surfaceMassCarry.every((v,i)=>Number.isFinite(v)&&(MASS_FIELDS.includes(i%STRIDE)?true:v===0)&&(!layered||!(ATMOSPHERE_MIRRORS as readonly number[]).includes(i%STRIDE)||v===0)):s.surfaceMassCarry===undefined)
  &&(simple?Array.isArray(s.surfaceHeatCarry)&&s.surfaceHeatCarry.length===count&&s.surfaceHeatCarry.every(Number.isFinite)&&s.atmosphere===undefined&&s.giant===undefined:s.surfaceHeatCarry===undefined)
  &&(s.version!==7||s.atmosphere!==undefined)
  &&(s.atmosphere===undefined||(s.version===2||layered)&&validLayered(s.atmosphere,count))
  &&(s.giant===undefined?s.version!==3:s.version===3&&s.atmosphere===undefined&&validDeep(s.giant,count))
  &&[s.wind,s.currents].every((a,k)=>Array.isArray(a)&&a.length===count*3&&a.every(v=>Number.isFinite(Math.fround(v))&&Math.abs(v)<=(resolved||k===1&&simple?Infinity:s.version===1?.121:.31)))&&[s.wind,s.currents].every((a,k)=>Array.from({length:count},(_,i)=>Math.hypot(a[i*3],a[i*3+1],a[i*3+2])).every(speed=>speed<=(resolved?Infinity:k===0?(s.version===1?.12:.31):simple?Infinity:.035)+1e-6))&&Array.isArray(s.seeds)&&s.seeds.length===count&&s.seeds.every(v=>Number.isFinite(v)&&v>=0&&v<=1)
  &&(!s.giant||[...s.seeds,...s.currents].every(v=>v===0));
}
/** Stratified atmosphere coupled to the retained shallow ocean/ecology model.
 * Atmospheric inventories, enthalpy and tangent momentum share edge fluxes. */
export class WeatherClimate {
 wind:Float32Array;currents:Float32Array;seeds:Float32Array;lift:Float32Array;readonly air:LayeredAtmosphere;readonly giant:DeepAtmosphere;readonly ocean:OceanDynamics;
 private edges:ClimateEdge[]=[];private incident:ClimateEdge[][];
 private roundoff:Float64Array;
 constructor(readonly grid:SphereGrid){
  this.lift=new Float32Array(grid.count);this.wind=new Float32Array(grid.count*3);this.currents=new Float32Array(grid.count*3);this.seeds=new Float32Array(grid.count);
  this.roundoff=new Float64Array(grid.count);
  this.incident=Array.from({length:grid.count},()=>[]);
  for(let i=0;i<grid.count;i++)for(let k=0;k<NEIGHBORS;k++){const j=grid.neighbors[i*NEIGHBORS+k];if(j===INVALID||j<=i)continue;
   const a=Array.from(grid.directions.slice(i*3,i*3+3)),b=Array.from(grid.directions.slice(j*3,j*3+3)),d=b.map((v,k)=>v-a[k]),length=Math.hypot(...d);
   const edge={i,j,distance:2*Math.asin(Math.min(1,length/2)),t:d.map(v=>v/length)};this.edges.push(edge);this.incident[i].push(edge);this.incident[j].push(edge);
  }
  this.ocean=new OceanDynamics(grid,this.edges);this.air=new LayeredAtmosphere(grid,this.edges);
  this.air.setMechanics({potential:(s,i)=>this.ocean.columnPotential(s,i),accept:(s,i)=>this.ocean.acceptPotential(s,i),
   kinetic:i=>this.ocean.kinetic(i),massParcel:(s,i,f,m)=>this.ocean.massParcel(s,i,f,m),transferMass:(s,i,f,m,p)=>this.ocean.transferMass(s,i,f,m,p),
   checkpointCell:i=>this.ocean.checkpointCell(i),restoreCell:(i,c)=>this.ocean.restoreCell(i,c)});
  this.giant=new DeepAtmosphere(grid,this.edges);
 }
 /** Rehydrate material before every host operation. Low bits are physical
  * stock, including heat capacity and reactions, rather than a budget offset. */
 syncSurfaceProjection(s:Float32Array){
  for(let p=0;p<s.length;p+=STRIDE)for(const f of MASS_FIELDS)if(this.air.surfaceStock(s,p+f)===s[p+f])this.air.surfaceMassCarry[p+f]=0;
  this.air.rememberSurfaceProjection(s);
 }
 physicalSurface(s:PhysicalState){return this.air.physicalSurface(s);}
 /** Publish the compatible public projection after all physical exchanges. */
 publishSurface(actual:PhysicalState){
  if(!this.giant.ready)return this.air.publishSurface(actual);
  this.air.surfaceMassCarry.fill(0);const projected=new Float32Array(actual);this.air.rememberSurfaceProjection(projected);return projected;
 }
 snapshot():ClimateSnapshot{return {...(this.giant.ready?{version:3 as const,giant:this.giant.snapshot()}:this.air.ready?{version:7 as const,surfaceMassCarry:[...this.air.surfaceMassCarry],atmosphere:this.air.snapshot(),ocean:this.ocean.snapshot()}:{version:6 as const,surfaceMassCarry:[...this.air.surfaceMassCarry],surfaceHeatCarry:[...this.air.surfaceHeatCarry],ocean:this.ocean.snapshot()}),wind:[...this.wind],currents:[...this.currents],seeds:[...this.seeds]};}
 checkpoint():ClimateCheckpoint{return {surfaceMassCarry:this.air.surfaceMassCarry.slice(),ocean:this.ocean.checkpoint(),wind:this.wind.slice(),currents:this.currents.slice(),seeds:this.seeds.slice(),air:this.air.checkpoint(),...(this.giant.ready?{giant:this.giant.checkpoint()}:{} )};}
 restoreCheckpoint(c:ClimateCheckpoint){this.air.surfaceMassCarry.set(c.surfaceMassCarry);this.air.forgetSurfaceProjection();this.ocean.restore(c.ocean);this.air.restoreCheckpoint(c.air);this.giant.restore(c.giant);if(c.giant)this.air.radiusMeters=c.giant.radiusMeters;this.lift.fill(0);this.wind.set(c.wind);this.currents.set(c.currents);this.seeds.set(c.seeds);}
 restore(saved?:ClimateSnapshot){if(saved&&!validClimate(saved,this.grid.count))throw new Error('기후 저장 상태가 올바르지 않습니다.');this.air.surfaceMassCarry.fill(0);if(saved?.surfaceMassCarry)this.air.surfaceMassCarry.set(saved.surfaceMassCarry);this.air.forgetSurfaceProjection();this.ocean.restore(saved?.ocean);this.air.restore(saved?.atmosphere);if(saved?.surfaceHeatCarry)this.air.surfaceHeatCarry.set(saved.surfaceHeatCarry);this.giant.restore(saved?.giant);if(saved?.giant)this.air.radiusMeters=saved.giant.radiusMeters;this.lift.fill(0);this.wind.fill(0);this.currents.fill(0);this.seeds.fill(0);if(saved){this.wind.set(saved.wind);this.currents.set(saved.currents);this.seeds.set(saved.seeds);}}
 seedLife(initial?:Float32Array){this.seeds.fill(1);if(initial)for(let i=0;i<this.grid.count;i++)initial[i*STRIDE+F.seed]=.08;}
 /** Re-derived from saved winds and current terrain: no stale cache after resume/edit. */
 private cloudLift(s:PhysicalState,index:number){
  let lift=0;for(const {i,j,distance,t} of this.incident[index]){const flow=t.reduce((a,v,k)=>a+v*(this.wind[i*3+k]+this.wind[j*3+k])*.5,0),slope=(solidHeight(s,j,this.grid)-solidHeight(s,i,this.grid))*HEIGHT_SCALE/RADIUS/distance;lift=Math.fround(lift+((index===i?-flow:flow)/distance+flow*slope)/3);}return lift;
 }
 conditions(s:PhysicalState,i:number,e:Environment){return this.giant.ready?this.giant.conditions(i):this.air.ready?this.air.conditions(s,i):cloudConditions(s,i,e);}
 prepareSurface(s:PhysicalState,e:Environment,energy?:Float32Array){if(s instanceof Float32Array&&!isDeepAtmosphere(e.body)){const actual=this.physicalSurface(s);this.prepareSurface(actual,e,energy);s.set(this.publishSurface(actual));return;}if(!e.climate&&this.air.ready)throw new Error('층별 대기가 있는 상태를 단일 저장고 모드로 바꿀 수 없습니다.');if(isDeepAtmosphere(e.body)){this.giant.initialize(s instanceof Float32Array?s:new Float32Array(s),e);this.air.radiusMeters=this.giant.radiusMeters;return;}this.ocean.configure(s,9.81*(e.gravity??1),energy);if(e.climate){this.air.detach(s,e,this.wind);this.ocean.setThermal(this.air);}else this.ocean.setThermal(this.air,false);}
 surfaceSupplies(s:PhysicalState,commands:PhysicalState,stride:number,energy:Float32Array){this.ocean.supplies(commands,stride,energy);if(this.air.ready)this.air.supplies(s,commands,stride,energy);this.ocean.externalPotential(s,energy);}
 energy(s:PhysicalState){if(this.giant.ready)return this.giant.totalEnergy();let h=0;for(let i=0;i<this.grid.count;i++)h+=this.air.surfaceEnergy(s,i);return h+this.air.totalEnergy()+this.ocean.energy();}
 stepGiant(s:Float32Array,dt:number,commands:PhysicalState,e:Environment,energy:Float32Array){this.giant.advance(s,dt,commands,e,energy);this.air.radiusMeters=this.giant.radiusMeters;this.currents.fill(0);this.seeds.fill(0);this.lift.fill(0);for(let i=0;i<this.grid.count;i++){const q=i*DEEP_LAYERS+this.giant.referenceLayer(i);for(let k=0;k<3;k++)this.wind[i*3+k]=this.giant.velocity[q*3+k]*AIR_SECONDS/this.giant.radiusMeters;}}
 step(s:PhysicalState,dt:number,e:Environment,energy:Float32Array,condensed?:Float32Array,precipitated?:Float32Array,escaped?:Float32Array,feeding?:Float32Array){
  if(s instanceof Float32Array){const actual=this.physicalSurface(s);this.step(actual,dt,e,energy,condensed,precipitated,escaped,feeding);s.set(this.publishSurface(actual));return;}
  if(!e.climate){
   if(this.air.ready)throw new Error('층별 대기가 있는 상태를 단일 저장고 모드로 바꿀 수 없습니다.');
   this.ocean.setThermal(this.air,false);this.ocean.configure(s,9.81*(e.gravity??1),energy);this.ocean.reconcile(s,energy);
   if(dt>0){this.ocean.drag(s,dt*AIR_SECONDS,energy);this.ocean.rotate(e.rotationRate??0,dt);this.ocean.transport(s,dt,this.air.radiusMeters,energy);}
   this.ocean.velocities(this.currents,this.air.radiusMeters);return;
  }
  if(!this.air.ready)this.prepareSurface(s,e,energy);
  this.ocean.configure(s,9.81*(e.gravity??1),energy);
  this.air.advance(s,dt,e,energy,condensed,precipitated,escaped);this.air.surfaceWind(this.wind);
  this.ocean.reconcile(s,energy);this.ocean.velocities(this.currents,this.air.radiusMeters);
  if(dt<=0)return;
  this.roundoff.fill(0);
  let live=0;for(let i=0;i<this.grid.count;i++)live+=s[i*STRIDE+F.plant]+s[i*STRIDE+F.seed];if(live===0)this.seeds.fill(0);
  const n=this.grid.count;
  for(let i=0;i<n;i++){const p=i*STRIDE;if(s[p+F.plant]+s[p+F.seed]>.000001)this.seeds[i]=Math.max(this.seeds[i],Math.min(1,.1+s[p+F.plant]+s[p+F.seed]*10));}
  this.ocean.stress(s,this.air,dt*AIR_SECONDS,energy);
  this.ocean.drag(s,dt*AIR_SECONDS,energy);this.ocean.rotate(e.rotationRate??0,dt);
  this.ocean.transport(s,dt,this.air.radiusMeters,energy);
  this.air.surfaceWind(this.wind);
  for(let i=0;i<n;i++)this.lift[i]=this.cloudLift(s,i);
  // Trace seed index is a bounded suitability/dispersal state, not extra biomass.
  const seedDelta=new Float64Array(n),out=new Float64Array(n),flows=this.edges.map(({i,j,distance,t})=>{const speed=t.reduce((a,b,k)=>a+b*(this.wind[i*3+k]+this.wind[j*3+k])*.5,0),donor=speed>=0?i:j,receiver=speed>=0?j:i,fraction=Math.abs(speed)*dt/(distance*3);out[donor]+=fraction;return {donor,receiver,fraction};});
  for(const {donor,receiver,fraction} of flows){const m=this.seeds[donor]*fraction*outgoingScale(1,out[donor],.25);seedDelta[donor]-=m;seedDelta[receiver]+=m;}
  for(const {i,j,distance} of this.edges){const d=(this.seeds[j]-this.seeds[i])*Math.min(1/NEIGHBORS,dt*.001/distance);seedDelta[i]+=d;seedDelta[j]-=d;}
  for(let i=0;i<n;i++)this.seeds[i]=clamp((this.seeds[i]+seedDelta[i])*Math.exp(-dt/1800));
  for(let i=0;i<n;i++){
   const p=i*STRIDE;
   // Light only enters the seed/plant terms below. A lifeless cell cannot
   // respond to it, so avoid a full spectral column solve for that cell.
   const canGrow=Math.abs(s[p+F.temperature]-22)<32&&s[p+F.water]>0&&s[p+F.water]<5&&s[p+F.dissolved]<Math.max(.001,s[p+F.water])/8;
   const light=canGrow&&(s[p+F.plant]>0||s[p+F.seed]>0||this.seeds[i]>0)?this.air.surfaceLight(s,i,e):0;
   const feedingBefore=feeding?.slice(i*2,i*2+2);
   if(s[p+F.soil]+s[p+F.plant]+s[p+F.herbivore]+s[p+F.carnivore]+s[p+F.seed]+s[p+F.photonEnergy]>0)this.air.surfaceReaction(s,i,fraction=>{
    if(feedingBefore)feeding!.set(feedingBefore,i*2);
    reactEcosystem(s,p,dt*fraction,{temperature:this.air.surfaceTemperature(s,i),light,absorbedSolar:this.air.absorbedSolar[i]*fraction,rootability:pioneerRootability(s,p),fixedTemperatureFields:ATMOSPHERE_MIRRORS,combustionHandled:true},feeding,i*2);
   },()=>{if(feedingBefore)feeding!.set(feedingBefore,i*2);});
   this.air.equilibrateSurfaceWater(s,i);
   if(s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide]+s[p+F.oxygen]+s[p+F.carbonMonoxide]<=1e-6)this.wind.fill(0,i*3,i*3+3);
  }
  this.ocean.reconcile(s,energy);this.ocean.velocities(this.currents,this.air.radiusMeters);
 }
}

export function climateColor(layer:ClimateLayer,s:PhysicalState,i:number,e:Environment,c:WeatherClimate):number[]{
 const p=i*STRIDE;if(layer==='none')return [0,0,0,0];
 if(layer==='airmass'){const warm=c.conditions(s,i,e).temperature>=15,wet=relativeHumidity(s,i,e,c)>=.6;return warm?(wet?[.20,.72,.38,.8]:[.92,.57,.19,.8]):(wet?[.16,.63,.82,.8]:[.55,.42,.83,.8]);}
 let v=0;
 const mars=e.body?.atmosphere.radiation==='thin-co2-grey';
 const deep=isDeepAtmosphere(e.body);if(deep&&layer==='temperature')v=(c.conditions(s,i,e).temperature+200)/150;
 if(layer==='temperature'&&!deep)v=mars?(s[p+F.temperature]+150)/180:(s[p+F.temperature]+30)/80;
 if(layer==='pressure'){const pressure=columnPressure(s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide]+s[p+F.oxygen]+s[p+F.carbonMonoxide],e.gravity??1);v=mars?pressure/1200:(pressure/101325-.6)/.8;}
 if(layer==='pressure'&&deep)v=c.giant.ready?(c.giant.bottomPressure(i)/c.giant.initialBottomPressure-.9)/.2:0;
 if(layer==='humidity')v=relativeHumidity(s,i,e,c);
 if(layer==='clouds')v=(s[p+F.cloud]+s[p+F.cloudIce]+s[p+F.ammoniaCloud]+s[p+F.ammoniaIce])*COLUMN_KG/(deep?50:.3);
 if(layer==='ammonia')v=(s[p+F.ammoniaCloud]+s[p+F.ammoniaIce])*COLUMN_KG/2;
 if(layer==='jets'){const x=c.grid.directions[i*3],z=c.grid.directions[i*3+2],length=Math.hypot(x,z),u=deep?c.giant.zonalWind(i):length>1e-9?(c.wind[i*3]*z-c.wind[i*3+2]*x)/length*c.air.radiusMeters/AIR_SECONDS:0;v=(u+250)/500;}
 if(layer==='dust')v=dustOpticalDepth(s[p+F.airborneDust]*COLUMN_KG)/3;
 if(layer==='co2ice')v=s[p+F.carbonDioxideIce]*COLUMN_KG;
 if(layer==='moisture')v=s[p+F.water]/.3;
 if(layer==='seeds')v=c.seeds[i];
 if(layer==='wind'||layer==='currents'){const a=layer==='wind'?c.wind:c.currents;v=Math.hypot(a[i*3],a[i*3+1],a[i*3+2])/(layer==='wind'?100*AIR_SECONDS/c.air.radiusMeters:2*AIR_SECONDS/c.air.radiusMeters);}
 v=clamp(v);return v<.5?[.12+v*.6,.25+v*.9,.78-v*.25,.82]:[.42+(v-.5)*1.14,.70-(v-.5)*1.0,.65-(v-.5)*1.1,.82];
}
