import {describe,it,expect} from 'vitest';
import preservedCsv from '../artifacts/dashboard-before-persistence.csv?raw';
import {F,STRIDE} from '../src/sim/model';
import {TelemetryStore,telemetryCsv,type TelemetryInput} from '../src/sim/telemetry';
import {parseTelemetryCsv,prependTelemetryCsv} from '../src/sim/telemetryCsvImport';
import {archiveTelemetry,restoreTelemetry,fullTelemetryArchive} from '../src/sim/telemetryPersistence';

function input(time:number):TelemetryInput{const state=new Float32Array(STRIDE);state[F.rock]=10;state[F.temperature]=20;return {time,state,environment:{ambient:18,sunlight:1,sun:[1,0,0]},supplied:0,removed:0,escaped:0,transferredIn:0,transferredOut:0};}
function session(start:number,end:number){const store=new TelemetryStore();for(let t=start;t<=end;t++){if(t>start)store.step('p',1,[1,2,3,4],[.2,.3]);store.sample('p','P',input(t));}return store;}
describe('older CSV observation sessions',()=>{
 it('prepends observations and rebases cumulative channels without changing physical measurements or the original records',()=>{
  const older=session(0,3).planets.get('p')!,current=session(10,12).planets.get('p')!,merged=prependTelemetryCsv(current,telemetryCsv(older));
  expect(merged.points.map(p=>p.time)).toEqual([0,1,2,3,10,11,12]);expect(merged.baseline.time).toBe(0);expect(merged.gaps).toEqual([{start:3,end:10}]);
  expect([...merged.energy]).toEqual([5,10,15,20]);expect(merged.rain).toBeCloseTo(1);expect(merged.snow).toBeCloseTo(1.5);
  expect(merged.points[4].values.energy0).toBe(3);expect(merged.points.at(-1)!.values.mass).toBe(current.points.at(-1)!.values.mass);
  expect([...current.energy]).toEqual([2,4,6,8]);expect(current.baseline.time).toBe(10);
  expect(merged.points[0].detailsUnavailable).toBe(true);expect(merged.points[0].histogram).toEqual([]);
 });
 it('persists the imported baseline, gaps and counters across full and exit-journal restores',()=>{
  const store=session(10,12);store.planets.set('p',prependTelemetryCsv(store.planets.get('p')!,telemetryCsv(session(0,3).planets.get('p')!)));
  const base={savedAt:100,archive:JSON.parse(JSON.stringify(archiveTelemetry(store,[{id:'p',name:'P',input:input(12)}])))};
  expect(fullTelemetryArchive(base.archive)).toBe(true);store.step('p',1,[1,2,3,4],[.2,.3]);store.sample('p','P',input(13));
  const patch=archiveTelemetry(store,[{id:'p',name:'P',input:input(13)}],base),restored=new TelemetryStore();
  expect(restoreTelemetry(restored,JSON.parse(JSON.stringify(patch)),[{id:'p',name:'P',time:13}],base)).toEqual({restored:1,rejected:0});
  const r=restored.planets.get('p')!;expect(r.baseline.time).toBe(0);expect(r.gaps).toEqual([{start:3,end:10}]);expect(r.energy[0]).toBe(6);
  expect(parseTelemetryCsv(telemetryCsv(r)).gaps).toEqual(r.gaps);restored.reset('p');expect(r.gaps).toBeUndefined();
 });
 it('rejects duplicate/overlapping imports and malformed numeric readings before changing records',()=>{
  const current=session(10,12).planets.get('p')!,csv=telemetryCsv(session(0,3).planets.get('p')!),merged=prependTelemetryCsv(current,csv);
  expect(()=>prependTelemetryCsv(merged,csv)).toThrow(/이미 불러온/);
  expect(()=>prependTelemetryCsv(current,telemetryCsv(session(11,13).planets.get('p')!))).toThrow(/겹칩니다/);
  expect(()=>parseTelemetryCsv(csv.replace('10,10,0','NaN,10,0'))).toThrow(/읽을 수 없습니다/);
  expect(()=>parseTelemetryCsv(csv.replace('mass [kg]','mass [g]'))).toThrow(/Sandsphere/);
  expect(()=>parseTelemetryCsv(csv.replace('baseline_simulation_s=0','baseline_simulation_s=1'))).toThrow();
 });
 it('reads the preserved pre-persistence export with its exact timestamps and metric values',()=>{
  const parsed=parseTelemetryCsv(preservedCsv);
  expect(parsed.points.length).toBe(1571);expect(parsed.baseline.time).toBe(19871.899999879122);expect(parsed.points.at(-1)!.time).toBeGreaterThan(22465);
  expect(parsed.baseline.values.tempMean).toBe(5.876178543428869);expect(parsed.baseline.values.rainRate).toBeNull();
  expect(parsed.baseline.values.seed).toBeNull();
 });
});
