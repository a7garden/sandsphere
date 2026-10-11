import {flowCellSpeed,pioneerRootability,type WeatherClimate} from '../sim/weatherClimate';
import {transmittedLight} from '../sim/materialPhysics';
import {F,STRIDE,totals,type Environment} from '../sim/model';
import {habitat} from '../sim/ecology';
import {MATERIALS} from './content';
import type {SphereGrid} from '../sim/sphere';
import {EXPEDITIONS,type Progress} from '../sim/progress';
import {updateDepthProfile} from './depthProfile';
import {helpTip} from './helpTip';
import {formatFlowSpeed,type WeatherPulse} from './weatherReadings';
export const formatReading=(value:number,digits=1)=>value.toLocaleString('ko-KR',{minimumFractionDigits:digits,maximumFractionDigits:digits});
export const metricMarkup=(id:string,unit:string)=>`<output id="${id}" class="metric-value"><span class="metric-number">—</span><span class="metric-unit">${unit}</span></output>`;
export function setMetric(id:string,value:string){document.getElementById(id)!.querySelector('.metric-number')!.textContent=value;}
export const localClimateMarkup=()=>`<section class="local-climate-panel" aria-label="이 지점의 기후"><h3>이 지점의 기후 ${helpTip('local-climate-help','지점 기후','구름층 온도는 지표 온도 −12°C에 기류 수렴·지형 상승 보정을 더한 진단값입니다. 습도와 응결이 같은 온도를 사용합니다. 기압은 기체 기둥의 무게입니다. 흐름 속도는 평균 셀 간격/게임초로 표시합니다. 지표·기체·구름은 열을 공유하며 대기 수직 구조는 따로 계산하지 않습니다.')}</h3><div class="local-climate-grid">${[['이 지점 기압','local-pressure'],['구름층 온도','upper-temperature'],['구름층 습도','local-humidity'],['구름 물·얼음','local-cloud'],['기류','local-wind'],['표층 해류','local-current']].map(([label,id])=>`<div><span>${label}</span><output id="${id}">—</output></div>`).join('')}</div></section>`;
export const surfaceReadoutMarkup=()=>`<section class="surface-readout"><h3>이 지점의 물질</h3><div id="cell-composition"></div><div class="local-conditions"><div class="observation"><span>받는 햇빛</span><output id="local-light">—</output></div><div class="observation"><span>식생 적합도</span><output id="habitat-value">—</output></div><div class="observation"><span>휴면 씨앗</span><output id="local-seed">—</output></div></div><p id="habitat-note" class="readout-note"></p>
<details class="local-water-details"><summary>수분·염분·온도 변화</summary><div class="observation"><span>수분</span><output id="moisture">0%</output></div><div class="moisture-track"><div id="moisture-bar"></div></div><div class="observation"><span>염분</span><output id="salinity">0%</output></div><div class="observation" id="firing-row" hidden><span>소성 진행</span><output id="firing">0%</output></div><div class="temperature-trend"><span>최근 온도 변화</span><svg class="sparkline" viewBox="0 0 200 36" role="img" aria-label="최근 온도 변화. 현재 지점의 온도 범위에 맞춰 세로 축을 조정합니다."><path id="temperature-history" d="M0 18H200"/></svg></div></details></section>`;
export const planetReadoutMarkup=()=>`<section class="planet-readout"><h3>행성 전체</h3><div class="planet-metrics"><div class="water-metric"><span>액체 물</span>${metricMarkup('global-water','kg')}</div><div class="water-metric"><span>얼음</span>${metricMarkup('global-ice','kg')}</div><div><span>식생</span>${metricMarkup('global-plant','kg')}</div><div><span>동물 생물량</span>${metricMarkup('global-life','kg')}</div></div><div class="observation global-temperature"><span>표면 온도 범위</span><output id="global-temperature">—</output></div></section>`;
export const expeditionMarkup=()=>`<section class="expeditions"><div class="panel-title"><h2>탐사 과제</h2><output id="expedition-count">0 / 8</output></div><strong id="next-expedition"></strong><p id="next-expedition-note"></p><details><summary>전체 과제</summary><ol>${EXPEDITIONS.map(m=>`<li data-mission="${m.id}"><strong>${m.name}</strong><span>${m.detail}</span><small>진행 중</small></li>`).join('')}</ol></details></section>`;
export function updateExpeditions(progress:Progress){
 document.getElementById('expedition-count')!.textContent=progress.completed.length+' / '+EXPEDITIONS.length;
 const next=EXPEDITIONS.find(m=>!progress.completed.includes(m.id));document.getElementById('next-expedition')!.textContent=next?.name??'모든 탐사 완료';document.getElementById('next-expedition-note')!.textContent=next?.detail??'다른 환경에서 새로운 균형을 만들어보세요.';
 for(const m of EXPEDITIONS){const row=document.querySelector<HTMLElement>('[data-mission="'+m.id+'"]')!;row.dataset.complete=String(progress.completed.includes(m.id));row.querySelector('small')!.textContent=progress.completed.includes(m.id)?'완료':'진행 중';}
}
export function updateObservatory(s:Float32Array,index:number,e:Environment,grid:SphereGrid,climate?:WeatherClimate,hideBedrock=false){
 updateDepthProfile(s,index,grid,hideBedrock);
 const p=index*STRIDE,items=[...MATERIALS.map(m=>({name:m.name,amount:s[p+F[m.id]]})),{name:'기반암',amount:s[p+F.rock]},{name:'용융 규사',amount:s[p+F.molten]}].filter(m=>m.amount>.005).sort((a,b)=>b.amount-a.amount).slice(0,5);
 const container=document.getElementById('cell-composition')!;container.replaceChildren();
 for(const item of items){const row=document.createElement('div');row.className='composition-row';const label=document.createElement('span');label.textContent=item.name;const value=document.createElement('output');const number=document.createElement('span');number.className='reading-number';number.textContent=formatReading(item.amount,2);const unit=document.createElement('span');unit.className='reading-unit';unit.textContent=' kg';value.append(number,unit);row.append(label,value);container.append(row);}
 const light=transmittedLight(Math.max(0,grid.directions[index*3]*e.sun[0]+grid.directions[index*3+1]*e.sun[1]+grid.directions[index*3+2]*e.sun[2]),e.sunlight,s[p+F.cloud],s[p+F.cloudIce]);
 const roots=e.climate?pioneerRootability(s,p):1,suitable=habitat(s[p+F.temperature],s[p+F.water],s[p+F.dissolved],s[p+F.ice],light)*roots;
 document.getElementById('local-light')!.textContent=light<.01?'밤':(light*100).toFixed(0)+'%';
 document.getElementById('habitat-value')!.textContent=(suitable*100).toFixed(0)+'%';
 document.getElementById('habitat-note')!.textContent=s[p+F.ice]>.1?'얼음이 녹아야 자랄 수 있어요.':roots===0?'모래·점토·토양이 있어야 뿌리를 내릴 수 있어요.':s[p+F.water]<.02?'소량의 물을 공급하세요.':s[p+F.water]>3?'물이 너무 깊습니다.':light<.05?'햇빛을 기다리고 있어요.':suitable>.4?(s[p+F.plant]>0?'식생이 자랄 수 있는 환경입니다.':(s[p+F.seed]>1e-6||(climate?.seeds[index]??0)>.001)?'씨앗이 정착할 수 있는 환경입니다.':'씨앗이나 식생을 도입하면 정착할 수 있어요.'):'온도와 염분을 확인하세요.';
 document.getElementById('local-seed')!.textContent=formatReading(s[p+F.seed],3)+' kg'+((climate?.seeds[index]??0)>.001?' · 분산 흔적 있음':'');
 if(climate){const air=climate.conditions(s,index,e);document.getElementById('upper-temperature')!.textContent=air.temperature.toFixed(1)+'°C';document.getElementById('local-humidity')!.textContent=air.humidity>=2?'≥200%':(air.humidity*100).toFixed(0)+'%';for(const [id,field] of [['local-wind',climate.wind],['local-current',climate.currents]] as const)document.getElementById(id)!.textContent=formatFlowSpeed(flowCellSpeed(field,index,grid.count))+' 셀/게임초';}
 document.getElementById('local-cloud')!.textContent=formatReading(s[p+F.cloud]+s[p+F.cloudIce],3)+' kg';
 const t=totals(s);for(const [id,value] of [['water',t[F.water]],['ice',t[F.ice]],['plant',t[F.plant]],['life',t[F.herbivore]+t[F.carnivore]]] as const)setMetric('global-'+id,formatReading(value,1));
 let min=Infinity,max=-Infinity;for(let i=0;i<s.length;i+=STRIDE){min=Math.min(min,s[i+F.temperature]);max=Math.max(max,s[i+F.temperature]);}document.getElementById('global-temperature')!.textContent=min.toFixed(0)+' ~ '+max.toFixed(0)+'°C';
}
export function updateWeatherReadout(s:Float32Array,count:number,pulse:WeatherPulse|null,paused:boolean,edited:boolean){
 let cloud=0,cloudCells=0,water=0;for(let p=0;p<s.length;p+=STRIDE){const mass=s[p+F.cloud]+s[p+F.cloudIce];cloud+=mass;if(mass>.02)cloudCells++;water+=s[p+F.water]+s[p+F.ice]+s[p+F.vapor]+mass;}
 const events=pulse?[pulse.rainCells?`비 ${pulse.rainCells}곳`:'',pulse.snowCells?`눈 ${pulse.snowCells}곳`:'',pulse.condensation>1e-6?'수증기 응결 중':''].filter(Boolean):[];
 document.getElementById('weather-state')!.textContent=events.join(' · ')||(cloud>.01?`구름이 있는 셀 ${cloudCells}/${count}`:water>.01?'현재 응결·강수 없음':'물 없음 · 강수 없음');
 document.getElementById('weather-timing')!.textContent=edited?'정지 중 편집 · 재개하면 흐름 갱신':!pulse?'흐름은 다음 물리 단계에서 갱신':paused?'일시정지 · 마지막 완료 단계':'마지막 완료 단계 · 게임 시간 기준';
 document.getElementById('weather-cloud-stock')!.textContent=formatReading(cloud,2)+' kg';
 for(const [id,value] of [['weather-condensation',pulse?.condensation],['weather-rain',pulse?.rain],['weather-snow',pulse?.snow]] as const)document.getElementById(id)!.textContent=value===undefined?'—':formatReading(value,4)+' kg/게임초';
 return cloud;
}
