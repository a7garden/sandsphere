import {F,STRIDE,enthalpy,phaseEnergy,solidHeight,equilibrateWater,type Environment} from './model';
import {NEIGHBORS,INVALID,HEIGHT_SCALE,RADIUS,type SphereGrid} from './sphere';
import {SPECIFIC_HEAT,MATERIAL_ENERGY} from './thermodynamics';
import {columnPressure,saturationMass} from './waterPhysics';
import {reactEcosystem} from './ecology';
import {outgoingScale} from './conservativeTransport';
import {dustOpticalDepth} from './dustPhysics';
import {LayeredAtmosphere,emptyLayeredCheckpoint,layeredSnapshotFromCheckpoint,COLUMN_KG,AIR_RADIUS,AIR_SECONDS,validLayered,surfaceCapacity,surfaceEnthalpy,ATMOSPHERE_MIRRORS,type LayeredSnapshot,type LayeredCheckpoint} from './layeredAtmosphere';
import {DeepAtmosphere,DEEP_LAYERS,validDeep,type DeepSnapshot,type DeepCheckpoint} from './deepAtmosphere';
import {isDeepAtmosphere} from './planetDefinition';

export interface ClimateSnapshot {version:1|2|3;wind:number[];currents:number[];seeds:number[];atmosphere?:LayeredSnapshot;giant?:DeepSnapshot;}
export interface ClimateCheckpoint {wind:Float32Array;currents:Float32Array;seeds:Float32Array;air:LayeredCheckpoint;giant?:DeepCheckpoint;}
export type ClimateLayer='none'|'temperature'|'pressure'|'wind'|'jets'|'ammonia'|'currents'|'humidity'|'airmass'|'clouds'|'moisture'|'seeds'|'dust'|'co2ice';
export const CLIMATE_LAYERS:Record<ClimateLayer,{name:string;legend:string}>= {
 none:{name:'물질',legend:'현재 표면 물질'},temperature:{name:'지표 온도',legend:'지표 열 저장층 · −30 → 50°C'},
 pressure:{name:'기압',legend:'기체 기둥 무게 · 0.6 → 1.4 atm'},wind:{name:'기류',legend:'색: 속도 · 화살표: 방향 · 0 → 100 m/s'},
 jets:{name:'동서 제트',legend:'서향 −250 ← 0 → 동향 250 m/s'},ammonia:{name:'암모니아 구름',legend:'NH₃ 액체 + 얼음 · 0 → 2 kg/m²'},
 currents:{name:'해류',legend:'색: 속도 · 화살표: 방향 · 0 → 0.035 rad/게임초'},humidity:{name:'습도',legend:'응축물이 가장 많은 대기층 · 0 → 100%'},
 airmass:{name:'기단',legend:'차고 건조 · 차고 습함 · 따뜻하고 건조 · 따뜻하고 습함'},
 clouds:{name:'구름량',legend:'물방울 + 구름 얼음 · 0 → 0.3 kg/m²'},
 moisture:{name:'수분',legend:'식생 이용 가능 물 · 0 → 0.3 kg/셀'},seeds:{name:'씨앗',legend:'정착 가능 씨앗 · 0 → 1 (게임 지수)'},
 dust:{name:'대기 먼지',legend:'먼지 광학 깊이 · 0 → 3'},co2ice:{name:'CO₂ 얼음',legend:'지표 CO₂ 얼음 · 0 → 1 kg/m²'},
};
const mobileWater=(s:Float32Array,p:number)=>Math.max(0,s[p+F.water]-Math.min(1.2,s[p+F.soil]*.12));
const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
/** A thin surface reservoir loses current mobility smoothly. The 0.2–0.5 kg
 * interval is a game column scale, not an ocean depth in metres. Smoothstep
 * avoids a finite velocity jump at a Float32 ice/liquid threshold. */
export function currentMobility(s:Float32Array,p:number){const x=clamp((mobileWater(s,p)-.2)/.3);return x*x*(3-2*x);}
/** Grey-body TOA energy balance in game kJ and time, not an Earth forecast.
 * Implicit longwave cooling is monotone even for furnace temperatures. */
