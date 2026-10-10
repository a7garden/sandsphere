import {describe,it,expect} from 'vitest';
import {F,STRIDE,totalEnthalpy} from '../src/sim/model';
import {TelemetryStore,delta,energyResidual,type TelemetryInput} from '../src/sim/telemetry';
import {archiveTelemetry,restoreTelemetry,fullTelemetryArchive} from '../src/sim/telemetryPersistence';

function input(time=0):TelemetryInput{const state=new Float32Array(STRIDE);state[F.rock]=10;state[F.temperature]=20;return {time,state,environment:{ambient:18,sunlight:1,sun:[1,0,0]},supplied:0,removed:0,escaped:0,transferredIn:0,transferredOut:0};}
function recordTo(time:number){const store=new TelemetryStore();for(let t=0;t<=time;t++){if(t)store.step('p',1,[1,2,3,4],[.2,.3]);store.sample('p','P',input(t));}return store;}
const cp=(time:number)=>[{id:'p',name:'P',input:input(time)}];
const worlds=(time:number)=>[{id:'p',name:'Renamed',time}];
const json=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
describe('persistent analytics',()=>{
 it('round trips history, baseline, null readings and cumulative counters, then continues integration',()=>{
  const store=recordTo(5),save=json(archiveTelemetry(store,cp(5))),restored=new TelemetryStore();
  expect(fullTelemetryArchive(save)).toBe(true);expect(restoreTelemetry(restored,save,worlds(5))).toEqual({restored:1,rejected:0});
  const r=restored.planets.get('p')!;expect(r.name).toBe('Renamed');expect(r.baseline.time).toBe(0);expect(r.points.map(p=>p.time)).toEqual([0,1,2,3,4,5]);expect(r.baseline.values.rainRate).toBeNull();
  restored.step('p',1,[1,2,3,4],[.2,.3]);restored.sample('p','P',input(6));
  expect([...r.energy]).toEqual([6,12,18,24]);expect(r.rain).toBeCloseTo(1.2);expect(r.points.at(-1)!.values.rainTotal).toBeCloseTo(1.2);
 });
 it('merges the synchronous exit journal with the exact earlier IDB base, without duplicate times',()=>{
  const store=recordTo(5),base={savedAt:100,archive:json(archiveTelemetry(store,cp(5)))};
  for(let t=6;t<=8;t++){store.step('p',1,[1,2,3,4],[.2,.3]);store.sample('p','P',input(t));}
  const patch=json(archiveTelemetry(store,cp(8),base)),restored=new TelemetryStore();
  expect(patch.planets[0].historyMode).toBe('append');expect(patch.planets[0].points.map(p=>p.time)).toEqual([5,6,7,8]);
  expect(restoreTelemetry(restored,patch,worlds(8),base)).toEqual({restored:1,rejected:0});
  expect(restored.planets.get('p')!.points.map(p=>p.time)).toEqual([0,1,2,3,4,5,6,7,8]);
  expect(restoreTelemetry(new TelemetryStore(),patch,worlds(8),{...base,savedAt:101}).rejected).toBe(1);
 });
 it('retains a same-time edit baseline independently and persists an explicit baseline reset',()=>{
  const store=recordTo(0),edit=input();edit.state[F.rock]=15;edit.supplied=5;store.sample('p','P',edit,true);
  const save=archiveTelemetry(store,[{id:'p',name:'P',input:edit}]),restored=new TelemetryStore();restoreTelemetry(restored,json(save),worlds(0));
  const r=restored.planets.get('p')!;expect(delta(r.points[0],r.baseline,'mass')).toBe(5);
  store.reset('p');const patch=archiveTelemetry(store,[{id:'p',name:'P',input:edit}],{savedAt:100,archive:save});
  expect(patch.planets[0].historyMode).toBeUndefined();restoreTelemetry(restored,json(patch),worlds(0));expect(delta(restored.planets.get('p')!.points[0],restored.planets.get('p')!.baseline,'mass')).toBe(0);
 });
 it('settles saved command energy only in the checkpoint, preserving the running recorder',()=>{
  const store=recordTo(0),current=input(.5);current.state[F.rock]=12;current.supplied=2;const adjustment=totalEnthalpy(current.state)-totalEnthalpy(input().state);
  const save=archiveTelemetry(store,[{id:'p',name:'P',input:current,settledEnergy:adjustment}]);
  expect(store.planets.get('p')!.energy[1]).toBe(0);expect(store.planets.get('p')!.points.at(-1)!.time).toBe(0);
  const restored=new TelemetryStore();restoreTelemetry(restored,json(save),worlds(.5));const r=restored.planets.get('p')!;
  expect(r.energy[1]).toBe(adjustment);expect(energyResidual(r.points.at(-1)!,r.baseline)).toBeCloseTo(0);
 });
 it('rejects corrupt or differently timed analytics while continuing to accept unaffected planets',()=>{
  const store=recordTo(2);store.sample('q','Q',input(2));const valid=archiveTelemetry(store,[...cp(2),{id:'q',name:'Q',input:input(2)}]);
  const bad=json(valid);bad.planets[0].points[1].values.mass=NaN;
  const restored=new TelemetryStore();expect(restoreTelemetry(restored,bad,[...worlds(2),{id:'q',name:'Q',time:2}])).toEqual({restored:1,rejected:1});expect(restored.planets.has('p')).toBe(false);
  expect(restoreTelemetry(new TelemetryStore(),valid,worlds(1)).rejected).toBe(1);
  expect(restoreTelemetry(new TelemetryStore(),{version:99},worlds(2)).rejected).toBe(1);
  expect(restoreTelemetry(new TelemetryStore(),undefined,worlds(2))).toEqual({restored:0,rejected:0});
 });
 it('keeps complete and journal histories bounded after compaction, across repeated restarts',()=>{
  const store=recordTo(2100),base={savedAt:100,archive:archiveTelemetry(store,cp(2100))};
  for(let t=2101;t<=2110;t++)store.sample('p','P',input(t));
  const patch=json(archiveTelemetry(store,cp(2110),base)),restored=new TelemetryStore();expect(restoreTelemetry(restored,patch,worlds(2110),base).restored).toBe(1);
  const r=restored.planets.get('p')!;expect(r.points.length).toBeLessThanOrEqual(2048);expect(r.baseline.time).toBe(0);expect(r.points[0].time).toBe(0);expect(r.points.at(-1)!.time).toBe(2110);
  const again=new TelemetryStore();restoreTelemetry(again,json(archiveTelemetry(restored,cp(2110))),worlds(2110));expect(again.planets.get('p')!.points).toEqual(r.points);
 });
});
