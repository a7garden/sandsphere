import {METRICS,metricByKey,delta,massResidual,energyResidual,telemetryCsv,type MetricGroup,type PlanetTelemetry,type TelemetryPoint,TelemetryStore} from '../sim/telemetry';
import {icon} from './icons';
import {formatPlanetElapsed} from './simulationTime';
import {currentLocale,translatePhrase} from './i18n';

type Page='overview'|MetricGroup;
const PAGES:Record<Page,string>={overview:'전체',matter:'물질',thermal:'열 상태',water:'물 순환',atmosphere:'대기',ecology:'생태',budget:'수지 검증'};
const COLORS=['#4294ae','#87bbcb','#9972b1','#a18a68','#5b956f','#ba7968'];
interface Chart {id:string;title:string;unit:string;keys:string[];relative?:boolean;absolute?:boolean;}
const CHARTS:Record<string,Chart>={
 temperature:{id:'temperature',title:'표면 온도 · 평균 / P10 / P90',unit:'°C',keys:['tempMean','tempP10','tempP90']},
 extremes:{id:'extremes',title:'온도 범위 · 최소 / 평균 / 최대',unit:'°C',keys:['tempMin','tempMean','tempMax']},
 water:{id:'water',title:'H₂O 상 분포',unit:'kg',keys:['water','waterIce','vapor','cloudWater','cloudIce']},
 rain:{id:'rain',title:'강수율 · 실제값',unit:'kg/행성분',keys:['rainRate','snowRate'],absolute:true},
 pressure:{id:'pressure',title:'대기 압력',unit:'atm',keys:['pressure']},
 atmosphere:{id:'atmosphere',title:'기체 몰 분율',unit:'%',keys:['mole_nitrogen','mole_methane','mole_carbonDioxide','mole_vapor']},
 matter:{id:'matter',title:'질량 분포',unit:'kg',keys:['terrain','liquid','ice','gas','cloud','biomass']},
 biology:{id:'biology',title:'먹이망 · 질량',unit:'kg',keys:['plant','herbivore','carnivore','soil']},
 coverage:{id:'coverage',title:'셀 점유율',unit:'%',keys:['plantCover','cloudCover','rainCover','snowCover']},
 energy:{id:'energy',title:'누적 에너지 교환 · 기준 대비',unit:'kJ',keys:['energy0','energy1','energy2','energy3'],relative:true},
 massBudget:{id:'massBudget',title:'누적 외부 질량 교환 · 기준 대비',unit:'kg',keys:['supplied','transferredIn','removed','transferredOut','escaped'],relative:true},
};
export function dashboardMarkup(){return `<dialog id="planet-dashboard" class="planet-dashboard" aria-labelledby="dashboard-title">
 <div class="dashboard-header"><div><h2 id="dashboard-title">행성 대시보드</h2><span class="dashboard-model" title="게임 표면층 모델. kg는 정규화된 게임 질량, kJ는 보정된 모델 에너지입니다. 실제 천체의 물리량이 아닙니다.">SURFACE MODEL <span>kg · kJ</span></span></div><div class="dashboard-header-actions"><button id="dashboard-import" class="icon-button" aria-label="CSV 불러오기" title="선택한 행성의 이전 시계열 CSV 불러오기">${icon('load')}</button><input id="dashboard-import-file" type="file" accept=".csv,text/csv" hidden><button id="dashboard-export" class="text-button" title="이전에 저장한 기록을 포함한 모든 시계열 · CSV">${icon('save')}<span>CSV</span></button><button class="icon-button dialog-close" aria-label="대시보드 닫기">${icon('close')}</button></div></div>
 <div class="dashboard-toolbar"><label class="dashboard-planet"><span>행성</span><select id="dashboard-planet" aria-label="분석할 행성"></select></label><div class="dashboard-time-window" role="group" aria-label="차트 시간 범위"><button data-dashboard-window="60" aria-pressed="false">최근 1시간</button><button data-dashboard-window="300" aria-pressed="false">최근 5시간</button><button data-dashboard-window="all" aria-pressed="true">전체</button></div><div class="dashboard-scale" role="group" aria-label="차트 값 표시"><button data-dashboard-scale="absolute" aria-pressed="true">실제값</button><button data-dashboard-scale="delta" aria-pressed="false">Δ 기준</button></div><button id="dashboard-reset" class="icon-button" title="현재 값을 새 기준으로 설정 · 선택한 행성의 관측 기록 초기화" aria-label="현재 값을 관측 기준으로 설정">${icon('reset')}</button></div>
 <div class="dashboard-workspace"><nav class="dashboard-nav" aria-label="데이터 분류">${Object.entries(PAGES).map(([id,name])=>`<button data-dashboard-page="${id}" aria-pressed="${id==='overview'}"><span data-i18n-key="dashboard.page.${id}">${name}</span><span>${id==='overview'?'01':String(Object.keys(PAGES).indexOf(id)+1).padStart(2,'0')}</span></button>`).join('')}</nav><div id="dashboard-content" class="dashboard-content"></div></div>
 <footer class="dashboard-footer"><span id="dashboard-observation"></span><span id="dashboard-import-status" role="status" hidden></span><span id="dashboard-quality"></span></footer></dialog>`;}

