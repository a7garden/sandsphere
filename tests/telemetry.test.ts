import {describe,it,expect} from 'vitest';
import {F,STRIDE,seedPlanet,totalEnthalpy,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {BackgroundWorlds,type PlanetRecord} from '../src/sim/system';
import {measurePlanet,TelemetryStore,delta,massResidual,energyResidual,telemetryCsv,type TelemetryInput} from '../src/sim/telemetry';

function input(time=0):TelemetryInput {
 const state=new Float32Array(STRIDE*4);
 for(let i=0;i<4;i++){state[i*STRIDE+F.sand]=10;state[i*STRIDE+F.temperature]=i*10;}
 return {time,state,environment:{ambient:18,sunlight:1,sun:[1,0,0],gravity:1},supplied:0,removed:0,escaped:0,transferredIn:0,transferredOut:0};
}
describe('expert planet telemetry',()=>{
 it('accounts for dormant seed mass in biomass, category totals and CSV observations',()=>{
  const data=input();data.state[F.seed]=.125;data.state[F.plant]=.25;
  const record=new TelemetryStore().sample('seeds','씨앗',data),v=record.baseline.values;
  expect(v.seed).toBe(.125);expect(v.biomass).toBe(.375);
  expect(v.terrain!+v.liquid!+v.ice!+v.gas!+v.cloud!+v.biomass!).toBeCloseTo(v.surface!);
  const csv=telemetryCsv(record).split('\n'),headers=csv[1].split(','),row=csv[2].split(',');
  expect(row[headers.indexOf('seed [kg]')]).toBe('0.125');
 });
 it('measures every water phase and temperature percentiles without counting temperature as mass',()=>{
  const data=input();data.state[F.water]=2;data.state[F.ice]=3;data.state[F.vapor]=4;data.state[F.cloud]=5;data.state[F.cloudIce]=6;data.state[F.nitrogen]=7;data.state[F.plant]=8;data.state[F.dissolved]=9;
  const p=measurePlanet(data),v=p.values;
  expect(v.waterTotal).toBe(20);expect(v.mass).toBe(84);expect(v.tempMean).toBe(15);expect(v.tempMedian).toBe(15);expect(v.tempP10).toBeCloseTo(3);expect(v.tempP90).toBeCloseTo(27);
  expect(v.terrain!+v.liquid!+v.ice!+v.gas!+v.cloud!+v.biomass!).toBeCloseTo(v.surface!);
  expect(p.histogram.reduce((sum,v)=>sum+v,0)).toBe(100);expect(v.cloudCover).toBe(25);
  expect(v.mole_nitrogen!+v.mole_vapor!).toBeCloseTo(100);
 });
 it('includes airborne and queued supply in the external mass ledger',()=>{
  const store=new TelemetryStore(),a=input();const record=store.sample('p','P',a);
  const b=input(1);b.state[F.sand]+=1;b.airborne=4;b.pending=2;b.supplied=8;b.transferredIn=2;b.removed=1;b.transferredOut=1;b.escaped=1;
  store.sample('p','P',b);const current=record.points.at(-1)!;
  expect(delta(current,record.baseline,'mass')).toBe(7);expect(massResidual(current,record.baseline)).toBe(0);
 });
 it('integrates every energy and precipitation step, retaining physical rates through zero-time edits',()=>{
  const store=new TelemetryStore(),r=store.sample('p','P',input());
  expect(r.baseline.values.rainRate).toBeNull();
  store.step('p',.25,[1,2,3,4,10,20,30,40],[2,3,0,1]);store.step('p',.25,[1,1,1,1],[1,0,1,1]);
  store.step('p',0,[0,10,0,0],[0,0,0,0]);
  store.sample('p','P',input(1));const p=r.points.at(-1)!;
  expect([0,1,2,3].map(k=>p.values['energy'+k])).toEqual([12,33,34,45]);expect(p.values.rainTotal).toBe(4);expect(p.values.snowTotal).toBe(5);expect(p.values.rainRate).toBe(8);expect(p.values.snowRate).toBe(4);
  expect(p.values.rainCover).toBe(100);expect(p.values.snowCover).toBe(50);
  expect(energyResidual(p,r.baseline)).toBe(-124);
 });
 it('keeps an immutable baseline for edits at the same simulation time and isolates planets',()=>{
  const store=new TelemetryStore(),r=store.sample('p','P',input(12)),b=input(12);b.state[F.sand]+=5;
  store.sample('p','P',b,true);store.sample('q','Q',input(100));
  expect(r.points).toHaveLength(1);expect(delta(r.points[0],r.baseline,'mass')).toBe(5);expect(store.planets.get('q')!.baseline.time).toBe(100);
  store.reset('p');expect(delta(r.points[0],r.baseline,'mass')).toBe(0);expect(r.baseline.time).toBe(12);
 });
 it('bounds history while preserving the initial and latest measurements and CSV missing values',()=>{
  const store=new TelemetryStore(8);
  for(let time=0;time<100;time++)store.sample('p','P',input(time));
  const r=store.planets.get('p')!;expect(r.points.length).toBeLessThanOrEqual(8);expect(r.points[0].time).toBe(0);expect(r.points.at(-1)!.time).toBe(99);expect(r.baseline.time).toBe(0);
  expect(store.needsSample('p',99.9)).toBe(false);expect(store.needsSample('p',100)).toBe(true);
  const csv=telemetryCsv(r);expect(csv).toContain('tempMean [°C]');expect(csv).toContain('rainRate [kg/s]');expect(csv).not.toMatch(/NaN|undefined|null/);
  expect(measurePlanet(input()).values.gasTemp).toBeNull();
 });
 it('records all background integration steps with the same cumulative energy budget',()=>{
  const grid=createSphere(0),data=input();data.state=seedPlanet(grid,'rock',18);
  const snapshot:Snapshot={...data,version:3,preset:'coast',state:[...data.state],discoveries:[],spin:{angle:0,running:false}};
  const p:PlanetRecord={id:'p',name:'P',snapshot},store=new TelemetryStore(),r=store.sample('p','P',data),sums=[0,0,0,0];let steps=0;
  new BackgroundWorlds(grid).step([p],'other',.2,(planet,solver,dt)=>{
   steps++;solver.energyChanges.forEach((v,i)=>sums[i%4]+=v);store.step(planet.id,dt,solver.energyChanges,solver.precipitatedCells);
   store.sample(planet.id,planet.name,{...data,time:planet.snapshot.time,state:solver.state,escaped:planet.snapshot.escaped??0},true);
  });
  expect(steps).toBeGreaterThan(1);expect([...r.energy]).toEqual(sums);expect(r.points.at(-1)!.time).toBeCloseTo(.2);
  const current=r.points.at(-1)!;
  expect(energyResidual(current,r.baseline)).toBeCloseTo(totalEnthalpy(new Float32Array(snapshot.state))-totalEnthalpy(data.state)-sums.reduce((s,v)=>s+v,0),5);
 });
});