export function radiativeHeat(c:number,t:number,shortwave:number,opticalDepth:number,dt:number){
 if(dt<=0)return 0;
 const area=.004,sigma=5.670374419e-8,emissivity=1/(1+.75*Math.max(0,opticalDepth));
 let lo=-100,hi=2500;
 for(let k=0;k<40;k++){const mid=(lo+hi)/2,residual=c*(mid-t)-dt*area*(shortwave-emissivity*sigma*Math.pow(mid+273.15,4));if(residual>0)hi=mid;else lo=mid;}
 return c*((lo+hi)/2-t);
}
export function climateOpticalDepth(s:Float32Array,p:number){return 1.4*Math.log1p(s[p+F.carbonDioxide]/.003)+.25*Math.log1p(s[p+F.vapor]/.002)+.4*Math.log1p(s[p+F.methane]/.0002)+.12*(s[p+F.cloud]+s[p+F.cloudIce]);}
export function pioneerRootability(s:Float32Array,p:number){return clamp((s[p+F.sand]+s[p+F.clay]+s[p+F.soil])*4);}
/** Legacy/uninitialized fallback. Active climate uses stored layer state. */
export function cloudConditions(s:Float32Array,i:number,e:Environment,lift=0){
 const p=i*STRIDE,temperature=s[p+F.temperature],mass=s[p+F.cloud]+s[p+F.cloudIce],iceShare=mass>1e-8?s[p+F.cloudIce]/mass:(temperature< -12.001?1:0);
 const saturation=saturationMass(temperature,'water',s[p+F.nitrogen],s[p+F.methane],s[p+F.carbonDioxide],e.gravity??1,1,s[p+F.oxygen],s[p+F.carbonMonoxide])*(1-iceShare)+saturationMass(temperature,'ice',s[p+F.nitrogen],s[p+F.methane],s[p+F.carbonDioxide],e.gravity??1,1,s[p+F.oxygen],s[p+F.carbonMonoxide])*iceShare;
 return {height:0,layer:0,temperature,lift,saturation,excess:s[p+F.vapor]-saturation,humidity:clamp(s[p+F.vapor]/Math.max(1e-12,saturation),0,2),pressure:columnPressure(s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide]+s[p+F.oxygen]+s[p+F.carbonMonoxide],e.gravity??1)};
}
export function relativeHumidity(s:Float32Array,i:number,e:Environment,c?:WeatherClimate){return (c&&e.climate?c.conditions(s,i,e):cloudConditions(s,i,e)).humidity;}
export function flowCellSpeed(velocity:Float32Array,i:number,count:number){return Math.hypot(velocity[i*3],velocity[i*3+1],velocity[i*3+2])/Math.sqrt(4*Math.PI/count);}
type ClimateEdge={i:number;j:number;distance:number;t:number[]};
export function rotateCoriolis(v:readonly number[],n:readonly number[],rate:number,dt:number){
 const a=2*rate*n[1]*dt,c=Math.cos(a),s=-Math.sin(a);
 return [v[0]*c+(n[1]*v[2]-n[2]*v[1])*s,v[1]*c+(n[2]*v[0]-n[0]*v[2])*s,v[2]*c+(n[0]*v[1]-n[1]*v[0])*s];
}
export function validClimate(value:unknown,count:number):value is ClimateSnapshot{
 if(!value||typeof value!=='object')return false;const s=value as ClimateSnapshot;
 return [1,2,3].includes(s.version)&&(s.atmosphere===undefined||s.version===2&&validLayered(s.atmosphere,count))
  &&(s.giant===undefined?s.version!==3:s.version===3&&s.atmosphere===undefined&&validDeep(s.giant,count))
  &&[s.wind,s.currents].every(a=>Array.isArray(a)&&a.length===count*3&&a.every(v=>Number.isFinite(v)&&Math.abs(v)<=(s.version===1?.121:.31)))&&[s.wind,s.currents].every((a,k)=>Array.from({length:count},(_,i)=>Math.hypot(a[i*3],a[i*3+1],a[i*3+2])).every(speed=>speed<=(k===0?(s.version===1?.12:.31):.035)+1e-6))&&Array.isArray(s.seeds)&&s.seeds.length===count&&s.seeds.every(v=>Number.isFinite(v)&&v>=0&&v<=1)
  &&(!s.giant||[...s.seeds,...s.currents].every(v=>v===0));
}
/** Stratified atmosphere coupled to the retained shallow ocean/ecology model.
 * Atmospheric inventories, enthalpy and tangent momentum share edge fluxes. */