function format(value:number|null|undefined,digits=2,signed=false){
 if(value==null||!Number.isFinite(value))return '—';
 const abs=Math.abs(value),v=abs<.5*10**-digits?0:value;
 return (signed&&v>0?'+':'')+(Math.abs(v)>=1e7||v!==0&&Math.abs(v)<1e-4?v.toExponential(3):new Intl.NumberFormat('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(v));
}
const elapsed=(time:number)=>formatPlanetElapsed(time);
const displayUnit=(key:string,unit:string)=>key==='rainRate'||key==='snowRate'||unit==='kg/행성분'?(currentLocale()==='en'?'kg/planet min':'kg/행성분'):unit;
function chartMarkup(id:string){const c=CHARTS[id],title=translatePhrase(c.title);return `<section class="dashboard-chart"><div class="dashboard-section-heading"><h3>${c.title}</h3><span>${displayUnit('',c.unit)}</span></div><div class="dashboard-plot" data-dashboard-chart="${id}" tabindex="0" role="group" aria-label="${title} ${currentLocale()==='en'?'time series':'시계열'}" title="${currentLocale()==='en'?'Hover or use ← → to inspect readings':'호버 또는 ← → 키로 관측값 조회'}"><svg viewBox="0 0 640 190" role="img" aria-label="${title} ${currentLocale()==='en'?'trend':'추이'}"></svg><div class="chart-crosshair" hidden></div></div><div class="dashboard-chart-readout" data-chart-readout="${id}"></div></section>`;}
function tableMarkup(keys:string[]){return `<section class="dashboard-table-section"><div class="dashboard-section-heading"><h3>측정값</h3><span>Δ = 현재 − 기준</span></div><div class="dashboard-table-scroll"><table class="dashboard-table"><thead><tr><th scope="col">항목</th><th scope="col">단위</th><th scope="col">현재</th><th scope="col">기준</th><th scope="col">Δ</th><th scope="col">Δ %</th></tr></thead><tbody>${keys.map(key=>{const m=metricByKey.get(key)!;return `<tr title="${m.tip??m.name}"><th scope="row">${m.name}</th><td>${displayUnit(key,m.unit)}</td><td data-reading="${key}"></td><td data-baseline="${key}"></td><td data-delta="${key}"></td><td data-percent="${key}"></td></tr>`;}).join('')}</tbody></table></div></section>`;}
function budgetMarkup(){return `<section class="dashboard-budget"><div class="dashboard-section-heading"><h3>보존 수지</h3><span>관측 기준 대비</span></div><div class="budget-equations"><div><span>ΔM − (공급 + 투입 − 배출 − 회수 − 탈출)</span><output id="dashboard-mass-residual"></output></div><div><span>ΔH − (Qenv + Qcmd + Qesc + Qnum)</span><output id="dashboard-energy-residual"></output></div></div></section>`;}

export class PlanetDashboard {
 private readonly dialog=document.getElementById('planet-dashboard') as HTMLDialogElement;
 private readonly content=document.getElementById('dashboard-content')!;
 private page:Page='overview';private selected='';private window:number|null=null;private relative=false;private lastRender=0;
 private chartPoints=new Map<string,TelemetryPoint[]>();
 constructor(private store:TelemetryStore,private refresh:()=>Promise<void>,private activeId:()=>string,private importHistory:(id:string,text:string)=>Promise<void>){
  document.getElementById('dashboard-open')!.addEventListener('click',async()=>{await this.refresh();this.selected=this.activeId();this.updatePlanets();this.build();if(!this.dialog.open)this.dialog.showModal();this.render(true);});
  document.getElementById('dashboard-planet')!.addEventListener('change',event=>{this.selected=(event.target as HTMLSelectElement).value;this.render(true);});
  this.dialog.querySelectorAll<HTMLButtonElement>('[data-dashboard-page]').forEach(b=>b.addEventListener('click',()=>{this.page=b.dataset.dashboardPage as Page;this.build();this.render(true);}));
  this.dialog.querySelectorAll<HTMLButtonElement>('[data-dashboard-window]').forEach(b=>b.addEventListener('click',()=>{this.window=b.dataset.dashboardWindow==='all'?null:Number(b.dataset.dashboardWindow);this.render(true);}));
  this.dialog.querySelectorAll<HTMLButtonElement>('[data-dashboard-scale]').forEach(b=>b.addEventListener('click',()=>{this.relative=b.dataset.dashboardScale==='delta';this.render(true);}));
  document.getElementById('dashboard-reset')!.addEventListener('click',async()=>{await this.refresh();this.store.reset(this.selected);this.render(true);});
  const fileInput=document.getElementById('dashboard-import-file') as HTMLInputElement,importButton=document.getElementById('dashboard-import') as HTMLButtonElement;
  importButton.addEventListener('click',()=>fileInput.click());
  fileInput.addEventListener('change',async()=>{const file=fileInput.files?.[0],id=this.selected;fileInput.value='';if(!file)return;const status=document.getElementById('dashboard-import-status')!;importButton.disabled=true;
   try{if(file.size>8*1024*1024)throw new Error('CSV 파일은 8 MB 이하여야 합니다.');await this.importHistory(id,await file.text());this.window=null;status.textContent='CSV 기록을 합쳤습니다.';this.render(true);}
   catch(error){status.textContent=error instanceof Error?error.message:'CSV 기록을 불러오지 못했습니다.';}finally{status.hidden=false;importButton.disabled=false;}
  });
  document.getElementById('dashboard-export')!.addEventListener('click',()=>{const r=this.store.planets.get(this.selected);if(!r)return;const url=URL.createObjectURL(new Blob([telemetryCsv(r)],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`sandsphere-${r.id}-${Math.round(r.baseline.time)}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  this.dialog.addEventListener('close',()=>document.getElementById('dashboard-open')!.focus());
  window.addEventListener('sandsphere-language-change',()=>{this.build();this.render(true);});
  window.addEventListener('resize',()=>{if(this.dialog.open)this.render(true);});
 }
 private updatePlanets(){const select=document.getElementById('dashboard-planet') as HTMLSelectElement;for(const r of this.store.planets.values()){let option=[...select.options].find(o=>o.value===r.id);if(!option){option=document.createElement('option');option.value=r.id;option.translate=false;select.append(option);}option.textContent=r.name;}select.value=this.selected;}
 private build(){
  this.dialog.querySelectorAll<HTMLButtonElement>('[data-dashboard-page]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.dashboardPage===this.page)));
  const keys=this.page==='overview'?['mass','tempMean','pressure','waterTotal','biomass','escaped']:METRICS.filter(m=>m.group===this.page).map(m=>m.key);
  const cards:Record<Page,string[]>={overview:keys,matter:['mass','surface','terrain','airborne'],thermal:['tempMean','tempMin','tempMax','enthalpy'],water:['waterTotal','water','waterIce','rainRate'],atmosphere:['pressure','gas','gasTemp','scaleHeight'],ecology:['biomass','plant','herbivore','carnivore'],budget:['supplied','transferredIn','removed','escaped']};
  const charts:Record<Page,string[]>={overview:['temperature','water','energy','rain'],matter:['matter','massBudget'],thermal:['extremes','energy'],water:['water','rain'],atmosphere:['pressure','atmosphere'],ecology:['biology','coverage'],budget:['massBudget','energy']};
  this.content.innerHTML=`<div class="dashboard-kpis" data-count="${cards[this.page].length}">${cards[this.page].map(key=>{const m=metricByKey.get(key)!;return `<article class="dashboard-kpi" title="${m.tip??m.name}"><h3>${m.name}</h3><div><output data-reading="${key}"></output><span>${displayUnit(key,m.unit)}</span></div><span class="kpi-delta" data-kpi-delta="${key}"></span></article>`;}).join('')}</div><div class="dashboard-charts">${charts[this.page].map(chartMarkup).join('')}</div>${this.page==='thermal'?'<section class="dashboard-histogram"><div class="dashboard-section-heading"><h3>표면 온도 분포</h3><span>셀 비율 % · 현재</span></div><svg id="dashboard-histogram" viewBox="0 0 960 160" role="img" aria-label="표면 셀 온도 분포"></svg></section>':''}${this.page==='matter'||this.page==='atmosphere'?'<section class="dashboard-composition"><div class="dashboard-section-heading"><h3>'+(this.page==='matter'?'질량 조성':'기체 몰 조성')+'</h3><span>'+(this.page==='matter'?'낙하 · 투입 대기 제외':'몰 분율 %')+'</span></div><div id="dashboard-composition"></div></section>':''}${this.page==='budget'||this.page==='overview'?budgetMarkup():''}${tableMarkup(keys)}`;
  this.content.querySelectorAll<HTMLElement>('[data-dashboard-chart]').forEach(plot=>{
   plot.addEventListener('pointermove',e=>{const points=this.chartPoints.get(plot.dataset.dashboardChart!)??[],rect=plot.getBoundingClientRect(),width=Number(plot.dataset.chartWidth??640),x=(e.clientX-rect.left)/rect.width*width;if(!points.length)return;const first=points[0].time,last=points.at(-1)!.time,target=first+(x-54)/(width-70)*(last-first);let nearest=0;for(let i=1;i<points.length;i++)if(Math.abs(points[i].time-target)<Math.abs(points[nearest].time-target))nearest=i;plot.dataset.inspect='pointer';this.readout(plot,nearest,true);});
   plot.addEventListener('pointerleave',()=>{delete plot.dataset.inspect;this.readout(plot,-1,false);});
   plot.addEventListener('keydown',e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight'&&e.key!=='Home'&&e.key!=='End')return;e.preventDefault();const points=this.chartPoints.get(plot.dataset.dashboardChart!)??[],previous=Number(plot.dataset.cursor??points.length-1),index=e.key==='Home'?0:e.key==='End'?points.length-1:previous+(e.key==='ArrowLeft'?-1:1);plot.dataset.inspect='keyboard';this.readout(plot,Math.max(0,Math.min(points.length-1,index)),true);});
   plot.addEventListener('blur',()=>{if(plot.dataset.inspect==='keyboard'){delete plot.dataset.inspect;this.readout(plot,-1,false);}});
  });
 }
 render(force=false){
  if(!this.dialog.open&&!force)return;const now=performance.now();if(!force&&now-this.lastRender<500)return;this.lastRender=now;
  const r=this.store.planets.get(this.selected);if(!r?.points.length)return;
  this.updatePlanets();const p=r.points.at(-1)!;
  const en=currentLocale()==='en';
  document.getElementById('dashboard-observation')!.textContent=en?`Planet time · baseline ${elapsed(r.baseline.time)} · current ${elapsed(p.time)} · ${r.points.length.toLocaleString()} samples`:`행성 시간 · 기준 ${elapsed(r.baseline.time)} · 현재 ${elapsed(p.time)} · ${r.points.length.toLocaleString()} 표본`;
  document.getElementById('dashboard-quality')!.textContent=this.page==='atmosphere'?(en?'Isothermal spherical approximation · '+(!p.values.gas?'No gases':p.profileValid?'Profile valid':'Outside profile model range'):'등온 구면 근사 · '+(!p.values.gas?'기체 없음':p.profileValid?'프로파일 유효':'프로파일 모델 범위 초과')):en?`History saved automatically · default one sample per planet minute${r.points.length>1&&r.points[1].time-r.points[0].time>1.1?' · Earlier intervals compressed':''}${r.gaps?.length?' · observation gap '+r.gaps.length:''}`:`기록 자동 저장 · 기본 행성 1분/표본${r.points.length>1&&r.points[1].time-r.points[0].time>1.1?' · 이전 구간 압축':''}${r.gaps?.length?' · 관측 공백 '+r.gaps.length+'곳':''}`;
  this.dialog.querySelectorAll<HTMLButtonElement>('[data-dashboard-window]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.dashboardWindow===(this.window===null?'all':String(this.window)))));
  this.dialog.querySelectorAll<HTMLButtonElement>('[data-dashboard-scale]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.dashboardScale===(this.relative?'delta':'absolute'))));
  for(const m of METRICS){
   const value=p.values[m.key],base=r.baseline.values[m.key],d=delta(p,r.baseline,m.key);
   this.content.querySelectorAll<HTMLElement>(`[data-reading="${m.key}"]`).forEach(el=>el.textContent=format(value,m.digits));
   this.content.querySelectorAll<HTMLElement>(`[data-baseline="${m.key}"]`).forEach(el=>el.textContent=format(base,m.digits));
   this.content.querySelectorAll<HTMLElement>(`[data-delta="${m.key}"]`).forEach(el=>el.textContent=format(d,m.digits,true)+(m.unit==='%'&&d!==null?' pp':''));
   this.content.querySelectorAll<HTMLElement>(`[data-percent="${m.key}"]`).forEach(el=>el.textContent=m.unit==='°C'||m.unit==='%'||!base||d===null?'—':format(d/Math.abs(base)*100,2,true)+'%');
   this.content.querySelectorAll<HTMLElement>(`[data-kpi-delta="${m.key}"]`).forEach(el=>el.textContent='Δ '+format(d,m.digits,true)+' '+(m.unit==='%'?'pp':displayUnit(m.key,m.unit)));
  }
  const quality=document.getElementById('dashboard-quality')!;quality.title=r.gaps?.length?(en?'Charts do not connect across gaps. Cumulative energy and precipitation include recorded intervals only. A full energy budget cannot be calculated across gaps.':'기록이 없는 구간은 차트를 연결하지 않습니다. 누적 에너지와 강수량은 기록된 구간만 합산합니다. 공백을 포함하는 전체 에너지 수지는 계산하지 않습니다.'):
    '';
  const massOutput=document.getElementById('dashboard-mass-residual'),energyOutput=document.getElementById('dashboard-energy-residual');
  if(massOutput){massOutput.textContent=format(massResidual(p,r.baseline),5,true)+' kg';massOutput.title=en?'Includes falling particles and pending input. Floating-point residual from the surface model.':'낙하 입자와 미처리 공급 포함. 표면 모델 부동소수점 잔차.';}
  if(energyOutput){energyOutput.textContent=r.gaps?.length?(en?'— · observation gap':'— · 관측 공백'):format(energyResidual(p,r.baseline),5,true)+' kJ';energyOutput.title=r.gaps?.length?(en?'Energy exchange during the gap was not recorded, so the full budget cannot be calculated.':'공백 구간의 에너지 교환이 기록되지 않아 전체 수지를 계산할 수 없습니다.'):(en?'Residual after subtracting the four integrated energy channels from surface enthalpy.':'표면 엔탈피에서 실제 적분된 네 에너지 채널의 합을 뺀 잔차.');}
  const points=this.window===null?r.points:r.points.filter(point=>point.time>=p.time-this.window!);
  this.content.querySelectorAll<HTMLElement>('[data-dashboard-chart]').forEach(plot=>this.plot(plot,points,r));
  if(this.page==='thermal')this.histogram(p);
  if(this.page==='matter'||this.page==='atmosphere')this.composition(p);
 }
 private value(p:TelemetryPoint,key:string,r:PlanetTelemetry,relative:boolean){return relative?delta(p,r.baseline,key):p.values[key];}
 private plot(el:HTMLElement,points:TelemetryPoint[],r:PlanetTelemetry){
  const c=CHARTS[el.dataset.dashboardChart!],relative=c.absolute?false:c.relative||this.relative,all=points.flatMap(p=>c.keys.map(key=>this.value(p,key,r,relative))).filter((v):v is number=>v!=null&&Number.isFinite(v));
  el.closest('.dashboard-chart')!.querySelector('.dashboard-section-heading>span')!.textContent=relative?'Δ '+(c.unit==='%'?'pp':displayUnit('',c.unit)):displayUnit('',c.unit);
  let low=all.length?Math.min(...all):0,high=all.length?Math.max(...all):1;
  const pad=Math.max((high-low)*.1,Math.abs(high)*.0001,1e-6);low-=pad;high+=pad;
  if(!relative&&c.unit!=='°C'&&all.every(v=>v>=0))low=Math.max(0,low);
  const first=points[0]?.time??0,last=points.at(-1)?.time??first;
  const width=el.clientWidth<480?440:640,end=width-16;el.dataset.chartWidth=String(width);el.querySelector('svg')!.setAttribute('viewBox',`0 0 ${width} 190`);
  const x=(time:number)=>54+(time-first)/Math.max(last-first,1)*(width-70),y=(v:number)=>152-(v-low)/(high-low)*130;
  const digits=Math.min(6,Math.max(0,Math.ceil(-Math.log10((high-low)/2))+1));
  const grid=[0,.5,1].map(f=>{const value=low+(high-low)*f,cy=y(value),label=Math.abs(value)>=1e4?value.toExponential(1):format(value,digits);return `<path d="M54 ${cy}H${end}" class="chart-grid"/><text x="46" y="${cy+4}" text-anchor="end">${label}</text>`;}).join('');
  const paths=c.keys.map((key,k)=>{let path='',connected=false,previousTime:number|undefined;for(const p of points){if(previousTime!==undefined&&r.gaps?.some(g=>previousTime!<=g.start&&p.time>=g.end))connected=false;previousTime=p.time;const v=this.value(p,key,r,relative);if(v==null||!Number.isFinite(v)){connected=false;continue;}path+=(connected?'L':'M')+x(p.time).toFixed(2)+' '+y(v).toFixed(2)+' ';connected=true;}
   const latest=points.at(-1),v=latest?this.value(latest,key,r,relative):null,color=metricByKey.get(key)?.color??COLORS[k];return `<path d="${path}" stroke="${color}" stroke-width="1.8" fill="none" vector-effect="non-scaling-stroke"/>${v!=null?`<circle cx="${x(last)}" cy="${y(v)}" r="2.5" fill="${color}"/>`:''}`;}).join('');
  el.querySelector('svg')!.innerHTML=`${grid}${paths}<text x="54" y="177">${elapsed(first)}</text><text x="${end}" y="177" text-anchor="end">${elapsed(last)}</text>${!all.length?`<text x="${width/2}" y="91" text-anchor="middle" class="chart-waiting">${currentLocale()==='en'?'No observations':'관측값 없음'}</text>`:points.length<2?`<text x="${width/2}" y="91" text-anchor="middle" class="chart-waiting">${currentLocale()==='en'?'First observation · collecting history':'첫 관측 · 기록 수집 중'}</text>`:''}`;
  this.chartPoints.set(c.id,points);el.setAttribute('aria-label',`${translatePhrase(c.title)} · ${points.length} ${currentLocale()==='en'?'observations':'개 관측'} · ${relative?(currentLocale()==='en'?'change from baseline':'기준 대비 변화'):(currentLocale()==='en'?'absolute values':'실제값')}`);
  let cursor=-1;if(el.dataset.inspect&&el.dataset.cursorTime){const time=Number(el.dataset.cursorTime);for(let i=0;i<points.length;i++)if(cursor<0||Math.abs(points[i].time-time)<Math.abs(points[cursor].time-time))cursor=i;}
  this.readout(el,cursor,!!el.dataset.inspect);
 }
 private readout(el:HTMLElement,index:number,cursor:boolean){
  const c=CHARTS[el.dataset.dashboardChart!],r=this.store.planets.get(this.selected)!,points=this.chartPoints.get(c.id)??[];if(!points.length)return;
  index=index<0?points.length-1:Math.min(index,points.length-1);el.dataset.cursor=String(index);const p=points[index],relative=c.absolute?false:c.relative||this.relative;
  if(cursor)el.dataset.cursorTime=String(p.time);else delete el.dataset.cursorTime;
  const out=this.content.querySelector<HTMLElement>(`[data-chart-readout="${c.id}"]`)!;
  out.innerHTML=`<time>${elapsed(p.time)}</time>${c.keys.map((key,k)=>{const m=metricByKey.get(key)!;return `<span><i style="background:${m.color??COLORS[k]}"></i>${m.symbol} <b>${format(this.value(p,key,r,relative),m.digits,!!relative)}</b></span>`;}).join('')}`;
  const cross=el.querySelector<HTMLElement>('.chart-crosshair')!,first=points[0].time,last=points.at(-1)!.time,width=Number(el.dataset.chartWidth??640);cross.hidden=!cursor;cross.style.left=(54+(p.time-first)/Math.max(1,last-first)*(width-70))/width*100+'%';
 }
 private histogram(p:TelemetryPoint){
  const svg=document.getElementById('dashboard-histogram')!,width=svg.clientWidth<480?440:960,end=width-20,plotWidth=end-54,max=Math.max(1,...p.histogram),x=(i:number)=>54+i/24*plotWidth,y=(v:number)=>126-v/max*100;
  svg.setAttribute('viewBox',`0 0 ${width} 160`);
  svg.innerHTML=`${[0,.5,1].map(f=>`<text x="46" y="${y(max*f)+4}" text-anchor="end">${format(max*f,1)}</text><path d="M54 ${y(max*f)}H${end}" class="chart-grid"/>`).join('')}${p.histogram.map((v,i)=>`<rect x="${x(i)+2}" y="${y(v)}" width="${plotWidth/24-4}" height="${126-y(v)}" fill="#4294ae"><title>${format(p.bins[i],1)}–${format(p.bins[i+1],1)}°C · ${format(v,2)}%</title></rect>`).join('')}<text x="54" y="151">${format(p.bins[0],1)}°C</text><text x="${end}" y="151" text-anchor="end">${format(p.bins.at(-1),1)}°C</text>`;
 }
 private composition(p:TelemetryPoint){
  const keys=this.page==='matter'?['terrain','liquid','ice','gas','cloud','biomass']:['mole_nitrogen','mole_methane','mole_carbonDioxide','mole_vapor'],sum=keys.reduce((s,k)=>s+(p.values[k]??0),0);
  document.getElementById('dashboard-composition')!.innerHTML=`<div class="composition-track">${keys.map((key,k)=>`<span style="width:${sum?(p.values[key]??0)/sum*100:0}%;background:${metricByKey.get(key)?.color??COLORS[k]}"></span>`).join('')}</div><div class="composition-legend">${keys.map((key,k)=>{const m=metricByKey.get(key)!;return `<span><i style="background:${m.color??COLORS[k]}"></i>${m.name}<b>${format(p.values[key],m.digits)} ${m.unit}</b></span>`;}).join('')}</div>`;
 }
}
