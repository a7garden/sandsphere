import {F,STRIDE,MASS_FIELDS,totalEnthalpy,type Environment} from './model';
import {CLOUD_VISIBLE_MASS} from './layeredAtmosphere';
import type {ClimateSnapshot} from './weatherClimate';
import {atmosphereState} from './atmosphere';

export type MetricGroup='matter'|'thermal'|'water'|'atmosphere'|'ecology'|'budget';
export interface Metric {key:string;name:string;symbol:string;unit:string;group:MetricGroup;digits:number;color?:string;tip?:string;}
const mass=(key:string,name:string,group:MetricGroup,color?:string):Metric=>({key,name,symbol:name,unit:'kg',group,digits:2,color});
export const METRICS:Metric[]=[
 mass('mass','총 질량','matter'),mass('surface','표면 · 대기','matter'),mass('airborne','낙하 · 투입 대기','matter'),
 mass('terrain','지형 고체','matter','#b79a69'),mass('liquid','액체 · 용융체','matter','#4294ae'),mass('ice','표면 얼음','matter','#87bbcb'),
 mass('gas','기체','matter','#9972b1'),mass('cloud','구름 응축물','matter','#7d8a97'),{...mass('biomass','생물 총량','ecology','#5b956f'),tip:'식생 + 초식·포식 생물 + 휴면 씨앗 질량. 씨앗 분산 지수는 질량에 포함하지 않습니다.'},
 ...[['rock','기반암'],['sand','모래'],['clay','점토'],['ceramic','도자기'],['glass','유리'],['molten','용융 실리카'],['salt','소금 결정'],['dissolved','용존 소금'],['iron','운철']].map(([key,name])=>mass(key,name,'matter')),
 {key:'tempMean',name:'평균 온도',symbol:'T̄',unit:'°C',group:'thermal',digits:2,tip:'표면 셀의 산술 평균'},
 {key:'tempMin',name:'최저 온도',symbol:'Tmin',unit:'°C',group:'thermal',digits:2,color:'#5a92bd'},
 {key:'tempP10',name:'온도 P10',symbol:'T₁₀',unit:'°C',group:'thermal',digits:2},
 {key:'tempMedian',name:'온도 중앙값',symbol:'T₅₀',unit:'°C',group:'thermal',digits:2},
 {key:'tempP90',name:'온도 P90',symbol:'T₉₀',unit:'°C',group:'thermal',digits:2},
 {key:'tempMax',name:'최고 온도',symbol:'Tmax',unit:'°C',group:'thermal',digits:2,color:'#c17950'},
 {key:'enthalpy',name:'총 엔탈피',symbol:'H',unit:'kJ',group:'thermal',digits:2,tip:'0°C 기준 현열 + 모델 상 에너지. 기반 열용량 포함.'},
 mass('waterTotal','H₂O 총량','water'),mass('water','액체 물','water','#4294ae'),mass('waterIce','얼음','water','#87bbcb'),mass('vapor','수증기','water','#9972b1'),mass('cloudWater','구름 물방울','water','#8599a6'),mass('cloudIce','구름 얼음','water','#a7b9c6'),
 {key:'rainRate',name:'비 강수율',symbol:'Ṁrain',unit:'kg/s',group:'water',digits:4,color:'#4294ae'},
 {key:'snowRate',name:'눈 강수율',symbol:'Ṁsnow',unit:'kg/s',group:'water',digits:4,color:'#87bbcb'},
 mass('rainTotal','누적 비','water'),mass('snowTotal','누적 눈','water'),
 {key:'cloudCover',name:'구름 셀 비율',symbol:'Ccloud',unit:'%',group:'water',digits:2,tip:'광학 깊이 > 0.1인 셀 / 전체 셀'},
 {key:'rainCover',name:'비 셀 비율',symbol:'Crain',unit:'%',group:'water',digits:2,tip:'직전 물리 단계에서 강수 > 10⁻⁶ kg인 셀 / 전체 셀'},
 {key:'snowCover',name:'눈 셀 비율',symbol:'Csnow',unit:'%',group:'water',digits:2},
 {key:'pressure',name:'표면 평균 압력',symbol:'p₀',unit:'atm',group:'atmosphere',digits:4,tip:'게임 기준 기체 컬럼 질량과 중력으로 환산'},
 {key:'gasTemp',name:'기체 온도',symbol:'Tgas',unit:'°C',group:'atmosphere',digits:2,tip:'몰 수 가중 평균'},
 {key:'scaleHeight',name:'스케일 높이',symbol:'H₀',unit:'km',group:'atmosphere',digits:2},
 {key:'boundary',name:'0.01 atm 경계',symbol:'h₀.₀₁',unit:'km',group:'atmosphere',digits:2,tip:'등온 구면 근사 · 기준 반경 1,000 km. 유한 경계가 없으면 —'},
 {key:'binding',name:'최소 결합 매개변수',symbol:'λmin',unit:'',group:'atmosphere',digits:3},
 mass('nitrogen','질소 질량','atmosphere'),mass('methane','메탄 질량','atmosphere'),mass('carbonDioxide','CO₂ 질량','atmosphere'),
 ...[['nitrogen','질소','N₂'],['methane','메탄','CH₄'],['carbonDioxide','이산화탄소','CO₂'],['vapor','수증기','H₂O']].map(([id,name,symbol])=>({key:'mole_'+id,name:name+' 몰 분율',symbol:'x'+symbol,unit:'%',group:'atmosphere' as const,digits:3})),
 mass('soil','유기물','ecology','#a18a68'),mass('plant','식생','ecology','#5b956f'),mass('seed','휴면 씨앗','ecology','#a18a68'),mass('herbivore','초식 생물','ecology','#ae9c4d'),mass('carnivore','포식 생물','ecology','#ba7968'),
 {key:'plantCover',name:'식생 셀 비율',symbol:'Cplant',unit:'%',group:'ecology',digits:2,tip:'식생 > 0.01 kg인 셀 / 전체 셀'},
 mass('supplied','외부 공급','budget'),mass('transferredIn','인벤토리 투입','budget'),mass('removed','깎기 배출','budget'),mass('transferredOut','인벤토리 회수','budget'),mass('escaped','우주 탈출','budget'),
 ...['환경 열교환','명령 · 공급 · 충돌','탈출 에너지','수치 보정'].map((name,i)=>({key:'energy'+i,name,symbol:['Qenv','Qcmd','Qesc','Qnum'][i],unit:'kJ',group:'budget' as const,digits:3,color:['#c17950','#7e8c62','#5a92bd','#9972b1'][i]})),
];
export const metricByKey=new Map(METRICS.map(m=>[m.key,m]));
export interface Budget {supplied:number;removed:number;escaped:number;transferredIn:number;transferredOut:number;}
export interface TelemetryInput extends Budget {time:number;state:Float32Array;environment:Environment;climate?:ClimateSnapshot;airborne?:number;pending?:number;}
export interface TelemetryPoint {time:number;values:Record<string,number|null>;histogram:number[];bins:number[];profileValid:boolean;detailsUnavailable?:true;}
export interface TelemetryGap {start:number;end:number;}
export interface PlanetTelemetry {id:string;name:string;points:TelemetryPoint[];baseline:TelemetryPoint;energy:Float64Array;rain:number;snow:number;rainRate:number|null;snowRate:number|null;rainCover:number|null;snowCover:number|null;lastSample:number;interval:number;gaps?:TelemetryGap[];}

