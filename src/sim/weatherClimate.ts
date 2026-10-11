import {F,STRIDE,capacity,enthalpy,phaseEnergy,solidHeight,equilibrateWater,type Environment} from './model';
import {NEIGHBORS,INVALID,HEIGHT_SCALE,RADIUS,type SphereGrid} from './sphere';
import {SPECIFIC_HEAT,PHASE_ENERGY} from './thermodynamics';
import {columnPressure,saturationMass,boilingPoint} from './waterPhysics';
import {albedo,transmittedLight} from './materialPhysics';
import {habitat} from './ecology';

export interface ClimateSnapshot {version:1;wind:number[];currents:number[];seeds:number[];}
export type ClimateLayer='none'|'temperature'|'pressure'|'wind'|'currents'|'humidity'|'airmass'|'clouds'|'moisture'|'seeds';
export const CLIMATE_LAYERS:Record<ClimateLayer,{name:string;legend:string}>= {
 none:{name:'물질',legend:'현재 표면 물질'},temperature:{name:'기온',legend:'공유 열 저장층 · −30 → 50°C'},
 pressure:{name:'기압',legend:'기체 기둥 무게 · 0.6 → 1.4 atm'},wind:{name:'기류',legend:'색: 속도 · 화살표: 방향 · 0 → 0.12 rad/게임초'},
 currents:{name:'해류',legend:'색: 속도 · 화살표: 방향 · 0 → 0.035 rad/게임초'},humidity:{name:'습도',legend:'상승 보정 구름층 · 0 → 100%'},
 airmass:{name:'기단',legend:'차고 건조 · 차고 습함 · 따뜻하고 건조 · 따뜻하고 습함'},
 clouds:{name:'구름량',legend:'물방울 + 구름 얼음 · 0 → 0.3 kg/셀'},
 moisture:{name:'수분',legend:'식생 이용 가능 물 · 0 → 0.3 kg/셀'},seeds:{name:'씨앗',legend:'정착 가능 씨앗 · 0 → 1 (게임 지수)'},
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
/** The same diagnostic cloud layer drives condensation, maps and the inspector. */
export function cloudConditions(s:Float32Array,i:number,e:Environment,lift=0){
 const p=i*STRIDE,temperature=s[p+F.temperature]-12-clamp(lift*60,-8,12),mass=s[p+F.cloud]+s[p+F.cloudIce],iceShare=mass>1e-8?s[p+F.cloudIce]/mass:(temperature< -12.001?1:0);
 const saturation=saturationMass(temperature,'water',s[p+F.nitrogen],s[p+F.methane],s[p+F.carbonDioxide],e.gravity??1)*(1-iceShare)+saturationMass(temperature,'ice',s[p+F.nitrogen],s[p+F.methane],s[p+F.carbonDioxide],e.gravity??1)*iceShare;
 return {temperature,lift,saturation,excess:s[p+F.vapor]-saturation,humidity:clamp(s[p+F.vapor]/Math.max(1e-12,saturation),0,2),pressure:columnPressure(s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide],e.gravity??1)};
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
 return s.version===1&&[s.wind,s.currents].every(a=>Array.isArray(a)&&a.length===count*3&&a.every(v=>Number.isFinite(v)&&Math.abs(v)<=.121))&&[s.wind,s.currents].every((a,k)=>Array.from({length:count},(_,i)=>Math.hypot(a[i*3],a[i*3+1],a[i*3+2])).every(speed=>speed<=(k===0?.12:.035)+1e-6))&&Array.isArray(s.seeds)&&s.seeds.length===count&&s.seeds.every(v=>Number.isFinite(v)&&v>=0&&v<=1);
}
/** Equal-volume graph columns; tangent momentum is a damped single-layer closure.
 * No vertical atmosphere/deep ocean is claimed. All material fluxes are pairwise,
 * donor-limited, and carry the donor's sensible + declared latent enthalpy. */