export class WeatherClimate {
 wind:Float32Array;currents:Float32Array;seeds:Float32Array;lift:Float32Array;
 private airInstance?:LayeredAtmosphere;private giantInstance?:DeepAtmosphere;
 get air(){if(!this.airInstance){this.airInstance=new LayeredAtmosphere(this.grid,this.edges);if(this.giantReady)this.airInstance.radiusMeters=this.giant.radiusMeters;}return this.airInstance;}
 get giant(){return this.giantInstance??=new DeepAtmosphere(this.grid,this.edges);}
 get airReady(){return this.airInstance?.ready??false;}
 get giantReady(){return this.giantInstance?.ready??false;}
 get radiusMeters(){return this.giantReady?this.giant.radiusMeters:this.airInstance?.radiusMeters??AIR_RADIUS;}
 private edges:ClimateEdge[]=[];private incident:ClimateEdge[][];
 private roundoff:Float64Array;private pressure:Float64Array;private delta:Float64Array;private heat:Float64Array;
 constructor(readonly grid:SphereGrid){
  this.lift=new Float32Array(grid.count);this.wind=new Float32Array(grid.count*3);this.currents=new Float32Array(grid.count*3);this.seeds=new Float32Array(grid.count);
  this.roundoff=new Float64Array(grid.count);this.pressure=new Float64Array(grid.count);this.delta=new Float64Array(grid.count*STRIDE);this.heat=new Float64Array(grid.count);
  this.incident=Array.from({length:grid.count},()=>[]);
  for(let i=0;i<grid.count;i++)for(let k=0;k<NEIGHBORS;k++){const j=grid.neighbors[i*NEIGHBORS+k];if(j===INVALID||j<=i)continue;
   const a=Array.from(grid.directions.slice(i*3,i*3+3)),b=Array.from(grid.directions.slice(j*3,j*3+3)),d=b.map((v,k)=>v-a[k]),length=Math.hypot(...d);
   const edge={i,j,distance:2*Math.asin(Math.min(1,length/2)),t:d.map(v=>v/length)};this.edges.push(edge);this.incident[i].push(edge);this.incident[j].push(edge);
  }
 }
 snapshot():ClimateSnapshot{return {...(this.giantReady?{version:3 as const,giant:this.giant.snapshot()}:{version:2 as const,atmosphere:this.airInstance?.snapshot()}),wind:[...this.wind],currents:[...this.currents],seeds:[...this.seeds]};}
 checkpoint():ClimateCheckpoint{return {wind:this.wind.slice(),currents:this.currents.slice(),seeds:this.seeds.slice(),air:this.airInstance?.checkpoint()??emptyLayeredCheckpoint(this.radiusMeters),...(this.giantReady?{giant:this.giant.checkpoint()}:{} )};}
 /** Capture typed ownership now; allocate ordinary arrays only when a reader
  * actually requests this completed snapshot. Later solver steps cannot alter it. */
 deferredSnapshot(){const checkpoint=this.checkpoint();let cached:ClimateSnapshot|undefined;return ()=>cached??=climateSnapshotFromCheckpoint(checkpoint);}
 restoreCheckpoint(c:ClimateCheckpoint){
  if(c.air.initialized)this.air.restoreCheckpoint(c.air);else this.airInstance=undefined;
  if(c.giant)this.giant.restore(c.giant);else this.giantInstance=undefined;
  if(c.giant&&this.airInstance)this.airInstance.radiusMeters=c.giant.radiusMeters;
  this.lift.fill(0);this.wind.set(c.wind);this.currents.set(c.currents);this.seeds.set(c.seeds);
 }
 restore(saved?:ClimateSnapshot){
  if(saved&&!validClimate(saved,this.grid.count))throw new Error('기후 저장 상태가 올바르지 않습니다.');
  if(saved?.atmosphere)this.air.restore(saved.atmosphere);else this.airInstance=undefined;
  if(saved?.giant)this.giant.restore(saved.giant);else this.giantInstance=undefined;
  this.lift.fill(0);this.wind.fill(0);this.currents.fill(0);this.seeds.fill(0);if(saved){this.wind.set(saved.wind);this.currents.set(saved.currents);this.seeds.set(saved.seeds);}
 }

