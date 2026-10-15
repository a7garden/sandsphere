import {METRICS,SMOKE_METRICS,COMBUSTION_METRICS,CHEMISTRY_METRICS,GIANT_CLOUD_METRICS,measurePlanet,TelemetryStore,type PlanetTelemetry,type TelemetryInput,type TelemetryPoint} from './telemetry';

export interface SavedPlanetTelemetry extends Omit<PlanetTelemetry,'energy'> {energy:number[];historyMode?:'append';}
export interface TelemetryArchive {version:1;planets:SavedPlanetTelemetry[];baseSavedAt?:number;}
export interface TelemetryCheckpoint {id:string;name:string;input:TelemetryInput;settledEnergy?:number;}
const marsMetrics=[...SMOKE_METRICS,...COMBUSTION_METRICS,...CHEMISTRY_METRICS,'chemicalEnergy','carbonDioxideIce','surfaceDust','airborneDust','hydrogen','helium','mole_hydrogen','mole_helium',...GIANT_CLOUD_METRICS];
const nullable=new Set(['seed',...marsMetrics,'gasTemp','scaleHeight','boundary','binding','rainRate','snowRate','rainCover','snowCover',...METRICS.filter(m=>m.key.startsWith('mole_')).map(m=>m.key)]);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const nonnegative=(value:unknown):value is number=>finite(value)&&value>=0;
export function pointValid(value:unknown):value is TelemetryPoint {
 if(!value||typeof value!=='object')return false;
 const p=value as TelemetryPoint;
 return nonnegative(p.time)&&typeof p.profileValid==='boolean'&&!!p.values&&typeof p.values==='object'
  &&METRICS.every(m=>finite(p.values[m.key])||nullable.has(m.key)&&p.values[m.key]===null||[...marsMetrics,'seed'].includes(m.key)&&p.values[m.key]===undefined)
  &&(p.detailsUnavailable===true?Array.isArray(p.histogram)&&!p.histogram.length&&Array.isArray(p.bins)&&!p.bins.length:
   p.detailsUnavailable===undefined&&Array.isArray(p.histogram)&&p.histogram.length===24&&p.histogram.every(v=>nonnegative(v)&&v<=100)
   &&Array.isArray(p.bins)&&p.bins.length===25&&p.bins.every((v,i)=>finite(v)&&(!i||v>p.bins[i-1])));
}
function recordValid(value:unknown):value is SavedPlanetTelemetry {
 if(!value||typeof value!=='object')return false;
 const r=value as SavedPlanetTelemetry;
 if(typeof r.id!=='string'||typeof r.name!=='string'||!r.name.length||r.name.length>28||!pointValid(r.baseline)
  ||!Array.isArray(r.points)||!r.points.length||r.points.length>2048
  ||!r.points.every((p,i)=>pointValid(p)&&p.time>=r.baseline.time&&(!i||p.time>r.points[i-1].time))
  ||!Array.isArray(r.energy)||r.energy.length!==4||!r.energy.every(finite)
  ||!nonnegative(r.rain)||!nonnegative(r.snow)||!nonnegative(r.interval)
  ||!finite(r.lastSample)||r.lastSample!==r.points.at(-1)!.time
  ||r.historyMode!==undefined&&r.historyMode!=='append'
  ||r.gaps!==undefined&&(!Array.isArray(r.gaps)||r.gaps.length>2048||!r.gaps.every((g,i)=>g&&nonnegative(g.start)&&finite(g.end)&&g.end>g.start&&g.start>=r.baseline.time&&g.end<=r.lastSample&&(!i||g.start>=r.gaps![i-1].end))))return false;
 for(const key of ['rainRate','snowRate','rainCover','snowCover'] as const)if(r[key]!==null&&(!nonnegative(r[key])||(key.endsWith('Cover')&&r[key]!>100)))return false;
 const last=r.points.at(-1)!.values;
 return r.energy.every((v,k)=>v===last['energy'+k])&&r.rain===last.rainTotal&&r.snow===last.snowTotal;
}
export function compact(points:TelemetryPoint[]){
 while(points.length>2048)points=[...points.slice(0,1024).filter((_,i)=>i%2===0),...points.slice(1024)];
 return points;
}
function sameBaseline(a:TelemetryPoint,b:TelemetryPoint){return a.time===b.time&&METRICS.every(m=>marsMetrics.includes(m.key)?(a.values[m.key]??null)===(b.values[m.key]??null):a.values[m.key]===b.values[m.key]);}
export function fullTelemetryArchive(value:unknown):value is TelemetryArchive {
 if(!value||typeof value!=='object')return false;
 const a=value as TelemetryArchive;
 return a.version===1&&a.baseSavedAt===undefined&&Array.isArray(a.planets)&&a.planets.length<=4&&a.planets.every(p=>recordValid(p)&&!p.historyMode)&&new Set(a.planets.map(p=>p.id)).size===a.planets.length;
}

