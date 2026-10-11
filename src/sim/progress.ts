import {F,STRIDE,totals,type Stock} from './model';
import type {PlanetRecord} from './system';
export interface Progress {completed:string[];meteorCount:number;}
export const freshProgress=():Progress=>({completed:[],meteorCount:0});
export const EXPEDITIONS=[
 {id:'water',name:'물의 여정',detail:'수증기 1kg과 구름 0.1kg을 만드세요.'},
 {id:'kiln',name:'흙을 굽다',detail:'도자기 1kg을 만들거나 보관하세요.'},
 {id:'glass',name:'녹이고 식히다',detail:'유리 1kg을 만들거나 보관하세요.'},
 {id:'garden',name:'첫 정원',detail:'얕은 물과 햇빛으로 식생을 9kg까지 키우세요. 유기물은 성장을 돕습니다. 보상: 초식 생물 4kg.'},
 {id:'grazer',name:'먹이의 연결',detail:'식생을 먹는 초식 생물을 4.2kg까지 키우세요. 보상: 포식 생물 1kg.'},
 {id:'web',name:'함께 사는 세계',detail:'식생 2kg·초식 생물 1kg·포식 생물 0.2kg이 함께 있는 행성을 만드세요.'},
 {id:'meteor',name:'우주에서 온 금속',detail:'운석을 충돌시키고 운철 1kg을 회수하세요.'},
 {id:'transfer',name:'행성을 잇다',detail:'두 번째 행성으로 보관함 물질을 옮기세요.'},
] as const;
export function advanceProgress(progress:Progress,planets:PlanetRecord[],stock:Stock){
 const sums=planets.map(p=>totals(new Float32Array(p.snapshot.state)));
 const sum=(f:number)=>sums.reduce((n,t)=>n+t[f],0);
 // Creation order is persisted. transferredIn records warehouse supply, not free brushes.
 const checks:Record<string,boolean>={water:sum(F.vapor)>1&&sum(F.cloud)+sum(F.cloudIce)>.1,kiln:sum(F.ceramic)+stock.ceramic>=1,glass:sum(F.glass)+stock.glass>=1,garden:sum(F.plant)>=9,grazer:sum(F.herbivore)>=4.2-1e-5,web:sums.some(t=>t[F.plant]>=2&&t[F.herbivore]>=1&&t[F.carnivore]>=.2),meteor:progress.meteorCount>0&&stock.iron>=1,transfer:(planets[1]?.snapshot.transferredIn??0)>0};
 const fresh:string[]=[];
 for(const mission of EXPEDITIONS)if(checks[mission.id]&&!progress.completed.includes(mission.id)){
  progress.completed.push(mission.id);fresh.push(mission.id);
  if(mission.id==='garden')stock.herbivore+=4;
  if(mission.id==='grazer')stock.carnivore+=1;
 }
 return fresh;
}