 seedLife(initial?:Float32Array){this.seeds.fill(1);if(initial)for(let i=0;i<this.grid.count;i++)initial[i*STRIDE+F.seed]=.08;}
 /** Re-derived from saved winds and current terrain: no stale cache after resume/edit. */
 private cloudLift(s:Float32Array,index:number){
  let lift=0;for(const {i,j,distance,t} of this.incident[index]){const flow=t.reduce((a,v,k)=>a+v*(this.wind[i*3+k]+this.wind[j*3+k])*.5,0),slope=(solidHeight(s,j,this.grid)-solidHeight(s,i,this.grid))*HEIGHT_SCALE/RADIUS/distance;lift=Math.fround(lift+((index===i?-flow:flow)/distance+flow*slope)/3);}return lift;
 }
 conditions(s:Float32Array,i:number,e:Environment){return this.giantReady?this.giant.conditions(i):this.airReady?this.air.conditions(s,i):cloudConditions(s,i,e);}
 prepareSurface(s:Float32Array,e:Environment){if(isDeepAtmosphere(e.body)){this.giant.initialize(s,e);if(this.airInstance)this.airInstance.radiusMeters=this.giant.radiusMeters;return;}this.air.detach(s,e,this.wind);}
 surfaceSupplies(s:Float32Array,commands:Float32Array,stride:number,energy:Float32Array){this.air.supplies(s,commands,stride,energy);}
 energy(s:Float32Array){if(this.giantReady)return this.giant.totalEnergy();let h=0;for(let i=0;i<this.grid.count;i++)h+=surfaceEnthalpy(s,i);return h+(this.airInstance?.totalEnergy()??0);}
 stepGiant(s:Float32Array,dt:number,commands:Float32Array,e:Environment,energy:Float32Array){this.giant.advance(s,dt,commands,e,energy);if(this.airInstance)this.airInstance.radiusMeters=this.giant.radiusMeters;this.currents.fill(0);this.seeds.fill(0);this.lift.fill(0);for(let i=0;i<this.grid.count;i++){const q=i*DEEP_LAYERS+this.giant.referenceLayer(i);for(let k=0;k<3;k++)this.wind[i*3+k]=this.giant.velocity[q*3+k]*AIR_SECONDS/this.giant.radiusMeters;}}
 step(s:Float32Array,dt:number,e:Environment,energy:Float32Array,condensed?:Float32Array,precipitated?:Float32Array,escaped?:Float32Array,feeding?:Float32Array){
  if(!this.airReady)this.prepareSurface(s,e);
  this.air.advance(s,dt,e,energy,condensed,precipitated,escaped);this.air.surfaceWind(this.wind);
  if(dt<=0)return;
  this.roundoff.fill(0);
  let live=0;for(let i=0;i<this.grid.count;i++)live+=s[i*STRIDE+F.plant]+s[i*STRIDE+F.seed];if(live===0)this.seeds.fill(0);
  const n=this.grid.count,g=this.grid,sea=new Float64Array(n*3);
  for(let i=0;i<n;i++){const p=i*STRIDE;this.pressure[i]=columnPressure(s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide]+s[p+F.oxygen]+s[p+F.carbonMonoxide],e.gravity??1);if(s[p+F.plant]+s[p+F.seed]>.000001)this.seeds[i]=Math.max(this.seeds[i],Math.min(1,.1+s[p+F.plant]+s[p+F.seed]*10));}
  for(const edge of this.edges){const {i,j,distance,t}=edge,pi=i*STRIDE,pj=j*STRIDE;
   const wet=Math.min(currentMobility(s,pi),currentMobility(s,pj));
   const head=(solidHeight(s,j,g)+s[pj+F.water]-solidHeight(s,i,g)-s[pi+F.water])*HEIGHT_SCALE/RADIUS;
   // Surface head + temperature/salinity density contrast, no deep overturning.
   const density=-.0002*(s[pj+F.temperature]-s[pi+F.temperature])+.008*(s[pj+F.dissolved]/Math.max(.2,s[pj+F.water])-s[pi+F.dissolved]/Math.max(.2,s[pi+F.water]));
   const ocean=-.006*wet*((e.gravity??1)*head+density)/distance;
   for(let k=0;k<3;k++){sea[i*3+k]+=ocean*t[k]/3;sea[j*3+k]+=ocean*t[k]/3;}
  }
  for(let i=0;i<n;i++){
   const p=i*STRIDE,v=i*3,normal=Array.from(g.directions.slice(v,v+3)),gas=s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide]+s[p+F.oxygen]+s[p+F.carbonMonoxide];
   for(const [field,forcing,drag,maxSpeed] of [[this.currents,sea,.10,.035]] as const){
    let vec=[0,1,2].map(k=>(field[v+k]+dt*(forcing[v+k]+(field===this.currents?this.wind[v+k]*.035:0)))*Math.exp(-drag*dt));
    const dot=vec.reduce((a,b,k)=>a+b*normal[k],0);vec=vec.map((x,k)=>x-dot*normal[k]);vec=rotateCoriolis(vec,normal,e.rotationRate??0,dt);
    const limit=maxSpeed*(field===this.currents?currentMobility(s,p):1),scale=Math.min(1,limit/Math.max(1e-12,Math.hypot(...vec)));
    for(let k=0;k<3;k++)field[v+k]=(field===this.wind?gas>1e-6:mobileWater(s,p)>.2)?vec[k]*scale:0;
   }
  }
  this.transport(s,dt,this.currents,[F.water,F.dissolved],true);
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
   const heat=surfaceEnthalpy(s,i)+this.air.columnEnergy(i);
   this.air.surfaceReaction(s,i,()=>reactEcosystem(s,p,dt,{temperature:s[p+F.temperature],light,absorbedSolar:this.air.absorbedSolar[i],rootability:pioneerRootability(s,p),fixedTemperatureFields:ATMOSPHERE_MIRRORS,combustionHandled:true},feeding,i*2));
   const airPhase=ATMOSPHERE_MIRRORS.reduce((a,f)=>a+s[p+f]*MATERIAL_ENERGY[f],0);
   s[p+F.temperature]=(heat-this.air.columnEnergy(i)-phaseEnergy(s,i)+airPhase)/surfaceCapacity(s,i);
   // Surface equilibrium must not include mirror gas/cloud heat capacity.
   const saved=ATMOSPHERE_MIRRORS.map(f=>s[p+f]);for(const f of ATMOSPHERE_MIRRORS)s[p+f]=0;
   const beforeEquilibrium=enthalpy(s,i);this.roundoff[i]+=beforeEquilibrium+this.air.columnEnergy(i)-heat;equilibrateWater(s,i);this.roundoff[i]+=enthalpy(s,i)-beforeEquilibrium;
   ATMOSPHERE_MIRRORS.forEach((f,k)=>s[p+f]=saved[k]);energy[i*4+3]+=this.roundoff[i];
   // Phase/biomass changes can remove the flowing reservoir in this same step.
   const v=i*3,limit=.035*currentMobility(s,p),scale=Math.min(1,limit/Math.max(1e-12,Math.hypot(this.currents[v],this.currents[v+1],this.currents[v+2])));for(let k=0;k<3;k++)this.currents[v+k]*=scale;
   if(s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide]+s[p+F.oxygen]+s[p+F.carbonMonoxide]<=1e-6)this.wind.fill(0,i*3,i*3+3);
  }
 }
 private transport(s:Float32Array,dt:number,velocity:Float32Array,fields:number[],ocean=false){
  const out=new Float64Array(this.grid.count),flows=this.edges.map(({i,j,distance,t})=>{const speed=t.reduce((a,b,k)=>a+b*(velocity[i*3+k]+velocity[j*3+k])*.5,0),donor=speed>=0?i:j,receiver=speed>=0?j:i,fraction=Math.abs(speed)*dt/(distance*3)*(ocean?Math.min(currentMobility(s,i*STRIDE),currentMobility(s,j*STRIDE)):1);out[donor]+=fraction;return {donor,receiver,fraction};});
  this.delta.fill(0);this.heat.fill(0);
  for(const {donor,receiver,fraction} of flows){const dp=donor*STRIDE,rp=receiver*STRIDE,rate=fraction*outgoingScale(1,out[donor],.25);for(const field of fields){const retained=ocean&&field===F.water?Math.min(1.2,s[dp+F.soil]*.12):0,m=Math.max(0,s[dp+field]-retained)*rate*(ocean&&field===F.dissolved?mobileWater(s,dp)/Math.max(1e-12,s[dp+F.water]):field===F.seed?.04:1),h=m*(SPECIFIC_HEAT[field]*s[dp+F.temperature]+MATERIAL_ENERGY[field]);this.delta[dp+field]-=m;this.delta[rp+field]+=m;this.heat[donor]-=h;this.heat[receiver]+=h;}}
  for(let i=0;i<this.grid.count;i++){const p=i*STRIDE,h=surfaceEnthalpy(s,i)+this.heat[i];for(const field of fields)s[p+field]+=this.delta[p+field];const airPhase=ATMOSPHERE_MIRRORS.reduce((a,f)=>a+s[p+f]*MATERIAL_ENERGY[f],0);s[p+F.temperature]=(h-phaseEnergy(s,i)+airPhase)/surfaceCapacity(s,i);this.roundoff[i]+=surfaceEnthalpy(s,i)-h;}
 }
}

