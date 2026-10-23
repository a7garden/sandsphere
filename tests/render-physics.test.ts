import {WeatherClimate} from '../src/sim/weatherClimate';
import {describe,it,expect,vi} from 'vitest';
import {createSphere,nearestCell,NEIGHBORS,INVALID} from '../src/sim/sphere';
import {shorelineDepths} from '../src/render/surface';
import {GpuSolver} from '../src/sim/gpu';
import {CpuSolver,COMMAND_STRIDE,F,STRIDE,totalMass} from '../src/sim/model';

describe('surface contact and coast reconstruction',()=>{
 it('locates actual particle contacts even after crossing several cells',()=>{
  const grid=createSphere(3);
  for(let i=0;i<grid.count;i+=7){
   const x=grid.directions[i*3]+.007,y=grid.directions[i*3+1]-.004,z=grid.directions[i*3+2]+.003;
   let expected=0,score=-Infinity;
   for(let j=0;j<grid.count;j++){
    const dot=x*grid.directions[j*3]+y*grid.directions[j*3+1]+z*grid.directions[j*3+2];
    if(dot>score){expected=j;score=dot;}
   }
   expect(nearestCell(grid,x,y,z,(i+grid.count/2|0)%grid.count)).toBe(expected);
  }
 });
 it('puts the shoreline between the lake head and higher dry land without inventing stock',()=>{
  const grid=createSphere(1),heights=new Float32Array(grid.count).fill(12),water=new Float32Array(grid.count);
  heights[0]=8;water[0]=2;
  const original=water.slice(),depth=shorelineDepths(grid,heights,water);
  expect(depth[0]).toBe(2);
  for(let k=0;k<NEIGHBORS;k++){
   const j=grid.neighbors[k];if(j!==INVALID)expect(depth[j]).toBe(-2);
  }
  expect(water).toEqual(original);
  expect([...depth].every(Number.isFinite)).toBe(true);
 });
 it('does not turn a dry basin or empty planet into visual water',()=>{
  const grid=createSphere(1),heights=new Float32Array(grid.count),water=new Float32Array(grid.count);
  expect([...shorelineDepths(grid,heights,water)].every(d=>d<0)).toBe(true);
  water[0]=1;heights[0]=10;
  const d=shorelineDepths(grid,heights,water);
  for(let i=1;i<grid.count;i++)expect(d[i]).toBeLessThan(.035);
 });
});

describe('GPU compatibility probe',()=>{
 it('uses the accurate CPU fallback without allocating an unused WebGPU device',async()=>{
  const requestAdapter=vi.fn(()=>{throw new Error('must not allocate');});
  vi.stubGlobal('navigator',{gpu:{requestAdapter}});
  try{
   const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE);
   expect(await GpuSolver.create(grid,state)).toBeNull();expect(requestAdapter).not.toHaveBeenCalled();
  }finally{vi.unstubAllGlobals();}
 });
});