function quantile(sorted:number[],q:number){const p=(sorted.length-1)*q,i=Math.floor(p);return sorted[i]+(sorted[Math.min(i+1,sorted.length-1)]-sorted[i])*(p-i);}
/** Measured game quantities, never inferred historical values or Earth-scale totals. */
export function measurePlanet(input:TelemetryInput):TelemetryPoint {
 const {state,environment}=input,n=state.length/STRIDE,t=new Float64Array(STRIDE),temperatures:number[]=[];
 let cloudCells=0,plantCells=0;
 for(let p=0;p<state.length;p+=STRIDE){for(const f of MASS_FIELDS)t[f]+=state[p+f];temperatures.push(state[p+F.temperature]);if(state[p+F.cloud]+state[p+F.cloudIce]>CLOUD_VISIBLE_MASS)cloudCells++;if(state[p+F.plant]>.01)plantCells++;}
 const a=atmosphereState(state,environment,input.climate),surface=MASS_FIELDS.reduce((sum,f)=>sum+t[f],0),airborne=(input.airborne??0)+(input.pending??0);
 const values:Record<string,number|null>={
  mass:surface+airborne,surface,airborne,terrain:[F.sand,F.clay,F.ceramic,F.glass,F.salt,F.rock,F.soil,F.iron].reduce<number>((sum,f)=>sum+t[f],0),liquid:t[F.water]+t[F.dissolved]+t[F.molten],ice:t[F.ice],gas:a.mass,cloud:t[F.cloud]+t[F.cloudIce],biomass:t[F.plant]+t[F.seed]+t[F.herbivore]+t[F.carnivore],
  tempMean:temperatures.reduce((sum,v)=>sum+v,0)/n,enthalpy:totalEnthalpy(state,input.climate),waterTotal:t[F.water]+t[F.ice]+t[F.vapor]+t[F.cloud]+t[F.cloudIce],water:t[F.water],waterIce:t[F.ice],vapor:t[F.vapor],cloudWater:t[F.cloud],cloudIce:t[F.cloudIce],cloudCover:100*cloudCells/n,
  pressure:a.pressure,gasTemp:a.mass?a.temperature:null,scaleHeight:a.mass?a.scaleHeightKm:null,boundary:a.mass?a.heightKm:null,binding:a.mass?a.minimumBinding:null,
  soil:t[F.soil],plant:t[F.plant],herbivore:t[F.herbivore],carnivore:t[F.carnivore],plantCover:100*plantCells/n,
  supplied:input.supplied,removed:input.removed,escaped:input.escaped,transferredIn:input.transferredIn,transferredOut:input.transferredOut,
 };
 for(const gas of a.species)values['mole_'+gas.id]=a.mass?gas.fraction*100:null;
 for(const [key,f] of Object.entries(F))if(MASS_FIELDS.includes(f)&&values[key]===undefined)values[key]=t[f];
 temperatures.sort((a,b)=>a-b);values.tempMin=temperatures[0];values.tempMax=temperatures[n-1];values.tempP10=quantile(temperatures,.1);values.tempMedian=quantile(temperatures,.5);values.tempP90=quantile(temperatures,.9);
 const low=Math.floor(temperatures[0]/10)*10,high=Math.max(low+10,Math.ceil(temperatures[n-1]/10)*10),width=(high-low)/24;
 const histogram=Array<number>(24).fill(0),bins=Array.from({length:25},(_,i)=>low+i*width);
 for(const temp of temperatures)histogram[Math.min(23,Math.floor((temp-low)/width))]++;
 return {time:input.time,values,histogram:histogram.map(count=>100*count/n),bins,profileValid:a.profileValid};
}

