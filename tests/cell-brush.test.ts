import {describe,it,expect} from 'vitest';
import {createSphere,cellBrushWeights,INVALID,NEIGHBORS} from '../src/sim/sphere';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {advanceFalling,physicalContact,type FallingGrain} from '../src/sim/falling';
import {seedWorld,DEFAULT_ENVIRONMENT} from '../src/sim/model';

describe('cell-sized brushes',()=>{
 const grid=createSphere(4);
 it('starts at exactly one cell and grows by complete neighbor rings',()=>{
  const hex=Array.from({length:grid.count},(_,i)=>i).find(i=>grid.neighbors[i*6+5]!==INVALID)!;
  expect(cellBrushWeights(grid,hex,0)).toEqual([{index:hex,weight:1}]);
  const first=cellBrushWeights(grid,hex,1),second=cellBrushWeights(grid,hex,2);
  expect(first).toHaveLength(7);expect(second.length).toBeGreaterThan(first.length);
  const expected=new Set(first.map(c=>c.index));
  for(const {index} of first)for(let k=0;k<NEIGHBORS;k++){const neighbor=grid.neighbors[index*6+k];if(neighbor!==INVALID)expected.add(neighbor);}
  expect(new Set(second.map(c=>c.index))).toEqual(expected);
 });
 it('handles pentagons, wraparound, and conservative uniform delivery',()=>{
  expect(cellBrushWeights(grid,0,1)).toHaveLength(6);
  for(const center of [0,100,grid.count-1])for(let rings=0;rings<=5;rings++){
   const cells=cellBrushWeights(grid,center,rings);
   expect(new Set(cells.map(c=>c.index)).size).toBe(cells.length);
   expect(cells.reduce((sum,c)=>sum+c.weight,0)).toBeCloseTo(1,12);
   expect(cells.every(c=>c.weight===cells[0].weight)).toBe(true);
  }
 });
 it('drops each selected share into its own cell under radial gravity',()=>{
  const state=seedWorld(grid),cells=cellBrushWeights(grid,100,2),landed=new Map<number,number>();
  const grains:FallingGrain[]=cells.map(({index,weight})=>{
   const direction=Vector3.FromArray(grid.directions,index*3);
   return {index,position:direction.scale(physicalContact(state,index,grid)+.55),velocity:direction.scale(-.7),material:'sand',amount:weight*4,size:.021,age:0,spin:0,land:(i,mass)=>landed.set(i,(landed.get(i)??0)+mass)};
  });
  for(let n=0;n<100&&grains.length;n++)advanceFalling(grains,grid,state,.05,DEFAULT_ENVIRONMENT);
  expect(grains).toHaveLength(0);expect(new Set(landed.keys())).toEqual(new Set(cells.map(c=>c.index)));
  expect([...landed.values()].reduce((a,b)=>a+b,0)).toBeCloseTo(4,10);
 });
});
