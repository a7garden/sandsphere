import {sandboxDefinition} from '../src/sim/planetDefinition';
import {describe,it,expect} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,totalEnthalpy,type Environment,type Snapshot} from '../src/sim/model';
import {snapshotSurface} from '../src/sim/session';
import {validSnapshot} from '../src/sim/storage';

describe('simple-mode mechanical and thermal persistence',()=>{
 it('saves pending tools and falling supply exactly like paused live steps without initializing air',()=>{
  const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE);
  for(let i=0;i<grid.count;i++){state[i*STRIDE+F.rock]=8;state[i*STRIDE+F.water]=.5;state[i*STRIDE+F.nitrogen]=.3;state[i*STRIDE+F.temperature]=20;}
  const env:Environment={ambient:20,sunlight:0,sun:[0,1,0],gravity:1,climate:false,body:sandboxDefinition('rock')};
  const live=new CpuSolver(grid,state),empty=new Float32Array(grid.count*COMMAND_STRIDE);
  live.advance(1/30,empty,env);live.climate.air.surfaceHeatCarry[0]=1e-6;
  const pending=empty.slice();pending[0]=.1;pending[4]=1e-5;pending[5]=.2;
  const before=live.state.slice(),climate=live.climate.snapshot();
  const saved=snapshotSurface(live.state,pending,[{index:1,material:'sand',amount:.25}],null,live.climate,env);
  expect(live.state).toEqual(before);expect(live.climate.snapshot()).toEqual(climate);
  const branch=new CpuSolver(grid,before);branch.climate.restore(climate);branch.advance(0,pending,env);
  const landing=empty.slice();landing[COMMAND_STRIDE+1]=.25;branch.advance(0,landing,env);
  expect(saved.state).toEqual(branch.state);expect(saved.climate).toEqual(branch.climate.snapshot());
  expect(saved.climate?.atmosphere).toBeUndefined();expect(branch.climate.air.ready).toBe(false);
  const record:Snapshot={version:11,preset:'coast',state:[...saved.state],climate:saved.climate,environment:env,time:1,supplied:0,removed:0,discoveries:[]};
  const json=JSON.parse(JSON.stringify(record));expect(validSnapshot(json,grid.count)).toBe(true);
  const resumed=new CpuSolver(grid,new Float32Array(json.state));resumed.climate.restore(json.climate);
  expect(totalEnthalpy(resumed.state,resumed.climate)).toBeCloseTo(totalEnthalpy(saved.state,saved.climate),10);
  branch.advance(1/30,empty,env);resumed.advance(1/30,empty,env);
  expect(resumed.state).toEqual(branch.state);expect(resumed.climate.snapshot()).toEqual(branch.climate.snapshot());
 });
});
