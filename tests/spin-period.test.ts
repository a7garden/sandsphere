import {describe,it,expect} from 'vitest';
import {orbitalPeriod} from '../src/sim/orbit';
import {spinPeriodSelection,validSpinSpeed} from '../src/ui/spinPeriod';

describe('synchronous rotation marker',()=>{
 it('accepts zero speed and preserves the supported finite period range',()=>{
  for(const speed of [0,.3,1.5,18])expect(validSpinSpeed(speed)).toBe(true);
  for(const speed of [NaN,-1,.2,18.1])expect(validSpinSpeed(speed)).toBe(false);
 });
 it('uses the exact orbital period when the rounded slider marker is selected',()=>{
  for(const distance of [.65,1,1.35,2.4]){
   const period=orbitalPeriod(distance);
   expect(spinPeriodSelection(Math.round(period),period)).toEqual({locked:true,period});
  }
 });
 it('lets keyboard and numeric edits leave the marker by one second',()=>{
  expect(spinPeriodSelection(241,240)).toEqual({locked:false,period:241});
  expect(spinPeriodSelection(239,240)).toEqual({locked:false,period:239});
 });
 it('snaps pointer drags near the marker without changing other periods',()=>{
  expect(spinPeriodSelection(250,240,12)).toEqual({locked:true,period:240});
  expect(spinPeriodSelection(260,240,12)).toEqual({locked:false,period:260});
 });
});