export class WeatherClimate {
 wind:Float32Array;currents:Float32Array;seeds:Float32Array;lift:Float32Array;
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
 snapshot():ClimateSnapshot{return {version:1,wind:[...this.wind],currents:[...this.currents],seeds:[...this.seeds]};}
 restore(saved?:ClimateSnapshot){this.lift.fill(0);this.wind.fill(0);this.currents.fill(0);this.seeds.fill(0);if(saved){if(!validClimate(saved,this.grid.count))throw new Error('기후 저장 상태가 올바르지 않습니다.');this.wind.set(saved.wind);this.currents.set(saved.currents);this.seeds.set(saved.seeds);}}
 seedLife(initial?:Float32Array){this.seeds.fill(1);if(initial)for(let i=0;i<this.grid.count;i++)initial[i*STRIDE+F.seed]=.08;}
 /** Re-derived from saved winds and current terrain: no stale cache after resume/edit. */
 private cloudLift(s:Float32Array,index:number){
  let lift=0;for(const {i,j,distance,t} of this.incident[index]){const flow=t.reduce((a,v,k)=>a+v*(this.wind[i*3+k]+this.wind[j*3+k])*.5,0),slope=(solidHeight(s,j,this.grid)-solidHeight(s,i,this.grid))*HEIGHT_SCALE/RADIUS/distance;lift=Math.fround(lift+((index===i?-flow:flow)/distance+flow*slope)/3);}return lift;
 }
 conditions(s:Float32Array,i:number,e:Environment){return cloudConditions(s,i,e,e.climate?this.cloudLift(s,i):0);}
 step(s:Float32Array,dt:number,e:Environment,energy:Float32Array,condensed?:Float32Array){
  if(dt<=0)return;
  this.roundoff.fill(0);
  let live=0;for(let i=0;i<this.grid.count;i++)live+=s[i*STRIDE+F.plant]+s[i*STRIDE+F.seed];if(live===0)this.seeds.fill(0);
  const n=this.grid.count,g=this.grid,acc=new Float64Array(n*3),sea=new Float64Array(n*3);
  for(let i=0;i<n;i++){const p=i*STRIDE;this.pressure[i]=columnPressure(s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide],e.gravity??1);if(s[p+F.plant]+s[p+F.seed]>.000001)this.seeds[i]=Math.max(this.seeds[i],Math.min(1,.1+s[p+F.plant]+s[p+F.seed]*10));}
  for(const edge of this.edges){const {i,j,distance,t}=edge,pi=i*STRIDE,pj=j*STRIDE;
   // Thermal thickness gradient represents unresolved vertical expansion.
   const potential=Math.log(Math.max(1e-6,this.pressure[j]))-Math.log(Math.max(1e-6,this.pressure[i]))+.003*(s[pj+F.temperature]-s[pi+F.temperature]);
   const force=-.008*clamp(potential,-2,2)/distance;
   const wet=Math.min(currentMobility(s,pi),currentMobility(s,pj));
   const head=(solidHeight(s,j,g)+s[pj+F.water]-solidHeight(s,i,g)-s[pi+F.water])*HEIGHT_SCALE/RADIUS;
   // Surface head + temperature/salinity density contrast, no deep overturning.
   const density=-.0002*(s[pj+F.temperature]-s[pi+F.temperature])+.008*(s[pj+F.dissolved]/Math.max(.2,s[pj+F.water])-s[pi+F.dissolved]/Math.max(.2,s[pi+F.water]));
   const ocean=-.006*wet*((e.gravity??1)*head+density)/distance;
   for(let k=0;k<3;k++){acc[i*3+k]+=force*t[k]/3;acc[j*3+k]+=force*t[k]/3;sea[i*3+k]+=ocean*t[k]/3;sea[j*3+k]+=ocean*t[k]/3;}
  }
  for(let i=0;i<n;i++){
   const p=i*STRIDE,v=i*3,normal=Array.from(g.directions.slice(v,v+3)),gas=s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide];
   for(const [field,forcing,drag,maxSpeed] of [[this.wind,acc,.15,.12],[this.currents,sea,.10,.035]] as const){
    let vec=[0,1,2].map(k=>(field[v+k]+dt*(forcing[v+k]+(field===this.currents?this.wind[v+k]*.035:0)))*Math.exp(-drag*dt));
    const dot=vec.reduce((a,b,k)=>a+b*normal[k],0);vec=vec.map((x,k)=>x-dot*normal[k]);vec=rotateCoriolis(vec,normal,e.rotationRate??0,dt);
    const limit=maxSpeed*(field===this.currents?currentMobility(s,p):1),scale=Math.min(1,limit/Math.max(1e-12,Math.hypot(...vec)));
    for(let k=0;k<3;k++)field[v+k]=(field===this.wind?gas>1e-6:mobileWater(s,p)>.2)?vec[k]*scale:0;
   }
  }
  this.transport(s,dt,this.wind,[F.vapor,F.nitrogen,F.methane,F.carbonDioxide,F.cloud,F.cloudIce,F.seed]);
  this.transport(s,dt,this.currents,[F.water,F.dissolved],true);
  for(let i=0;i<n;i++)this.lift[i]=this.cloudLift(s,i);
  // Trace seed index is a bounded suitability/dispersal state, not extra biomass.
  const seedDelta=new Float64Array(n),out=new Float64Array(n),flows=this.edges.map(({i,j,distance,t})=>{const speed=t.reduce((a,b,k)=>a+b*(this.wind[i*3+k]+this.wind[j*3+k])*.5,0),donor=speed>=0?i:j,receiver=speed>=0?j:i,fraction=Math.abs(speed)*dt/(distance*3);out[donor]+=fraction;return {donor,receiver,fraction};});
  for(const {donor,receiver,fraction} of flows){const m=this.seeds[donor]*fraction*Math.min(1,.25/Math.max(1e-12,out[donor]));seedDelta[donor]-=m;seedDelta[receiver]+=m;}
  for(const {i,j,distance} of this.edges){const d=(this.seeds[j]-this.seeds[i])*Math.min(1/NEIGHBORS,dt*.001/distance);seedDelta[i]+=d;seedDelta[j]-=d;}
  for(let i=0;i<n;i++)this.seeds[i]=clamp((this.seeds[i]+seedDelta[i])*Math.exp(-dt/1800));
  for(let i=0;i<n;i++){
   const p=i*STRIDE,dot=Math.max(0,[0,1,2].reduce((a,k)=>a+g.directions[i*3+k]*e.sun[k],0)),light=transmittedLight(dot,e.sunlight,s[p+F.cloud],s[p+F.cloudIce]);
   const optical=climateOpticalDepth(s,p);
   const h=enthalpy(s,i),q=radiativeHeat(capacity(s,i),s[p+F.temperature],1361*light*(1-albedo(s,p)),optical,dt);
   s[p+F.temperature]=(h+q-phaseEnergy(s,i))/capacity(s,i);energy[i*4]+=q;this.roundoff[i]+=enthalpy(s,i)-h-q;
   const cloudHeat=enthalpy(s,i);this.cloudPhase(s,i,dt,e,condensed);this.roundoff[i]+=enthalpy(s,i)-cloudHeat;
   // Pioneer plants root in mineral sediment. Organic matter is beneficial, not required.
   const suitable=habitat(s[p+F.temperature],s[p+F.water],s[p+F.dissolved],s[p+F.ice],light);
   const substrate=pioneerRootability(s,p),nutrients=.25+.75*s[p+F.soil]/(.2+s[p+F.soil]);
   const heat=enthalpy(s,i),sprout=Math.min(s[p+F.seed],s[p+F.seed]*.03*suitable*substrate*dt);s[p+F.seed]-=sprout;s[p+F.plant]+=sprout;
   const seedProduction=s[p+F.plant]*(1-Math.exp(-dt*.0003*suitable));s[p+F.plant]-=seedProduction;s[p+F.seed]+=seedProduction;
   const seedDecay=s[p+F.seed]*(1-Math.exp(-dt*.0001));s[p+F.seed]-=seedDecay;s[p+F.soil]+=seedDecay;
   const demand=(s[p+F.plant]*.065+this.seeds[i]*.0008)*suitable*substrate*nutrients*dt;
   // Biomass is a conserved bulk carbon proxy; not photosynthetic stoichiometry.
   const uptake=Math.min(s[p+F.carbonDioxide],demand);s[p+F.carbonDioxide]-=uptake;s[p+F.plant]+=uptake;
   const germination=Math.min(s[p+F.soil],this.seeds[i]*.0002*suitable*substrate*dt);s[p+F.soil]-=germination;s[p+F.plant]+=germination;
   const respiration=s[p+F.soil]*(1-Math.exp(-dt*.001*clamp((s[p+F.temperature]+10)/32)));s[p+F.soil]-=respiration;s[p+F.carbonDioxide]+=respiration;
   s[p+F.temperature]=(heat-phaseEnergy(s,i))/capacity(s,i);this.roundoff[i]+=enthalpy(s,i)-heat;const beforeEquilibrium=enthalpy(s,i);equilibrateWater(s,i);this.roundoff[i]+=enthalpy(s,i)-beforeEquilibrium;energy[i*4+3]+=this.roundoff[i];
   // Phase/biomass changes can remove the flowing reservoir in this same step.
   const v=i*3,limit=.035*currentMobility(s,p),scale=Math.min(1,limit/Math.max(1e-12,Math.hypot(this.currents[v],this.currents[v+1],this.currents[v+2])));for(let k=0;k<3;k++)this.currents[v+k]*=scale;
   if(s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide]<=1e-6)this.wind.fill(0,i*3,i*3+3);
  }
 }
 private cloudPhase(s:Float32Array,i:number,dt:number,e:Environment,condensed?:Float32Array){
  const p=i*STRIDE;if(s[p+F.vapor]+s[p+F.cloud]+s[p+F.cloudIce]<=0)return;
  const t=s[p+F.temperature],conditions=cloudConditions(s,i,e,this.lift[i]),air=conditions.temperature,h=enthalpy(s,i),ice=air< -12.001,cloud=s[p+F.cloud]+s[p+F.cloudIce],iceShare=cloud>1e-8?s[p+F.cloudIce]/cloud:(ice?1:0),excess=conditions.excess;
  if(excess>0&&air<boilingPoint(conditions.pressure)-5){const before=s[p+F.vapor],amount=Math.min(before,excess*(1-Math.exp(-dt*.4)));s[p+F.vapor]-=amount;s[p+(ice?F.cloudIce:F.cloud)]+=amount;if(condensed)condensed[i]+=before-s[p+F.vapor];}
  else if(excess<0&&cloud>0){const amount=Math.min(cloud,-excess*(1-Math.exp(-dt*.2)),Math.max(0,(t+100)*capacity(s,i)/2809)),frozen=Math.min(s[p+F.cloudIce],amount*iceShare),liquid=Math.min(s[p+F.cloud],Math.max(0,amount-frozen));s[p+F.cloudIce]-=frozen;s[p+F.cloud]-=liquid;s[p+F.vapor]+=liquid+frozen;}
  if(air< -12){const amount=s[p+F.cloud]*(1-Math.exp(-dt*.08));s[p+F.cloud]-=amount;s[p+F.cloudIce]+=amount;}
  if(air>0){const amount=Math.min(s[p+F.cloudIce]*(1-Math.exp(-dt*.15)),Math.max(0,(t+100)*capacity(s,i)/334));s[p+F.cloudIce]-=amount;s[p+F.cloud]+=amount;}
  s[p+F.temperature]=(h-phaseEnergy(s,i))/capacity(s,i);
 }
 private transport(s:Float32Array,dt:number,velocity:Float32Array,fields:number[],ocean=false){
  const out=new Float64Array(this.grid.count),flows=this.edges.map(({i,j,distance,t})=>{const speed=t.reduce((a,b,k)=>a+b*(velocity[i*3+k]+velocity[j*3+k])*.5,0),donor=speed>=0?i:j,receiver=speed>=0?j:i,fraction=Math.abs(speed)*dt/(distance*3)*(ocean?Math.min(currentMobility(s,i*STRIDE),currentMobility(s,j*STRIDE)):1);out[donor]+=fraction;return {donor,receiver,fraction};});
  this.delta.fill(0);this.heat.fill(0);
  for(const {donor,receiver,fraction} of flows){const dp=donor*STRIDE,rp=receiver*STRIDE,rate=fraction*Math.min(1,.25/Math.max(1e-12,out[donor]));for(const field of fields){const retained=ocean&&field===F.water?Math.min(1.2,s[dp+F.soil]*.12):0,m=Math.max(0,s[dp+field]-retained)*rate*(ocean&&field===F.dissolved?mobileWater(s,dp)/Math.max(1e-12,s[dp+F.water]):field===F.seed?.04:1),h=m*(SPECIFIC_HEAT[field]*s[dp+F.temperature]+PHASE_ENERGY[field]);this.delta[dp+field]-=m;this.delta[rp+field]+=m;this.heat[donor]-=h;this.heat[receiver]+=h;}}
  for(let i=0;i<this.grid.count;i++){const p=i*STRIDE,h=enthalpy(s,i)+this.heat[i];for(const field of fields)s[p+field]+=this.delta[p+field];s[p+F.temperature]=(h-phaseEnergy(s,i))/capacity(s,i);this.roundoff[i]+=enthalpy(s,i)-h;}
 }
}

