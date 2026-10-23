import {describe,it,expect} from 'vitest';
import {latestResume} from '../src/sim/browserStorage';

interface Save {savedAt:number;state:string;}
const valid=(value:unknown):value is Save=>!!value&&typeof value==='object'&&Number.isFinite((value as Save).savedAt)&&typeof (value as Save).state==='string';
describe('legacy browser resume selection',()=>{
 it('opens a legacy localStorage checkpoint, including the zero timestamp, without a disk save',()=>{
  const legacy={savedAt:0,state:'old browser world'};
  expect(latestResume(undefined,legacy,valid)).toBe(legacy);
 });
 it('keeps the newest valid source and gives a committed disk save precedence on a tie',()=>{
  const disk={savedAt:10,state:'committed'},legacy={savedAt:11,state:'resume'};
  expect(latestResume(disk,legacy,valid)).toBe(legacy);
  expect(latestResume({...disk,savedAt:12},legacy,valid)?.state).toBe('committed');
  expect(latestResume(disk,{...legacy,savedAt:10},valid)).toBe(disk);
 });
 it('does not let an invalid source replace a valid checkpoint',()=>{
  const disk={savedAt:10,state:'committed'},legacy={savedAt:11,state:'resume'};
  expect(latestResume(disk,{savedAt:100},valid)).toBe(disk);
  expect(latestResume({savedAt:100},legacy,valid)).toBe(legacy);
  expect(latestResume(null,{savedAt:100},valid)).toBeNull();
 });
});