export function climateColor(layer:ClimateLayer,s:Float32Array,i:number,e:Environment,c:WeatherClimate):number[]{
 const p=i*STRIDE;if(layer==='none')return [0,0,0,0];
 if(layer==='airmass'){const warm=c.conditions(s,i,e).temperature>=15,wet=relativeHumidity(s,i,e,c)>=.6;return warm?(wet?[.20,.72,.38,.8]:[.92,.57,.19,.8]):(wet?[.16,.63,.82,.8]:[.55,.42,.83,.8]);}
 let v=0;
 const mars=e.body?.atmosphere.radiation==='thin-co2-grey';
 const deep=isDeepAtmosphere(e.body);if(deep&&layer==='temperature')v=(c.conditions(s,i,e).temperature+200)/150;
 if(layer==='temperature'&&!deep)v=mars?(s[p+F.temperature]+150)/180:(s[p+F.temperature]+30)/80;
 if(layer==='pressure'){const pressure=columnPressure(s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide]+s[p+F.oxygen]+s[p+F.carbonMonoxide],e.gravity??1);v=mars?pressure/1200:(pressure/101325-.6)/.8;}
 if(layer==='pressure'&&deep)v=c.giantReady?(c.giant.bottomPressure(i)/c.giant.initialBottomPressure-.9)/.2:0;
 if(layer==='humidity')v=relativeHumidity(s,i,e,c);
 if(layer==='clouds')v=(s[p+F.cloud]+s[p+F.cloudIce]+s[p+F.ammoniaCloud]+s[p+F.ammoniaIce])*COLUMN_KG/(deep?50:.3);
 if(layer==='ammonia')v=(s[p+F.ammoniaCloud]+s[p+F.ammoniaIce])*COLUMN_KG/2;
 if(layer==='jets'){const x=c.grid.directions[i*3],z=c.grid.directions[i*3+2],length=Math.hypot(x,z),u=deep?c.giant.zonalWind(i):length>1e-9?(c.wind[i*3]*z-c.wind[i*3+2]*x)/length*c.air.radiusMeters/AIR_SECONDS:0;v=(u+250)/500;}
 if(layer==='dust')v=dustOpticalDepth(s[p+F.airborneDust]*COLUMN_KG)/3;
 if(layer==='co2ice')v=s[p+F.carbonDioxideIce]*COLUMN_KG;
 if(layer==='moisture')v=s[p+F.water]/.3;
 if(layer==='seeds')v=c.seeds[i];
 if(layer==='wind'||layer==='currents'){const a=layer==='wind'?c.wind:c.currents;v=Math.hypot(a[i*3],a[i*3+1],a[i*3+2])/(layer==='wind'?100*AIR_SECONDS/c.air.radiusMeters:.035);}
 v=clamp(v);return v<.5?[.12+v*.6,.25+v*.9,.78-v*.25,.82]:[.42+(v-.5)*1.14,.70-(v-.5)*1.0,.65-(v-.5)*1.1,.82];
}

export function climateSnapshotFromCheckpoint(c:ClimateCheckpoint):ClimateSnapshot {
 const giant=c.giant;
 return {...(giant?{version:3 as const,giant:{...giant,mass:[...giant.mass],temperature:[...giant.temperature],velocity:[...giant.velocity],height:[...giant.height]}}:{version:2 as const,atmosphere:layeredSnapshotFromCheckpoint(c.air)}),wind:[...c.wind],currents:[...c.currents],seeds:[...c.seeds]};
}
