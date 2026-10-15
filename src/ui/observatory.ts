import {COLUMN_KG,AIR_SECONDS,AIR_LAYERS} from '../sim/layeredAtmosphere';
import {dustOpticalDepth} from '../sim/dustPhysics';
import {isDeepAtmosphere} from '../sim/planetDefinition';
import {DEEP_LAYERS} from '../sim/deepAtmosphere';
import {flowCellSpeed,pioneerRootability,type WeatherClimate} from '../sim/weatherClimate';
import {transmittedLight} from '../sim/materialPhysics';
import {F,STRIDE,totals,emptyStock,type Stock,type Environment} from '../sim/model';
import {habitat} from '../sim/ecology';
import {MATERIALS} from './content';
import type {PlanetRecord} from '../sim/system';
import type {SphereGrid} from '../sim/sphere';
import {EXPEDITIONS,expeditionStates,type ExpeditionMetric,type Progress} from '../sim/progress';
import {updateDepthProfile} from './depthProfile';
import {helpTip} from './helpTip';
import {formatFlowSpeed,type WeatherPulse} from './weatherReadings';
import {currentLocale,translatePhrase} from './i18n';
import {setTextIfChanged} from './domUpdates';
const setReading=(node:Node,value:string)=>setTextIfChanged(node,translatePhrase(value));
export const formatReading=(value:number,digits=1)=>value.toLocaleString(currentLocale()==='en'?'en-US':'ko-KR',{minimumFractionDigits:digits,maximumFractionDigits:digits});
export const metricMarkup=(id:string,unit:string)=>`<output id="${id}" class="metric-value"><span class="metric-number">—</span><span class="metric-unit">${unit}</span></output>`;
export function setMetric(id:string,value:string){setReading(document.getElementById(id)!.querySelector('.metric-number')!,value);}
export const localClimateMarkup=()=>`<section class="local-climate-panel" aria-label="이 지점의 기후"><h3>이 지점의 기후 ${helpTip('local-climate-help','지점 기후','지표와 11개 대기층은 각각 온도를 저장합니다. 응축물이 가장 많은 층의 온도·습도를 표시하며, 구름이 없으면 최하층을 표시합니다. 상승하는 공기의 단열 냉각과 응결 잠열을 계산합니다. 기류는 m/s, 해류는 평균 셀 간격/행성분으로 표시합니다.')}</h3><div class="local-climate-grid">${[['이 지점 기압','local-pressure'],['구름층 온도','upper-temperature'],['구름층 습도','local-humidity'],['구름 물·얼음','local-cloud'],['기류','local-wind'],['상승기류 (최대)','local-updraft'],['표층 해류','local-current']].map(([label,id])=>`<div><span>${label}</span><output id="${id}">—</output></div>`).join('')}</div></section>`;
export const surfaceReadoutMarkup=()=>`<section class="surface-readout"><h3>이 지점의 물질</h3><div id="cell-composition"></div><div class="local-conditions"><div class="observation"><span>받는 햇빛</span><output id="local-light">—</output></div><div class="observation"><span>식생 적합도</span><output id="habitat-value">—</output></div><div class="observation"><span>휴면 씨앗</span><output id="local-seed">—</output></div></div><p id="habitat-note" class="readout-note"></p>
<details class="local-water-details"><summary>수분·염분·온도 변화</summary><div class="observation"><span>수분</span><output id="moisture">0%</output></div><div class="moisture-track"><div id="moisture-bar"></div></div><div class="observation"><span>염분</span><output id="salinity">0%</output></div><div class="observation" id="firing-row" hidden><span>소성 진행</span><output id="firing">0%</output></div><div class="temperature-trend"><span>최근 온도 변화</span><svg class="sparkline" viewBox="0 0 200 36" role="img" aria-label="최근 온도 변화. 현재 지점의 온도 범위에 맞춰 세로 축을 조정합니다."><path id="temperature-history" d="M0 18H200"/></svg></div></details></section>`;
export const planetReadoutMarkup=()=>`<section class="planet-readout"><h3>행성 전체</h3><div class="planet-metrics"><div class="water-metric"><span>액체 물</span>${metricMarkup('global-water','kg')}</div><div class="water-metric"><span>얼음</span>${metricMarkup('global-ice','kg')}</div><div><span>식생</span>${metricMarkup('global-plant','kg')}</div><div><span>동물 생물량</span>${metricMarkup('global-life','kg')}</div></div><div class="observation global-temperature"><span>표면 온도 범위</span><output id="global-temperature">—</output></div></section><section id="mars-processes" class="planet-readout" hidden><h3>CO₂ 얼음·먼지</h3><div class="local-climate-grid">${[['CO₂ 얼음','mars-frost'],['지표 먼지','mars-ground-dust'],['대기 먼지','mars-air-dust'],['이 지점 먼지 광학 깊이','mars-local-tau'],['먼지 폭풍 셀','mars-storm-cells']].map(([label,id])=>`<div><span>${label}</span><output id="${id}">—</output></div>`).join('')}</div><p class="readout-note">차가운 지표에 CO₂가 얼고, 가열하면 승화합니다. 강풍은 지표 먼지·모래를 들어 올립니다. 광학 깊이 1 이상을 먼지 폭풍 셀로 표시합니다.</p></section><section id="giant-readout" class="planet-readout" hidden><h3>깊은 대기</h3><div class="local-climate-grid">${[['관측 대기층 온도','giant-reference-temperature'],['관측 대기층 기압','giant-reference-pressure'],['아래 경계 기압','giant-bottom-pressure'],['내부 열 흐름','giant-intrinsic-flux'],['암모니아 구름','giant-ammonia-cloud'],['물 구름','giant-water-cloud'],['동서 제트','giant-zonal-wind'],['이 지점 구름 광학 깊이','giant-cloud-tau']].map(([label,id])=>`<div><span>${label}</span><output id="${id}">—</output></div>`).join('')}</div><p class="readout-note">수소·헬륨 대기층을 관측합니다. 아래 경계는 질량을 통과시키지 않고 내부 열을 전달합니다.</p><details class="giant-layers"><summary>대기층 분포</summary><table><thead><tr><th>bar</th><th>°C</th><th>NH₃ g/m²</th><th>H₂O g/m²</th><th>m/s</th></tr></thead><tbody id="giant-layer-values"></tbody></table></details><details id="giant-bands" class="giant-layers"><summary>위도별 띠·제트</summary><table><thead><tr><th>위도 (°)</th><th>동서풍 (m/s)</th><th>구름 광학 깊이</th></tr></thead><tbody id="giant-band-values"></tbody></table></details><p id="giant-cloud-note" class="readout-note"></p></section>`;
export const expeditionMarkup=()=>`<section class="expeditions"><div class="panel-title"><h2>탐사 과제</h2><output id="expedition-count">0 / ${EXPEDITIONS.length}</output></div><p>물질을 바꾸고 생태계를 키운 뒤, 다른 행성으로 탐사를 넓히세요. 물질 실험과 탐사는 원하는 순서로 진행할 수 있습니다.</p><small id="next-expedition-chapter"></small><strong id="next-expedition"></strong><p id="next-expedition-note"></p><div id="next-expedition-metrics" class="expedition-metrics"></div><p id="next-expedition-hint"></p><details><summary>전체 과제</summary><ol>${EXPEDITIONS.map((m,i)=>`${i===0||m.chapter!==EXPEDITIONS[i-1].chapter?`<li class="expedition-chapter">${m.chapter}</li>`:''}<li data-mission="${m.id}"><strong>${m.name}</strong><span>${m.detail}</span><small data-mission-status>진행 중</small><div class="expedition-metrics" data-mission-metrics></div><details><summary>실험 방법</summary><p>${m.hint}</p></details></li>`).join('')}</ol></details></section>`;
function renderExpeditionMetrics(container:HTMLElement,metrics:ExpeditionMetric[]){
 if(container.children.length!==metrics.length){
  container.replaceChildren();
  for(const metric of metrics){
   const row=document.createElement('div'),label=document.createElement('span'),value=document.createElement('output'),bar=document.createElement('progress');
   row.append(label,value,bar);container.append(row);
  }
 }
 for(let i=0;i<metrics.length;i++){
  const metric=metrics[i],row=container.children[i],label=row.querySelector('span')!,value=row.querySelector('output')!,bar=row.querySelector('progress')!;
  const name=translatePhrase(metric.name),reading=metric.unit==='kg'?formatReading(metric.current,2)+' / '+formatReading(metric.target,2)+' kg':Math.min(metric.current,metric.target)+' / '+metric.target;
  if(label.textContent!==name)label.textContent=name;
  if(value.textContent!==reading)value.textContent=reading;
  if(bar.max!==metric.target)bar.max=metric.target;
  const amount=Math.min(metric.current,metric.target);if(bar.value!==amount)bar.value=amount;
  if(bar.getAttribute('aria-label')!==name)bar.setAttribute('aria-label',name);
 }

}
export function updateExpeditions(progress:Progress,planets:PlanetRecord[]=[],stock:Stock=emptyStock()){
 const states=expeditionStates(progress,planets,stock);
 document.getElementById('expedition-count')!.textContent=progress.completed.length+' / '+EXPEDITIONS.length;
 const next=EXPEDITIONS.find(m=>states.some(s=>s.id===m.id&&!s.complete&&s.ready));
 document.getElementById('next-expedition-chapter')!.textContent=next?translatePhrase(next.chapter):'';
 document.getElementById('next-expedition')!.textContent=translatePhrase(next?.name??'모든 탐사 완료');document.getElementById('next-expedition-note')!.textContent=translatePhrase(next?.detail??'다른 환경에서 새로운 균형을 만들어보세요.');
 document.getElementById('next-expedition-hint')!.textContent=next?translatePhrase(next.hint):'';
 renderExpeditionMetrics(document.getElementById('next-expedition-metrics')!,next?states.find(s=>s.id===next.id)!.metrics:[]);
 for(const m of EXPEDITIONS){
  const row=document.querySelector<HTMLElement>('[data-mission="'+m.id+'"]')!,state=states.find(s=>s.id===m.id)!;
  row.dataset.complete=String(state.complete);row.dataset.ready=String(state.ready);
  row.querySelector('[data-mission-status]')!.textContent=translatePhrase(state.complete?'완료':state.ready?'진행 중':'선행 과제 완료 필요');
  const metrics=row.querySelector<HTMLElement>('[data-mission-metrics]')!;metrics.hidden=state.complete;renderExpeditionMetrics(metrics,state.metrics);
 }
}
export function updateObservatory(s:Float32Array,index:number,e:Environment,grid:SphereGrid,climate?:WeatherClimate,hideBedrock=false){
 const deep=isDeepAtmosphere(e.body);document.querySelectorAll<HTMLElement>('.depth-profile,.surface-readout,.planet-metrics,.weather-flow-readings,.weather-map-actions,.weather-details').forEach(node=>node.hidden=deep);
 for(const id of ['local-humidity','local-cloud','local-current'])document.getElementById(id)!.parentElement!.hidden=deep;
 setReading(document.getElementById('upper-temperature')!.previousElementSibling!,translatePhrase(deep?'관측 대기층 온도':'구름층 온도'));
 updateDepthProfile(s,index,grid,hideBedrock);
 const p=index*STRIDE,items=[...MATERIALS.map(m=>({name:m.name,amount:s[p+F[m.id]]})),{name:'공중 그을음',amount:s[p+F.soot]},{name:'숯',amount:s[p+F.charcoal]},{name:'일산화탄소',amount:s[p+F.carbonMonoxide]},{name:'기반암',amount:s[p+F.rock]},{name:'용융 규사',amount:s[p+F.molten]}].filter(m=>m.amount>.005).sort((a,b)=>b.amount-a.amount).slice(0,5);
 const container=document.getElementById('cell-composition')!;
 if(container.children.length!==items.length){
  container.replaceChildren();
  for(const item of items){const row=document.createElement('div');row.className='composition-row';const label=document.createElement('span'),value=document.createElement('output'),number=document.createElement('span'),unit=document.createElement('span');number.className='reading-number';unit.className='reading-unit';unit.textContent=' kg';value.append(number,unit);row.append(label,value);container.append(row);}
 }
 for(const [i,item] of items.entries()){const row=container.children[i];setReading(row.children[0],item.name);setReading(row.querySelector('.reading-number')!,formatReading(item.amount,2));}
 const exposure=Math.max(0,grid.directions[index*3]*e.sun[0]+grid.directions[index*3+1]*e.sun[1]+grid.directions[index*3+2]*e.sun[2]),light=e.climate&&climate?.airReady?climate.air.surfaceLight(s,index,e):transmittedLight(exposure,e.sunlight,s[p+F.cloud],s[p+F.cloudIce]);
 const roots=e.climate?pioneerRootability(s,p):1,suitable=habitat(s[p+F.temperature],s[p+F.water],s[p+F.dissolved],s[p+F.ice],light)*roots;
 setReading(document.getElementById('local-light')!,light<.01?translatePhrase('밤'):(light*100).toFixed(0)+'%');
 setReading(document.getElementById('habitat-value')!,(suitable*100).toFixed(0)+'%');
 setReading(document.getElementById('habitat-note')!,translatePhrase(s[p+F.ice]>.1?'얼음이 녹아야 자랄 수 있어요.':roots===0?'모래·점토·토양이 있어야 뿌리를 내릴 수 있어요.':s[p+F.water]<.02?'소량의 물을 공급하세요.':s[p+F.water]>3?'물이 너무 깊습니다.':light<.05?'햇빛을 기다리고 있어요.':suitable>.4?(s[p+F.plant]>0?'식생이 자랄 수 있는 환경입니다.':(s[p+F.seed]>1e-6||(climate?.seeds[index]??0)>.001)?'씨앗이 정착할 수 있는 환경입니다.':'씨앗이나 식생을 도입하면 정착할 수 있어요.'):'온도와 염분을 확인하세요.'));
 setReading(document.getElementById('local-seed')!,formatReading(s[p+F.seed],3)+' kg'+((climate?.seeds[index]??0)>.001?' · '+translatePhrase('분산 흔적 있음'):''));
 const updraft=document.getElementById('local-updraft');if(updraft)setReading(updraft,e.climate&&climate?.airReady&&!deep?formatFlowSpeed(Math.max(...climate.air.updraft.subarray(index*(AIR_LAYERS-1),(index+1)*(AIR_LAYERS-1))))+' m/s':'—');
 if(climate){const air=climate.conditions(s,index,e);setReading(document.getElementById('upper-temperature')!,air.temperature.toFixed(1)+'°C'+('height' in air?' · '+(Number(air.height)/1000).toFixed(1)+' km':''));setReading(document.getElementById('local-humidity')!,air.humidity>=2?'≥200%':(air.humidity*100).toFixed(0)+'%');for(const [id,field] of [['local-wind',climate.wind],['local-current',climate.currents]] as const)setReading(document.getElementById(id)!,formatFlowSpeed(id==='local-wind'?Math.hypot(...field.subarray(index*3,index*3+3))*climate.radiusMeters/AIR_SECONDS:flowCellSpeed(field,index,grid.count))+(id==='local-wind'?' m/s':' cells/planet minute'));}
 setReading(document.getElementById('local-cloud')!,formatReading(s[p+F.cloud]+s[p+F.cloudIce],3)+' kg');
 const t=totals(s);for(const [id,value] of [['water',t[F.water]],['ice',t[F.ice]],['plant',t[F.plant]],['life',t[F.herbivore]+t[F.carnivore]]] as const)setMetric('global-'+id,formatReading(value,1));
 const giant=document.getElementById('giant-readout');if(giant){giant.hidden=!deep;if(deep&&climate?.giantReady){const g=climate.giant,air=g.conditions(index);for(const [id,value] of [['giant-reference-temperature',air.temperature.toFixed(1)+'°C'],['giant-reference-pressure',(air.pressure/1e5).toFixed(3)+' bar'],['giant-bottom-pressure',(g.bottomPressure(index)/1e5).toFixed(3)+' bar'],['giant-intrinsic-flux',g.intrinsicFlux.toFixed(2)+' W/m²']] as const)setReading(document.getElementById(id)!,value);
  const local=g.cloudOptics(index);setReading(document.getElementById('giant-ammonia-cloud')!,formatReading(t[F.ammoniaCloud]+t[F.ammoniaIce],3)+' kg');setReading(document.getElementById('giant-water-cloud')!,formatReading(t[F.cloud]+t[F.cloudIce],3)+' kg');setReading(document.getElementById('giant-zonal-wind')!,g.zonalWind(index).toFixed(1)+' m/s');setReading(document.getElementById('giant-cloud-tau')!,local.opticalDepth.toFixed(2));
  setReading(document.getElementById('giant-cloud-note')!,translatePhrase(t[F.ammonia]+t[F.ammoniaCloud]+t[F.ammoniaIce]+t[F.vapor]+t[F.cloud]+t[F.cloudIce]>0?'구름 재고가 응결·증발하고 제트와 함께 이동합니다. 띠 색은 구름 광학 깊이의 압축 표시입니다.':'이전 저장의 물질량을 유지했습니다. 암모니아·물 구름은 새 목성형·토성형에서 시작합니다.'));
  const layers=document.getElementById('giant-layer-values');if(layers?.closest('details')?.open)layers.innerHTML=Array.from({length:DEEP_LAYERS},(_,k)=>{const q=index*DEEP_LAYERS+k,o=q*8,a=(g.mass[o+3]+g.mass[o+4])*COLUMN_KG*1000,w=(g.mass[o+6]+g.mass[o+7])*COLUMN_KG*1000;return `<tr><td>${(g.pressure(index,k)/1e5).toFixed(3)}</td><td>${g.temperature[q].toFixed(1)}</td><td>${a.toFixed(1)}</td><td>${w.toFixed(1)}</td><td>${g.zonalWind(index,k).toFixed(1)}</td></tr>`;}).join('');
  const bands=document.getElementById('giant-band-values');if(bands?.closest('details')?.open)bands.innerHTML=g.bands().filter(b=>b.count).map(b=>`<tr><td>${b.latitude.toFixed(1)}</td><td>${b.wind.toFixed(1)}</td><td>${b.cloud.toFixed(1)}</td></tr>`).join('');

 }}
 const mars=document.getElementById('mars-processes');if(mars){mars.hidden=e.body?.atmosphere.radiation!=='thin-co2-grey';if(!mars.hidden){
  for(const [id,f] of [['mars-frost',F.carbonDioxideIce],['mars-ground-dust',F.surfaceDust],['mars-air-dust',F.airborneDust]] as const)setReading(document.getElementById(id)!,formatReading(t[f],6)+' kg');
  setReading(document.getElementById('mars-local-tau')!,formatReading(dustOpticalDepth(s[p+F.airborneDust]*COLUMN_KG),3));
  let storms=0;for(let i=0;i<grid.count;i++)if(dustOpticalDepth(s[i*STRIDE+F.airborneDust]*COLUMN_KG)>=1)storms++;
  setReading(document.getElementById('mars-storm-cells')!,storms+' / '+grid.count);
 }}
 let min=Infinity,max=-Infinity;for(let i=0;i<s.length;i+=STRIDE){min=Math.min(min,s[i+F.temperature]);max=Math.max(max,s[i+F.temperature]);}setReading(document.getElementById('global-temperature')!,min.toFixed(0)+' ~ '+max.toFixed(0)+'°C');
 setReading(document.querySelector<HTMLElement>('.global-temperature > span')!,translatePhrase(deep?'대기 열평균 온도 범위':'표면 온도 범위'));
}
export function updateWeatherReadout(s:Float32Array,count:number,pulse:WeatherPulse|null,paused:boolean,edited:boolean){
 let cloud=0,cloudCells=0,water=0;for(let p=0;p<s.length;p+=STRIDE){const mass=s[p+F.cloud]+s[p+F.cloudIce];cloud+=mass+s[p+F.ammoniaCloud]+s[p+F.ammoniaIce];if(mass>.02)cloudCells++;water+=s[p+F.water]+s[p+F.ice]+s[p+F.vapor]+mass;}
 const en=currentLocale()==='en';
 const events=pulse?[pulse.rainCells?(en?`${pulse.rainCells} rainy cells`:`비 ${pulse.rainCells}곳`):'',pulse.snowCells?(en?`${pulse.snowCells} snowy cells`:`눈 ${pulse.snowCells}곳`):'',pulse.condensation>1e-6?(en?'Water vapor condensing':'수증기 응결 중'):''].filter(Boolean):[];
 document.getElementById('weather-state')!.textContent=events.join(' · ')||(cloud>.01?(en?`${cloudCells}/${count} cells with clouds`:`구름이 있는 셀 ${cloudCells}/${count}`):water>.01?(en?'No condensation or precipitation currently':'현재 응결·강수 없음'):(en?'No water · no precipitation':'물 없음 · 강수 없음'));
 document.getElementById('weather-timing')!.textContent=edited?(en?'Editing while paused · resume to update flows':'정지 중 편집 · 재개하면 흐름 갱신'):!pulse?(en?'Flows update on the next physics step':'흐름은 다음 물리 단계에서 갱신'):paused?(en?'Paused · showing last completed step':'일시정지 · 마지막 완료 단계'):(en?'Last completed step · planet time':'마지막 완료 단계 · 행성 시간 기준');
 document.getElementById('weather-cloud-stock')!.textContent=formatReading(cloud,2)+' kg';
 for(const [id,value] of [['weather-condensation',pulse?.condensation],['weather-rain',pulse?.rain],['weather-snow',pulse?.snow]] as const)document.getElementById(id)!.textContent=value===undefined?'—':formatReading(value,4)+(en?' kg/planet minute':' kg/행성분');
 return cloud;
}