export function climateColor(layer:ClimateLayer,s:Float32Array,i:number,e:Environment,c:WeatherClimate):number[]{
 const p=i*STRIDE;if(layer==='none')return [0,0,0,0];
 if(layer==='airmass'){const warm=s[p+F.temperature]>=15,wet=relativeHumidity(s,i,e,c)>=.6;return warm?(wet?[.20,.72,.38,.8]:[.92,.57,.19,.8]):(wet?[.16,.63,.82,.8]:[.55,.42,.83,.8]);}
 let v=0;
 if(layer==='temperature')v=(s[p+F.temperature]+30)/80;
 if(layer==='pressure')v=(columnPressure(s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide],e.gravity??1)/101325-.6)/.8;
 if(layer==='humidity')v=relativeHumidity(s,i,e,c);
 if(layer==='clouds')v=(s[p+F.cloud]+s[p+F.cloudIce])/.3;
 if(layer==='moisture')v=s[p+F.water]/.3;
 if(layer==='seeds')v=c.seeds[i];
 if(layer==='wind'||layer==='currents'){const a=layer==='wind'?c.wind:c.currents;v=Math.hypot(a[i*3],a[i*3+1],a[i*3+2])/(layer==='wind'?.12:.035);}
 v=clamp(v);return v<.5?[.12+v*.6,.25+v*.9,.78-v*.25,.82]:[.42+(v-.5)*1.14,.70-(v-.5)*1.0,.65-(v-.5)*1.1,.82];
}
