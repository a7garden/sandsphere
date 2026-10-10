import {describe,it,expect} from 'vitest';
import {chooseSave,saveScope} from '../src/account/sync';
import {encodeSave,decodeSave} from '../src/account/firebase';
import {createSphere} from '../src/sim/sphere';
import {seedWorld} from '../src/sim/model';
import {migrateWorld} from '../src/sim/system';

const grid=createSphere(0);
const system=migrateWorld({version:4,preset:'coast',time:0,state:[...seedWorld(grid)],discoveries:[],environment:{ambient:18,sunlight:1,sun:[0,1,0]},supplied:0,removed:0},grid.count);
describe('account save boundaries',()=>{
 it('keeps guest, accounts and verification in separate slots while retaining guest keys',()=>{
  expect(saveScope(null).systemResumeKey).toBe('sandsphere-system-resume');
  expect(saveScope(null).systemSlot).toBe('latest-system');
  expect(new Set([saveScope(null).systemSlot,saveScope('alice').systemSlot,saveScope('bob').systemSlot,saveScope('alice',true).systemSlot]).size).toBe(4);
 });
 it('detects divergent progress without comparing clocks on different devices',()=>{
  const local={...system,savedAt:100},remote={revision:'new',system:{...system,savedAt:1}};
  expect(chooseSave(local,remote,{revision:'old',syncedAt:99})).toBe('conflict');
  expect(chooseSave(local,remote,{revision:'old',syncedAt:100})).toBe('remote');
  expect(chooseSave(local,remote,null)).toBe('conflict');
  expect(chooseSave(local,remote,{revision:'new',syncedAt:99})).toBe('local');
  // A local edit remains dirty even when this device's clock is behind the
  // timestamp in a previously downloaded save.
  expect(chooseSave(local,remote,{revision:'new',syncedAt:1000})).toBe('local');
  expect(chooseSave(local,remote,{revision:'old',syncedAt:1000})).toBe('conflict');
  expect(chooseSave(null,remote,null)).toBe('remote');
  expect(chooseSave(local,null,{revision:'old',syncedAt:100})).toBe('conflict');
 });
 it('round trips a complete world and rejects invalid and partial saves',async()=>{
  const bytes=await (await encodeSave(system)).arrayBuffer();
  expect(await decodeSave(bytes,grid.count)).toEqual(system);
  await expect(decodeSave(await (await encodeSave({...system,planets:[]})).arrayBuffer(),grid.count)).rejects.toThrow('형식');
  await expect(decodeSave(await (await encodeSave({...system,telemetry:{version:1,planets:[],baseSavedAt:10}})).arrayBuffer(),grid.count)).rejects.toThrow('형식');
 });
});
