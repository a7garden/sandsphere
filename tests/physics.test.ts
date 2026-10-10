import { describe,it,expect } from 'vitest';
import { CpuSolver,COMMAND_STRIDE,F,STRIDE,react,totalMass,totals,freezingPoint } from '../src/sim/model';
import { createSphere,INVALID,NEIGHBORS,brushWeights } from '../src/sim/sphere';

const calm={ambient:20,sunlight:0,sun:[0,1,0]};
function empty(subdivisions=1) {
  const grid=createSphere(subdivisions),state=new Float32Array(grid.count*STRIDE);
  for(let i=0;i<grid.count;i++)state[i*STRIDE+F.temperature]=20;
  return {grid,state,commands:new Float32Array(grid.count*COMMAND_STRIDE)};
}

describe('spherical transport',()=>{
  it('closes every edge without a pole or seam and normalizes brush delivery',()=>{
    const grid=createSphere(3);
    for(let i=0;i<grid.count;i++) for(let k=0;k<NEIGHBORS;k++){
      const j=grid.neighbors[i*NEIGHBORS+k];if(j===INVALID)continue;
      expect([...grid.neighbors.slice(j*NEIGHBORS,j*NEIGHBORS+NEIGHBORS)]).toContain(i);
    }
    expect(brushWeights(grid,[0,1,0],0.1).reduce((s,v)=>s+v.weight,0)).toBeCloseTo(1,10);
    expect(brushWeights(grid,[0,1,0],0.0001).length).toBeGreaterThan(0);
  });
  it('conserves water across transport, ice and vapor and salt across dissolution',()=>{
    const {grid,state,commands}=empty(2);
    state[F.water]=30;state[F.sand]=70;state[F.salt]=4;
    state[STRIDE+F.water]=10;state[STRIDE+F.temperature]=-12;
    const before=totals(state),solver=new CpuSolver(grid,state);
    for(let n=0;n<500;n++)solver.advance(0.05,commands,calm);
    const after=totals(solver.state);
    expect(after[F.water]+after[F.ice]+after[F.vapor]+after[F.cloud]+after[F.cloudIce]).toBeCloseTo(before[F.water],3);
    expect(after[F.salt]+after[F.dissolved]).toBeCloseTo(4,4);
    expect(totalMass(solver.state)).toBeCloseTo(totalMass(state),3);
    for(let i=0;i<solver.state.length;i++)expect(Number.isFinite(solver.state[i])).toBe(true);
    for(const field of [F.sand,F.water,F.ice,F.salt,F.dissolved,F.vapor,F.cloud,F.cloudIce])
      for(let p=0;p<solver.state.length;p+=STRIDE)expect(solver.state[p+field]).toBeGreaterThanOrEqual(0);
  });
  it('moves water downhill while maintaining nonnegative amounts',()=>{
    const {grid,state,commands}=empty();
    state[F.water]=100;
    const solver=new CpuSolver(grid,state);solver.advance(0.1,commands,calm);
    expect(solver.state[F.water]).toBeLessThan(100);
    const t=totals(solver.state);expect(t[F.water]+t[F.ice]+t[F.vapor]+t[F.cloud]+t[F.cloudIce]).toBeCloseTo(100,4);
  });
});
describe('scientific constraints',()=>{
  it('freezes fresh water while equally cold marine brine remains liquid',()=>{
    const {grid,state}=empty();
    const cold={ambient:-1,sunlight:0,sun:[0,1,0]};
    state[F.water]=5;state[F.temperature]=-1;
    state[STRIDE+F.water]=5;state[STRIDE+F.dissolved]=5*0.035/0.965;state[STRIDE+F.temperature]=-1;
    react(state,0,0.1,cold,grid);react(state,1,0.1,cold,grid);
    expect(state[F.ice]).toBeGreaterThan(0);expect(state[STRIDE+F.ice]).toBe(0);
    expect(freezingPoint(5,5*0.035/0.965)).toBeCloseTo(-1.89,2);
  });
  it('evaporates below boiling and spends sensible heat on that transition',()=>{
    const {grid,state}=empty();state[F.water]=10;state[F.temperature]=40;
    const before=totalMass(state);react(state,0,0.1,{...calm,ambient:40},grid);
    expect(state[F.vapor]).toBeGreaterThan(0);expect(state[F.temperature]).toBeLessThan(40);
    expect(totalMass(state)).toBeCloseTo(before,5);
  });
  it('recovers existing salt when the liquid vanishes, never creates salt from fresh water',()=>{
    const {grid,state}=empty();state[F.dissolved]=2;
    react(state,0,0.1,calm,grid);
    expect(state[F.salt]).toBeCloseTo(2,6);expect(state[F.dissolved]).toBe(0);
    react(state,1,0.1,calm,grid);
    expect(state[STRIDE+F.salt]+state[STRIDE+F.dissolved]).toBe(0);
  });
  it('requires accumulated hot, dry exposure to fire clay and does not undo firing with water',()=>{
    const {grid,state}=empty();state[F.clay]=5;state[F.temperature]=900;
    const hot={ambient:900,sunlight:0,sun:[0,1,0]};
    for(let n=0;n<299;n++)react(state,0,0.1,hot,grid);
    expect(state[F.ceramic]).toBe(0);
    react(state,0,0.11,hot,grid);
    expect(state[F.ceramic]).toBeCloseTo(5,5);expect(state[F.clay]).toBe(0);
    state[F.water]=10;state[F.temperature]=20;
    react(state,0,1,calm,grid);expect(state[F.ceramic]).toBeCloseTo(5,5);expect(state[F.clay]).toBe(0);
  });
});
