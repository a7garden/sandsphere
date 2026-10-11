import {describe,it,expect} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE} from '../src/sim/model';
import {depthProfile} from '../src/ui/depthProfile';

describe('observed depth spectrum',()=>{
 const grid=createSphere(0);
 it('places liquid above the same mixed solids used by the section view',()=>{
  const state=new Float32Array(grid.count*STRIDE);state[F.water]=4;state[F.sand]=2;state[F.ice]=1;
  const profile=depthProfile(state,0,grid);
  expect(profile.layers.map(l=>l.id)).toEqual(['water','solid']);
  expect(profile.layers[0].top).toBe(0);expect(profile.layers[0].bottom).toBe(4);
  expect(profile.layers[1].top).toBe(4);expect(profile.depth).toBeCloseTo(7.09);
  expect(profile.layers[1].components.map(c=>c.fraction)).toEqual([2/3,1/3]);
 });
 it('keeps retained water and its share of dissolved salt in the porous solid layer',()=>{
  const state=new Float32Array(grid.count*STRIDE);state[F.water]=2;state[F.soil]=10;state[F.dissolved]=.4;
  const layers=depthProfile(state,0,grid).layers;
  expect(layers[0].bottom).toBeCloseTo(.8);
  const mass=(layer:number,id:string)=>layers[layer].components.find(c=>c.id===id)!.mass;
  expect(mass(1,'water')).toBeCloseTo(1.2);expect(mass(1,'dissolved')).toBeCloseTo(.24);
  expect(mass(0,'dissolved')+mass(1,'dissolved')).toBeCloseTo(.4);
  layers.forEach(l=>expect(l.components.reduce((sum,c)=>sum+c.fraction,0)).toBeCloseTo(1));
 });
 it('omits bedrock from both section thickness and mixture while preserving stocks',()=>{
  const state=new Float32Array(grid.count*STRIDE);state[F.rock]=8;state[F.sand]=2;state[F.water]=3;
  const before=state.slice(),p=depthProfile(state,0,grid,true);
  expect(p.depth).toBeCloseTo(5);expect(p.layers[1].components).toEqual([{id:'sand',mass:2,fraction:1}]);expect(state).toEqual(before);
  state[F.sand]=0;state[F.water]=0;expect(depthProfile(state,0,grid,true)).toEqual({layers:[],depth:0});
 });
 it('shows only the fixed base for an empty cell and omits a nonexistent water layer',()=>{
  const state=new Float32Array(grid.count*STRIDE);
  expect(depthProfile(state,0,grid)).toEqual({layers:[],depth:0});
  state[F.sand]=3;state[F.vapor]=20;
  expect(depthProfile(state,0,grid).layers.map(l=>l.id)).toEqual(['solid']);
  expect(depthProfile(state,0,grid).depth).toBe(3);
 });
});
