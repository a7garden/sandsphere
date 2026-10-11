import {describe,expect,it} from 'vitest';
import {ActualGameRate,formatPlanetDuration,formatPlanetElapsed,formatPlanetRate,realDurationForPlanetPeriod,SIMULATION_SPEEDS,speedLabel} from '../src/ui/simulationTime';

describe('planet time shown against real time',()=>{
 it('maps one stored simulation second to one planet minute without changing stored values',()=>{
  expect(formatPlanetElapsed(1)).toBe('0:01:00');
  expect(formatPlanetElapsed(120)).toBe('2:00:00');
  expect(formatPlanetDuration(240)).toBe('4시간');
  expect(formatPlanetDuration(90)).toBe('1시간 30분');
 });

 it('reports completed time rather than the requested speed and resets across pauses or planets',()=>{
  const meter=new ActualGameRate();
  expect(meter.sample(0,0,'a',true)).toBeNull();
  expect(meter.sample(3000,1.2,'a',true)).toBeCloseTo(.4);
  expect(formatPlanetRate(.4)).toBe('24초/초');
  expect(meter.sample(3200,1.2,'a',false)).toBeNull();
  expect(meter.sample(4000,1.2,'a',true)).toBeNull();
  expect(meter.sample(7000,4.2,'a',true)).toBeCloseTo(1);
  expect(meter.sample(7100,30,'b',true)).toBeNull();
 });

 it('spans close observation to time lapse with understandable rotation and orbit timing',()=>{
  expect(SIMULATION_SPEEDS.map(speedLabel)).toEqual(['1/60×','1/6×','1×','2×','10×','60×']);
  expect(SIMULATION_SPEEDS.map(speed=>realDurationForPlanetPeriod(120,speed))).toEqual(['2시간','12분','2분','1분','12초','2초']);
  expect(SIMULATION_SPEEDS.map(speed=>realDurationForPlanetPeriod(240,speed))).toEqual(['4시간','24분','4분','2분','24초','4초']);
 });

 it('averages the slowest clock across several fixed physics ticks',()=>{
  const meter=new ActualGameRate();
  expect(meter.sample(0,0,'slow',true,12)).toBeNull();
  expect(meter.sample(3000,1/30,'slow',true,12)).toBeNull();
  expect(meter.sample(12000,.2,'slow',true,12)).toBeCloseTo(1/60);
  expect(formatPlanetRate(1/60)).toBe('1.0초/초');
 });
});
