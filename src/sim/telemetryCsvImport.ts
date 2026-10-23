import {METRICS,SMOKE_METRICS,COMBUSTION_METRICS,CHEMISTRY_METRICS,GIANT_CLOUD_METRICS,type PlanetTelemetry,type TelemetryPoint,type TelemetryGap} from './telemetry';
import {pointValid,compact} from './telemetryPersistence';

const cumulative=['energy0','energy1','energy2','energy3','rainTotal','snowTotal'];
export function parseTelemetryCsv(text:string){
 if(text.length>8*1024*1024)throw new Error('CSV 파일은 8 MB 이하여야 합니다.');
 const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/),comments=lines.filter(l=>l.startsWith('#'));
 const baselineText=comments.find(l=>/baseline_simulation_s=/.test(l))?.match(/baseline_simulation_s=([^;\s]+)/)?.[1];
 const baselineTime=Number(baselineText),rows=lines.filter(l=>!l.startsWith('#'));
 const header=rows.shift(),current=['simulation_s',...METRICS.map(m=>`${m.key} [${m.unit}]`)];
 // Earlier exports did not observe seeds. Preserve them as unknown, never invent zero mass.
 const marsKeys=['carbonDioxideIce','surfaceDust','airborneDust'];
 const giantKeys=['hydrogen','helium','mole_hydrogen','mole_helium'];
 const layouts=[[],GIANT_CLOUD_METRICS,[...GIANT_CLOUD_METRICS,...giantKeys],[...GIANT_CLOUD_METRICS,...giantKeys,...marsKeys],giantKeys,[...giantKeys,...marsKeys]].flatMap(skip=>[METRICS.filter(m=>!skip.includes(m.key)),METRICS.filter(m=>m.key!=='seed'&&!skip.includes(m.key))]);
 const compatibleLayouts=layouts.flatMap(layout=>[layout,layout.filter(m=>!SMOKE_METRICS.includes(m.key))]).flatMap(layout=>[layout,layout.filter(m=>!COMBUSTION_METRICS.includes(m.key))]).flatMap(layout=>[layout,layout.filter(m=>!CHEMISTRY_METRICS.includes(m.key)),layout.filter(m=>m.key!=='chemicalEnergy'),layout.filter(m=>m.key!=='chemicalEnergy'&&!CHEMISTRY_METRICS.includes(m.key))]);
 const metrics=compatibleLayouts.find(layout=>header===['simulation_s',...layout.map(m=>`${m.key} [${m.unit}]`)].join(','))??METRICS;
 const headers=['simulation_s',...metrics.map(m=>`${m.key} [${m.unit}]`)];
 if(!baselineText||!Number.isFinite(baselineTime)||baselineTime<0||header!==headers.join(',')||!rows.length||rows.length>2048)throw new Error('Sandsphere에서 내보낸 시계열 CSV를 선택하세요.');
 const points:TelemetryPoint[]=rows.map((line,i)=>{
  const cells=line.split(','),values:Record<string,number|null>={};
  if(cells.length!==headers.length)throw new Error(`CSV ${i+1}번째 관측값의 열 수가 맞지 않습니다.`);
  metrics.forEach((m,k)=>values[m.key]=cells[k+1]===''?null:/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(cells[k+1])?Number(cells[k+1]):NaN);
  if(!('seed' in values))values.seed=null;
  for(const key of [...SMOKE_METRICS,...COMBUSTION_METRICS,...CHEMISTRY_METRICS,'chemicalEnergy',...marsKeys,...giantKeys,...GIANT_CLOUD_METRICS])if(!(key in values))values[key]=null;
  const point:TelemetryPoint={time:cells[0].trim()?Number(cells[0]):NaN,values,histogram:[],bins:[],profileValid:false,detailsUnavailable:true};
  if(!pointValid(point)||point.time<baselineTime||i&&point.time<=Number(rows[i-1].split(',')[0])||cumulative.slice(4).some(k=>values[k]!<0))throw new Error(`CSV ${i+1}번째 관측값을 읽을 수 없습니다.`);
  return point;
 });
 if(points[0].time!==baselineTime)throw new Error('CSV에 최초 관측 기준값이 없어 복원할 수 없습니다.');
 let gaps:TelemetryGap[]=[];
 const gapText=comments.find(l=>l.startsWith('# observation_gaps='))?.slice('# observation_gaps='.length);
 if(gapText){try{gaps=JSON.parse(gapText);}catch{throw new Error('CSV의 관측 공백 정보가 잘못되었습니다.');}}
 if(!Array.isArray(gaps)||gaps.length>2048||!gaps.every((g,i)=>g&&Number.isFinite(g.start)&&Number.isFinite(g.end)&&g.start>=baselineTime&&g.end>g.start&&g.end<=points.at(-1)!.time&&(!i||g.start>=gaps[i-1].end)))throw new Error('CSV의 관측 공백 정보가 잘못되었습니다.');
 return {points,baseline:points[0],gaps};
}

/** Prepend an older observation session. Missing intervals stay gaps, never reconstructed data. */
export function prependTelemetryCsv(current:PlanetTelemetry,text:string):PlanetTelemetry {
 const older=parseTelemetryCsv(text),last=older.points.at(-1)!;
 if(last.time>=current.baseline.time)throw new Error('이미 불러온 기록이거나 현재 기록과 시간이 겹칩니다. 현재 기준보다 이전에 끝나는 CSV를 선택하세요.');
 const offsets=Object.fromEntries(cumulative.map(k=>[k,last.values[k]!-current.baseline.values[k]!]));
 const points=current.points.map(p=>{const values={...p.values};for(const key of cumulative)values[key]=values[key]!+offsets[key];return {...p,values};});
 return {...current,baseline:older.baseline,points:compact([...older.points,...points]),
  energy:new Float64Array([...current.energy].map((v,k)=>v+offsets['energy'+k])),rain:current.rain+offsets.rainTotal,snow:current.snow+offsets.snowTotal,
  gaps:[...older.gaps,{start:last.time,end:current.baseline.time},...(current.gaps??[])]};
}
