import {describe,it,expect} from 'vitest';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {advanceFalling,physicalContact,type FallingGrain} from '../src/sim/falling';
import {createSphere} from '../src/sim/sphere';
import {DEFAULT_ENVIRONMENT,seedPlanet} from '../src/sim/model';
import {PHYSICS_DT} from '../src/sim/clock';

describe('batched falling grains',()=>{
 const grid=createSphere(1),state=seedPlanet(grid,'sand',22),direction=Vector3.FromArray(grid.directions,0).normalize(),floor=physicalContact(state,0,grid);
 const grain=(amount:number,radius:number,land:FallingGrain['land']):FallingGrain=>({position:direction.scale(radius),velocity:Vector3.Zero(),index:0,material:'sand',amount,size:.021,age:0,spin:1,land});

 it('preserves survivor and landing order when thousands of grains land together',()=>{
  const landed:number[]=[],grains=Array.from({length:5000},(_,i)=>grain(i+1,floor+(i%3===0?1:0),(_cell,mass)=>landed.push(mass)));
  const survivors=grains.filter((_g,i)=>i%3===0),initial=grains.reduce((sum,g)=>sum+g.amount,0);
  expect(advanceFalling(grains,grid,state,PHYSICS_DT,DEFAULT_ENVIRONMENT)).toBe(0);
  expect(grains).toEqual(survivors);
  expect(landed).toEqual(Array.from({length:5000},(_,i)=>i+1).filter((_mass,i)=>i%3!==0).reverse());
  expect(landed.reduce((a,b)=>a+b,0)+grains.reduce((sum,g)=>sum+g.amount,0)).toBe(initial);
 });

 it('accounts for escaping mass and lands bouncing water only once',()=>{
  const landed:number[]=[],land=(_cell:number,mass:number)=>landed.push(mass);
  const water={...grain(3,floor,land),material:'water' as const};
  const flying=grain(5,floor+1,land),escaping=grain(7,20,land);escaping.velocity=direction.scale(20);
  const grains=[flying,water,escaping];
  expect(advanceFalling(grains,grid,state,PHYSICS_DT,DEFAULT_ENVIRONMENT)).toBe(7);
  expect(grains).toEqual([flying,water]);expect(landed).toEqual([3]);expect(water.amount).toBe(0);
  for(let step=0;step<120;step++)advanceFalling(grains,grid,state,PHYSICS_DT,DEFAULT_ENVIRONMENT);
  expect(grains).toHaveLength(0);expect(landed).toEqual([3,5]);
 });

 it('leaves paused grains untouched',()=>{
  const g=grain(2,floor,()=>{throw new Error('Paused grain landed');}),grains=[g],position=g.position.clone();
  expect(advanceFalling(grains,grid,state,0,DEFAULT_ENVIRONMENT)).toBe(0);
  expect(grains).toEqual([g]);expect(g.position).toEqual(position);expect(g.age).toBe(0);
 });
});