/** One sample / simulated second. Older samples compact progressively; endpoints survive. */
export class TelemetryStore {
 readonly planets=new Map<string,PlanetTelemetry>();
 constructor(private maxPoints=2048){}
 needsSample(id:string,time:number){const r=this.planets.get(id);return !r||time<r.lastSample||time-r.lastSample>=1-1e-7;}
 sample(id:string,name:string,input:TelemetryInput,force=false){
  let r=this.planets.get(id);
  if(!force&&!this.needsSample(id,input.time))return r!;
  if(r&&input.time<r.lastSample-1e-7){this.planets.delete(id);r=undefined;}
  const point=measurePlanet(input);
  if(!r){r={id,name,points:[],baseline:point,energy:new Float64Array(4),rain:0,snow:0,rainRate:null,snowRate:null,rainCover:null,snowCover:null,lastSample:input.time,interval:0};this.planets.set(id,r);}
  r.name=name;
  for(let k=0;k<4;k++)point.values['energy'+k]=r.energy[k];
  Object.assign(point.values,{rainTotal:r.rain,snowTotal:r.snow,rainRate:r.rainRate,snowRate:r.snowRate,rainCover:r.rainCover,snowCover:r.snowCover});
  if(!r.points.length)r.baseline=point;
  if(r.points.length&&Math.abs(r.points.at(-1)!.time-input.time)<1e-7)r.points[r.points.length-1]=point;else r.points.push(point);
  if(r.points.length>this.maxPoints){const half=Math.floor(this.maxPoints/2);r.points=[...r.points.slice(0,half).filter((_,i)=>i%2===0),...r.points.slice(half)];}
  r.interval=point.time-r.lastSample;r.lastSample=input.time;return r;
 }
 step(id:string,dt:number,energy:ArrayLike<number>,precipitation:ArrayLike<number>){
  const r=this.planets.get(id);if(!r)return;
  for(let i=0;i<energy.length;i++)r.energy[i%4]+=energy[i];
  // Zero-duration edits have no precipitation. Keep the last physical rate while paused.
  if(dt<=0)return;
  let rain=0,snow=0,wet=0,frozen=0;
  for(let i=0;i<precipitation.length;i+=2){rain+=precipitation[i];snow+=precipitation[i+1];if(precipitation[i]>1e-6)wet++;if(precipitation[i+1]>1e-6)frozen++;}
  r.rain+=rain;r.snow+=snow;r.rainRate=rain/dt;r.snowRate=snow/dt;r.rainCover=wet/(precipitation.length/2)*100;r.snowCover=frozen/(precipitation.length/2)*100;
 }
 externalEnergy(id:string,channels:ArrayLike<number>){const r=this.planets.get(id);if(r)for(let k=0;k<4;k++)r.energy[k]+=channels[k];}
 reset(id:string){const r=this.planets.get(id);if(!r)return;r.baseline=r.points.at(-1)!;r.points=[r.baseline];delete r.gaps;}
}
export function delta(current:TelemetryPoint,baseline:TelemetryPoint,key:string){const a=current.values[key],b=baseline.values[key];return a==null||b==null?null:a-b;}
export function massResidual(current:TelemetryPoint,baseline:TelemetryPoint){return delta(current,baseline,'mass')!-delta(current,baseline,'supplied')!-delta(current,baseline,'transferredIn')!+delta(current,baseline,'removed')!+delta(current,baseline,'transferredOut')!+delta(current,baseline,'escaped')!;}
export function energyResidual(current:TelemetryPoint,baseline:TelemetryPoint){return delta(current,baseline,'enthalpy')!-[0,1,2,3].reduce((sum,k)=>sum+(delta(current,baseline,'energy'+k)??0),0);}
export function telemetryCsv(record:PlanetTelemetry){
 const keys=METRICS.map(m=>m.key),headers=['simulation_s',...METRICS.map(m=>`${m.key} [${m.unit}]`)];
 return ['# recorded observation; game kg / kJ; 1 simulation_s = 1 planet minute; baseline_simulation_s='+record.baseline.time,...(record.gaps?.length?['# observation_gaps='+JSON.stringify(record.gaps)]:[]),headers.join(','),...record.points.map(p=>[p.time,...keys.map(k=>p.values[k]??'')].join(','))].join('\n');
}