/** Immutable checkpoint paired with the saved world, including settled command/grain energy.
 * The live recorder stays untouched while its asynchronous IDB transaction is pending. */
export function archiveTelemetry(store:TelemetryStore,checkpoints:TelemetryCheckpoint[],base?:{savedAt:number;archive:TelemetryArchive}):TelemetryArchive {
 const planets:SavedPlanetTelemetry[]=[];
 for(const {id,name,input,settledEnergy=0} of checkpoints){
  const r=store.planets.get(id);if(!r)continue;
  const point=measurePlanet(input),energy=Array.from(r.energy);energy[1]+=settledEnergy;
  energy.forEach((v,k)=>point.values['energy'+k]=v);
  Object.assign(point.values,{rainTotal:r.rain,snowTotal:r.snow,rainRate:r.rainRate,snowRate:r.snowRate,rainCover:r.rainCover,snowCover:r.snowCover});
  let points=compact([...r.points.filter(p=>p.time<point.time),point]);
  const saved:SavedPlanetTelemetry={...r,name,points,energy,lastSample:point.time,interval:Math.max(0,point.time-r.lastSample)};
  const previous=base?.archive.planets.find(p=>p.id===id);
  if(previous&&sameBaseline(previous.baseline,r.baseline)&&point.time>=previous.lastSample){
   saved.historyMode='append';saved.points=points.filter(p=>p.time>=previous.lastSample);
  }
  planets.push(saved);
 }
 return {version:1,planets,...(base?{baseSavedAt:base.savedAt}:{})};
}

/** Invalid analytics must never prevent a valid planet from opening. Return failures for backup. */
export function restoreTelemetry(store:TelemetryStore,value:unknown,worlds:{id:string;name:string;time:number}[],base?:{savedAt:number;archive:unknown}){
 const result={restored:0,rejected:0};
 if(value===undefined)return result;
 if(!value||typeof value!=='object'||(value as TelemetryArchive).version!==1||!Array.isArray((value as TelemetryArchive).planets)||(value as TelemetryArchive).planets.length>4){result.rejected++;return result;}
 const archive=value as TelemetryArchive,seen=new Set<string>();
 for(const raw of archive.planets){
  if(!recordValid(raw)||seen.has(raw.id)){result.rejected++;continue;}seen.add(raw.id);
  const world=worlds.find(w=>w.id===raw.id);if(!world)continue;
  if(Math.abs(raw.lastSample-world.time)>1e-7){result.rejected++;continue;}
  let points=raw.points;
  if(raw.historyMode==='append'){
   const prior=base?.archive as TelemetryArchive|undefined,previous=prior?.version===1&&Array.isArray(prior.planets)?prior.planets.find(p=>p.id===raw.id):undefined;
   if(!base||archive.baseSavedAt!==base.savedAt||!recordValid(previous)||previous.historyMode||!sameBaseline(previous.baseline,raw.baseline)||previous.lastSample>raw.lastSample){result.rejected++;continue;}
   const merged=new Map(previous.points.map(p=>[p.time,p]));for(const point of points)merged.set(point.time,point);
   points=compact([...merged.values()].sort((a,b)=>a.time-b.time));
  }
  const {historyMode:_mode,...record}=raw;
  const normalize=(p:TelemetryPoint)=>{const copy=structuredClone(p);for(const key of marsMetrics)if(copy.values[key]===undefined)copy.values[key]=null;return copy;};
  store.planets.set(raw.id,{...record,name:world.name,points:points.map(normalize),baseline:normalize(raw.baseline),energy:new Float64Array(raw.energy)});
  result.restored++;
 }
 return result;
}
