import {F,totals,type Product,type Stock} from './model';
import type {PlanetRecord} from './system';
export interface Progress {completed:string[];meteorCount:number;}
export const freshProgress=():Progress=>({completed:[],meteorCount:0});
export const LIFE_SAMPLES=[
 {id:'plant',amount:8,requires:null},
 {id:'herbivore',amount:4,requires:'garden'},
 {id:'carnivore',amount:1,requires:'grazer'},
] as const;
export const EXPEDITIONS=[
 {id:'water',chapter:'1 · 물질 실험',name:'물의 여정',detail:'한 행성에 수증기 1kg과 구름 물·얼음 0.1kg을 함께 만드세요.',hint:'물을 여러 셀에 공급하고, 가열 도구로 관측 패널의 비등 기준보다 높게 끓여 수증기를 만드세요. 응결하는 구름을 날씨 지도와 대시보드로 확인하세요. 대기가 없다면 질소도 먼저 공급하세요.',requires:null},
 {id:'kiln',chapter:'1 · 물질 실험',name:'흙을 굽다',detail:'도자기 1kg을 만들거나 보관하세요.',hint:'점토를 공급하고 물을 말린 뒤, 가열 도구로 850°C 이상을 행성 시간 30분 동안 유지하세요. 일시정지 중에는 소성이 진행되지 않습니다.',requires:null},
 {id:'glass',chapter:'1 · 물질 실험',name:'녹이고 식히다',detail:'유리 1kg을 만들거나 보관하세요.',hint:'모래를 1,700°C보다 높게 가열해 녹인 뒤 1,400°C 아래로 냉각하세요. 만든 유리는 회수 도구로 보관함에 담을 수 있습니다.',requires:null},
 {id:'garden',chapter:'2 · 살아 있는 땅',name:'첫 정원',detail:'한 행성의 식생을 9kg까지 키우세요. 보상: 초식 생물 4kg.',hint:'시작 표본 식생 8kg을 모래·점토·유기물이 있는 땅에 나눠 공급하세요. 햇빛·소량의 물·온화한 온도를 유지하고, 유기물이나 이산화탄소를 보충하세요.',requires:null},
 {id:'grazer',chapter:'2 · 살아 있는 땅',name:'먹이의 연결',detail:'한 행성의 초식 생물을 4.2kg까지 키우세요. 보상: 포식 생물 1kg.',hint:'첫 정원 보상을 식생 옆의 촉촉한 육지에 공급하세요. 유기물은 수분을 붙잡습니다. 고인 물에 공급하면 즉시 죽으므로 물을 조금씩 추가하세요.',requires:'garden'},
 {id:'web',chapter:'2 · 살아 있는 땅',name:'함께 사는 세계',detail:'식생 2kg·초식 생물 1kg·포식 생물 0.2kg이 함께 있는 행성을 만드세요.',hint:'먹이의 연결 보상에서 포식 생물을 조금만 공급하세요. 세 생물량이 같은 행성에 있어야 합니다. 나머지 표본은 보관함에 남겨 두세요.',requires:'grazer'},
 {id:'meteor',chapter:'3 · 행성을 잇는 탐사',name:'우주에서 온 금속',detail:'운석을 충돌시키고 운철 1kg을 회수하세요.',hint:'운석 도구로 빈 땅을 누르면 운철 36kg이 공급됩니다. 충돌 지점에서 회수 도구를 사용하세요. 충돌은 주변 지형과 생태계를 바꿉니다.',requires:null},
 {id:'transfer',chapter:'3 · 행성을 잇는 탐사',name:'행성을 잇다',detail:'첫 행성 이외의 행성에 보관함 물질을 공급하세요.',hint:'항성계에서 새 행성을 만들거나 다른 행성을 선택하세요. 회수한 얼음·도자기·유리·운철 또는 생물 표본을 공급하면 완료됩니다. 기본 재료는 운반으로 세지 않습니다.',requires:null},
] as const;
export type ExpeditionId=typeof EXPEDITIONS[number]['id'];
export interface ExpeditionMetric {name:string;current:number;target:number;unit:'kg'|'count';}
export interface ExpeditionState {id:ExpeditionId;complete:boolean;ready:boolean;metrics:ExpeditionMetric[];}
const meetsMass=(current:number,target:number)=>current>=target*(1-1e-6);
const reached=(m:ExpeditionMetric)=>m.unit==='count'?m.current>=m.target:meetsMass(m.current,m.target);
const kg=(name:string,current:number,target:number):ExpeditionMetric=>({name,current,target,unit:'kg'});
const count=(name:string,current:number):ExpeditionMetric=>({name,current,target:1,unit:'count'});
/** For joint goals, show one planet's values, never a mixture of separate worlds. */
function bestPlanet(sums:number[][],fields:readonly number[],targets:readonly number[]){
 const achieved=sums.find(t=>fields.every((f,i)=>meetsMass(t[f],targets[i])));if(achieved)return achieved;
 return sums.reduce((best,t)=>{
  const score=(v:number[])=>Math.min(...fields.map((f,i)=>Math.min(1,v[f]/targets[i])))+fields.reduce((n,f,i)=>n+Math.min(1,v[f]/targets[i]),0)*.001;
  return score(t)>score(best)?t:best;
 },new Array<number>(Object.keys(F).length).fill(0));
}
export function expeditionStates(progress:Progress,planets:PlanetRecord[],stock:Stock):ExpeditionState[]{
 const sums=planets.map(p=>Array.from(totals(new Float32Array(p.snapshot.state))));
 const sum=(f:number)=>sums.reduce((n,t)=>n+t[f],0),max=(f:number)=>Math.max(0,...sums.map(t=>t[f]));
 const waterSums=sums.map(t=>{const copy=t.slice();copy[F.cloud]+=copy[F.cloudIce];return copy;});
 const water=bestPlanet(waterSums,[F.vapor,F.cloud],[1,.1]),web=bestPlanet(sums,[F.plant,F.herbivore,F.carnivore],[2,1,.2]);
 const metrics:Record<ExpeditionId,ExpeditionMetric[]>={
  water:[kg('수증기',water[F.vapor],1),kg('구름 물·얼음',water[F.cloud],.1)],
  kiln:[kg('도자기',sum(F.ceramic)+stock.ceramic,1)],glass:[kg('유리',sum(F.glass)+stock.glass,1)],
  garden:[kg('식생',max(F.plant),9)],grazer:[kg('초식 생물',max(F.herbivore),4.2)],
  web:[kg('식생',web[F.plant],2),kg('초식 생물',web[F.herbivore],1),kg('포식 생물',web[F.carnivore],.2)],
  meteor:[count('운석 충돌',progress.meteorCount),kg('보관함 운철',stock.iron,1)],
  transfer:[count('다른 행성에 보관함 공급',planets.slice(1).some(p=>(p.snapshot.transferredIn??0)>0)?1:0)],
 };
 return EXPEDITIONS.map(m=>({id:m.id,complete:progress.completed.includes(m.id),ready:m.requires===null||progress.completed.includes(m.requires),metrics:metrics[m.id]}));
}
export function advanceProgress(progress:Progress,planets:PlanetRecord[],stock:Stock){
 const states=expeditionStates(progress,planets,stock),fresh:string[]=[];
 for(const mission of EXPEDITIONS){
  const state=states.find(s=>s.id===mission.id)!;
  if(state.complete||(mission.requires!==null&&!progress.completed.includes(mission.requires))||!state.metrics.every(reached))continue;
  progress.completed.push(mission.id);fresh.push(mission.id);
  for(const sample of LIFE_SAMPLES)if(sample.requires===mission.id)stock[sample.id]+=sample.amount;
 }
 return fresh;
}
export function lifeSampleAvailability(progress:Progress,planets:PlanetRecord[],stock:Stock){
 const sums=planets.map(p=>totals(new Float32Array(p.snapshot.state)));
 return LIFE_SAMPLES.map(sample=>{
  const existing=stock[sample.id]+sums.reduce((n,t)=>n+t[F[sample.id]],0);
  return {...sample,unlocked:sample.requires===null||progress.completed.includes(sample.requires),existing,depleted:existing<.01-1e-8};
 });
}
export function restockLifeSamples(progress:Progress,planets:PlanetRecord[],stock:Stock):Product[]{
 const granted:Product[]=[];
 for(const sample of lifeSampleAvailability(progress,planets,stock))if(sample.unlocked&&sample.depleted){stock[sample.id]+=sample.amount;granted.push(sample.id);}
 return granted;
}
