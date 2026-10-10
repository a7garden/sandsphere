import {describe,it,expect} from 'vitest';
import {snapshotSurface} from '../src/sim/session';
import {F,STRIDE,COMMAND_STRIDE,totalMass,type Snapshot} from '../src/sim/model';
import {validSnapshot} from '../src/sim/storage';

describe('automatic session persistence',()=>{
  it('preserves pending and falling supply without changing the running world',()=>{
    const live=new Float32Array(STRIDE*2),pending=new Float32Array(COMMAND_STRIDE*2);
    live[F.sand]=10;live[F.water]=2;live[F.temperature]=20;live[STRIDE+F.temperature]=20;
    pending[0]=4;pending[1]=2;pending[5]=.5;
    const before=live.slice(),commands=pending.slice();
    const result=snapshotSurface(live,pending,[{index:0,material:'salt',amount:1},{index:1,material:'clay',amount:3}]);
    expect(result.pendingRemoved).toBe(9);
    expect(totalMass(result.state)).toBeCloseTo(12+6+4-9,6);
    expect(result.state[F.salt]).toBe(1);
    expect(live).toEqual(before);expect(pending).toEqual(commands);
  });
  it('reads earlier worlds and rejects a corrupt rotation state',()=>{
    const snapshot:Snapshot={version:1,preset:'coast',state:Array(STRIDE).fill(0),time:10,discoveries:[],environment:{ambient:18,sunlight:1,sun:[0,1,0]},supplied:0,removed:0};
    expect(validSnapshot(snapshot,1)).toBe(true);
    expect(validSnapshot({...snapshot,spin:{angle:.4,running:true,azimuth:153,elevation:44},savedAt:100},1)).toBe(true);
    expect(validSnapshot({...snapshot,spin:{angle:NaN,running:true,azimuth:153,elevation:44}},1)).toBe(false);
    expect(validSnapshot({...snapshot,savedAt:Infinity},1)).toBe(false);
    expect(validSnapshot({...snapshot,paused:'yes'},1)).toBe(false);
    expect(validSnapshot({...snapshot,weather:{kind:'cold',remaining:10,duration:35,ambient:18,sunlight:1,direction:[0,1,0]}},1)).toBe(true);
    expect(validSnapshot({...snapshot,weather:{kind:'cold',remaining:100,duration:35,ambient:18,sunlight:1,direction:[0,1,0]}},1)).toBe(false);
  });
});
