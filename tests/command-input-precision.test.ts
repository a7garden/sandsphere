import {describe,it,expect} from 'vitest';
import {createCommandBatch,deliverSurfaceSupply} from '../src/sim/supply';
import {CpuSolver,F,STRIDE,COMMAND_FIELD,COMMAND_STRIDE,emptyStock,totalMass,totalEnthalpy,type Environment} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {materialSupply} from '../src/sim/system';
import {snapshotSurface} from '../src/sim/session';

const e:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:false};
function world(){const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++)state[i*STRIDE+F.temperature]=20;return {grid,solver:new CpuSolver(grid,state)};}

describe('finite queued tool inputs',()=>{
 it('retains 250,000 small inventory transfers beside larger pending supplies and captures them exactly',()=>{
  const {grid,solver}=world(),stock=emptyStock(),source=30000;stock.glass=source;
  const before=totalMass(solver.state,solver.climate),energy=totalEnthalpy(solver.state,solver.climate);let external=0;
  for(let batch=0;batch<25;batch++){
   const commands=createCommandBatch(grid.count);
   const supply=(requested:number)=>{const {amount}=materialSupply('campaign','glass',stock,requested);stock.glass-=amount;deliverSurfaceSupply([{index:0,weight:1}],amount,(cell,mass)=>{commands[cell*COMMAND_STRIDE+COMMAND_FIELD.glass]+=mass;});};
   supply(1000);for(let n=0;n<10000;n++)supply(.00001);
   const captured=snapshotSurface(solver.state,commands,[],null,solver.climate,e);
   solver.advance(0,commands,e);external+=solver.energyChanges.reduce((sum,value)=>sum+value,0);
   expect(captured.state).toEqual(solver.state);expect(captured.climate).toEqual(solver.climate.snapshot());
  }
  const supplied=source-stock.glass,received=totalMass(solver.state,solver.climate)-before;
  expect(received).toBeCloseTo(25002.5,6);expect(received-supplied).toBeCloseTo(0,6);
  expect(Math.abs(totalEnthalpy(solver.state,solver.climate)-energy-external)/Math.max(1,Math.abs(totalEnthalpy(solver.state,solver.climate)))).toBeLessThan(2e-7);
 });

 it('retains low bits from falling deposits when a save settles many arrivals together',()=>{
  const {grid,solver}=world(),pending=createCommandBatch(grid.count),falling=[{index:0,material:'glass' as const,amount:1000},...Array.from({length:10000},()=>({index:0,material:'glass' as const,amount:.00001}))];
  const saved=snapshotSurface(solver.state,pending,falling,null,solver.climate,e);
  expect(totalMass(saved.state,saved.climate)).toBeCloseTo(1000.1,8);
  const live=createCommandBatch(grid.count);for(const grain of falling)live[COMMAND_FIELD.glass]+=grain.amount;
  solver.advance(0,live,e);expect(saved.state).toEqual(solver.state);expect(saved.climate).toEqual(solver.climate.snapshot());
 });
});
