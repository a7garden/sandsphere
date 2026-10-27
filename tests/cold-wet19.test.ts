import {describe,it,expect} from 'vitest';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,totalMass,totalEnthalpy,type Environment,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {validSnapshot} from '../src/sim/storage';
import {MIN_THERMODYNAMIC_TEMPERATURE} from '../src/sim/thermodynamics';

const grid=createSphere(0),commands=new Float32Array(grid.count*COMMAND_STRIDE);
const environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true,body:sandboxDefinition('rock')};
function cold(field:number,temperature=-273.139){
 const state=new Float32Array(grid.count*STRIDE);
 for(let i=0;i<grid.count;i++){state[i*STRIDE+F.temperature]=temperature;state[i*STRIDE+F.rock]=8;state[i*STRIDE+F.nitrogen]=.3;}
 state[field]=.0001;return new CpuSolver(grid,state);
}
function saved(solver:CpuSolver):Snapshot{return {version:11,preset:'coast',time:0,state:[...solver.state],climate:solver.climate.snapshot(),environment,supplied:0,removed:0,discoveries:[]};}
function checkAdvance(solver:CpuSolver,parts:number){
 const mass=totalMass(solver.state,solver.climate),heat=totalEnthalpy(solver.state,solver.climate);let boundary=0,numerical=0,numericalAbs=0,escaped=0;
 for(let n=0;n<parts;n++){
  solver.advance(1/(30*parts),commands,environment);
  for(let k=0;k<solver.energyChanges.length;k++)if(k%4===3){numerical+=solver.energyChanges[k];numericalAbs+=Math.abs(solver.energyChanges[k]);}else boundary+=solver.energyChanges[k];
  for(const amount of solver.escapeCells)escaped+=amount;
 }
 expect(totalMass(solver.state,solver.climate)+escaped-mass).toBeCloseTo(0,10);
 expect(totalEnthalpy(solver.state,solver.climate)-heat-boundary-numerical).toBeCloseTo(0,7);
 expect(numericalAbs).toBeLessThan(1e-6);
 expect(Math.min(...solver.climate.air.temperature)).toBeGreaterThanOrEqual(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE));
 expect(validSnapshot(saved(solver),grid.count)).toBe(true);
}

describe('cold finite water inventories',()=>{
 it('advances the original liquid-cloud and ice-cloud cases under matched time refinement',()=>{
  for(const field of [F.cloud,F.cloudIce])for(const parts of [1,2,4,10,100,1000])checkAdvance(cold(field),parts);
 },20000);

 it('retains unaffordable liquid rather than supplying heat to force equilibrium',()=>{
  const solver=cold(F.cloud),air=solver.climate.air;
  air.initialize(solver.state,environment);
  const beforeEnergy=air.layerEnergy(0),water=air.mass[4]+air.mass[5]+air.mass[0],liquid=air.mass[4];
  (air as unknown as {phase:(q:number,i:number,k:number)=>void}).phase(0,0,0);
  expect(air.mass[4]).toBeGreaterThan(0);expect(air.mass[4]).toBeLessThan(liquid);expect(air.mass[5]).toBeGreaterThan(0);
  expect(air.mass[0]+air.mass[4]+air.mass[5]).toBeCloseTo(water,15);
  expect(air.layerEnergy(0)).toBeCloseTo(beforeEnergy,12);
  expect(air.temperature[0]).toBeGreaterThanOrEqual(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE));
  const adjusted=air.layerEnergy(0);(air as unknown as {phase:(q:number,i:number,k:number)=>void}).phase(0,0,0);
  expect(air.layerEnergy(0)).toBeCloseTo(adjusted,12);
 });

 it('continues cold water inventories identically after JSON save and restore',()=>{
  for(const field of [F.cloud,F.cloudIce]){
   const solver=cold(field);checkAdvance(solver,1);
   const snapshot=JSON.parse(JSON.stringify(saved(solver))),resumed=new CpuSolver(grid,new Float32Array(snapshot.state));resumed.climate.restore(snapshot.climate);
   for(let step=0;step<12;step++){
    solver.advance(1/30,commands,environment);resumed.advance(1/30,commands,environment);
    expect(resumed.state).toEqual(solver.state);expect(resumed.climate.snapshot()).toEqual(solver.climate.snapshot());expect(resumed.energyChanges).toEqual(solver.energyChanges);
   }
  }
 });

 it('keeps finite phase and transport budgets in ordinary wet columns',()=>{
  for(const temperature of [-20,0,22])for(const field of [F.cloud,F.cloudIce])checkAdvance(cold(field,temperature),1);
 });
});
