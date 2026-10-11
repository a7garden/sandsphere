import {describe,it,expect} from 'vitest';
import {CpuSolver,COMMAND_FIELD,COMMAND_STRIDE,F,STRIDE,seedPlanet,totalMass,totalEnthalpy,applyCommand,react} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
const grid=createSphere(1),environment={ambient:20,sunlight:0,sun:[1,0,0]};
describe('instant land animal mortality in the sea',()=>{
 it('converts a paused sea spawn to organic matter, conserving mass and supplied heat',()=>{
  const state=seedPlanet(grid,'rock',20,'none');state[F.water]=3;
  const solver=new CpuSolver(grid,state),mass=totalMass(state),heat=totalEnthalpy(state),commands=new Float32Array(grid.count*COMMAND_STRIDE);
  commands[COMMAND_FIELD.herbivore]=2;commands[COMMAND_FIELD.carnivore]=3;solver.advance(0,commands,environment);
  expect(solver.state[F.herbivore]).toBe(0);expect(solver.state[F.carnivore]).toBe(0);expect(solver.state[F.soil]).toBe(5);
  expect(totalMass(solver.state)-mass).toBeCloseTo(5,6);expect(totalEnthalpy(solver.state)-heat).toBeCloseTo(100,5);
 });
 it('kills existing animals on flooding while retaining soil moisture as land',()=>{
  for(const [soil,water,dies] of [[0,3,true],[10,.3,false]] as const){
   const state=seedPlanet(grid,'rock',20,'none');state[F.soil]=soil;state[F.water]=water;state[F.herbivore]=2;state[F.carnivore]=3;
   const commands=new Float32Array(grid.count*COMMAND_STRIDE);commands[COMMAND_FIELD.water]=.001;
   applyCommand(state,0,commands);
   expect(state[F.herbivore]).toBe(dies?0:2);expect(state[F.carnivore]).toBe(dies?0:3);expect(state[F.soil]).toBe(dies?5:soil);
  }
 });
 it('converts a submerged saved population before it can move or eat on the next step',()=>{
  const state=seedPlanet(grid,'rock',20,'none');state[F.water]=3;state[F.herbivore]=2;state[F.carnivore]=3;
  const mass=totalMass(state),heat=totalEnthalpy(state);react(state,0,1/30,environment,grid);
  expect(state[F.herbivore]).toBe(0);expect(state[F.carnivore]).toBe(0);expect(state[F.soil]).toBe(5);
  expect(totalMass(state)).toBeCloseTo(mass,5);expect(totalEnthalpy(state)).toBeCloseTo(heat,3);
  expect(state[STRIDE+F.soil]).toBe(0);
 });
});
