// Broad alpha18 regression probes, opt in with AUDIT_SURFACE18=1.
// The frozen alpha17 evidence remains in artifacts/audit-alpha17.
import {describe,it,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,MASS_FIELDS,totalMass,totalEnthalpy,totals,type Environment,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {ATOMIC_MASS,elementalMass,type Element} from '../src/sim/chemistry';
import {GASES} from '../src/sim/gases';
import {validSnapshot} from '../src/sim/storage';
import {WeatherClimate,validClimate} from '../src/sim/weatherClimate';
import {validOcean,movingMass} from '../src/sim/oceanDynamics';
import {validThermalRemainder} from '../src/sim/thermodynamics';
import {validInventoryAmount} from '../src/sim/physicalState';

describe.skipIf(process.env.AUDIT_SURFACE18!=='1')('surface alpha18 bounded regression audit',()=>{
 it('records bounded mixed material, temperature, and climate mode probes',()=>{
  const grid=createSphere(0),empty=new Float32Array(grid.count*COMMAND_STRIDE),reports=[];
  for(const layered of [false,true])for(const temperature of [-273.139,-260,-30,-1,0,20,300,500,1700,4000]){
   const state=new Float32Array(grid.count*STRIDE),environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:layered,body:sandboxDefinition('rock')};
   for(let i=0;i<grid.count;i++){
    const p=i*STRIDE;state[p+F.temperature]=temperature;state[p+F.rock]=8-grid.geometry[i*4+3];state[p+F.nitrogen]=.3;
    state[p+F.water]=i===0?10:.12;state[p+F.ice]=i===1?10:0;state[p+F.sand]=i===2?40:.1;state[p+F.clay]=i===3?5:0;
    state[p+F.salt]=i===4?1:0;state[p+F.soil]=.2;state[p+F.plant]=.1;state[p+F.herbivore]=i===5?.1:0;
    state[p+F.carnivore]=i===6?.1:0;state[p+F.charcoal]=i===7?1:0;state[p+F.oxygen]=.1;state[p+F.methane]=.01;
   }
   const solver=new CpuSolver(grid,state),mass0=totalMass(solver.state,solver.climate),energy0=totalEnthalpy(solver.state,solver.climate),atoms0=elementalMass(totals(solver.state,solver.climate)),lost=new Float64Array(STRIDE);
   const initiallyValid=validSnapshot({version:11,preset:'coast',time:0,state:[...solver.state],climate:solver.climate.snapshot(),environment,supplied:0,removed:0,discoveries:[]},grid.count);
   expect(initiallyValid).toBe(true);
   let boundary=0,numerical=0,numericalAbs=0,steps=0,error='';
   try{for(;steps<60;steps++){
    solver.advance(1/30,empty,environment);
    for(let k=0;k<solver.energyChanges.length;k++)if(k%4===3){numerical+=solver.energyChanges[k];numericalAbs+=Math.abs(solver.energyChanges[k]);}else boundary+=solver.energyChanges[k];
    for(let i=0;i<grid.count;i++)for(let k=0;k<GASES.length;k++)lost[GASES[k].field]+=solver.escapeCells[i*GASES.length+k];
   }}catch(e){error=String(e);console.error(e);}
   const stock=totals(solver.state,solver.climate);for(let f=0;f<STRIDE;f++)stock[f]+=lost[f];
   const atoms=elementalMass(stock),massResidual=MASS_FIELDS.reduce((sum,f)=>sum+stock[f],0)-mass0,energyResidual=totalEnthalpy(solver.state,solver.climate)-energy0-boundary-numerical;
   const atomRelative=Math.max(...Object.keys(ATOMIC_MASS).map(e=>Math.abs(atoms[e as Element]-atoms0[e as Element])/Math.max(1,atoms0[e as Element])));
   const snapshot:Snapshot={version:11,preset:'coast',time:steps/30,state:[...solver.state],climate:solver.climate.snapshot(),environment,supplied:0,removed:0,discoveries:[]};
   const actual=solver.climate.physicalSurface(solver.state),carryIssues=[],thermalIssues=[],mechanicalIssues=[];
   for(let i=0;i<grid.count;i++){
    const c=solver.climate.air.surfaceCapacity(actual,i),phase=solver.climate.air.surfacePhaseEnergy(actual,i),carry=solver.climate.air.surfaceHeatCarry[i];
    if(!validThermalRemainder(solver.state[i*STRIDE+F.temperature],c,phase,carry))thermalIssues.push({i,t:solver.state[i*STRIDE+F.temperature],c,phase,carry,effective:solver.climate.air.surfaceTemperature(actual,i)});
    if(Math.abs(solver.climate.ocean.mass[i]-movingMass(actual,i))>Math.max(1e-10,movingMass(actual,i)*1e-9))mechanicalIssues.push(i);
    for(const f of MASS_FIELDS){const index=i*STRIDE+f,v=actual[index];if(!validInventoryAmount(v)||solver.climate.air.surfaceMassCarry[index]!==0&&Math.fround(v)!==solver.state[index])carryIssues.push({i,f,v,stored:solver.state[index],carry:solver.climate.air.surfaceMassCarry[index]});}
   }
   reports.push({layered,temperature,initiallyValid,steps,error,massResidual,energyResidual,atomRelative,numerical,numericalAbs,valid:validSnapshot(snapshot,grid.count),validClimate:validClimate(snapshot.climate,grid.count),validOcean:validOcean(snapshot.climate?.ocean,grid.count),carryIssues,thermalIssues,mechanicalIssues,minT:Math.min(...solver.state.filter((_,i)=>i%STRIDE===F.temperature)),maxT:Math.max(...solver.state.filter((_,i)=>i%STRIDE===F.temperature))});
  }
  mkdirSync('artifacts/audit-alpha18',{recursive:true});writeFileSync('artifacts/audit-alpha18/surface18-mixed-probes.json',JSON.stringify(reports,null,2)+'\n');
  console.log('surface18 mixed reports',JSON.stringify(reports));
  expect(reports).toHaveLength(20);
  for(const report of reports){expect(report.error).toBe('');expect(report.steps).toBe(60);expect(report.valid).toBe(true);expect(report.validClimate).toBe(true);expect(report.validOcean).toBe(true);expect(report.carryIssues).toEqual([]);expect(report.thermalIssues).toEqual([]);expect(report.mechanicalIssues).toEqual([]);expect(Math.abs(report.massResidual)).toBeLessThan(1e-7);expect(Math.abs(report.energyResidual)).toBeLessThan(1e-4);expect(report.atomRelative).toBeLessThan(1e-9);}
 },120000);
 it('isolates cold inert aggregate-to-layered initialization admissibility',()=>{
  const grid=createSphere(0),empty=new Float32Array(grid.count*COMMAND_STRIDE),reports=[];
  const environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true,body:sandboxDefinition('rock')};
  for(const temperature of [-273.139,-273,-272,-270,-260,-200]){
   const state=new Float32Array(grid.count*STRIDE);
   for(let i=0;i<grid.count;i++){const p=i*STRIDE;state[p+F.temperature]=temperature;state[p+F.rock]=8;state[p+F.nitrogen]=.3;}
   const solver=new CpuSolver(grid,state),before=solver.state.slice(),climateBefore=solver.climate.snapshot();
   const snapshot:Snapshot={version:11,preset:'coast',time:0,state:[...state],climate:climateBefore,environment,supplied:0,removed:0,discoveries:[]};
   expect(validSnapshot(snapshot,grid.count)).toBe(true);
   const actual=new Float64Array(state),initialEnergy=totalEnthalpy(actual),preview=new WeatherClimate(grid);preview.prepareSurface(actual,environment,new Float32Array(grid.count*4));
   const initializedSurface=preview.air.surfaceTemperature(actual,0),initializedAirMin=Math.min(...preview.air.temperature),initializedAirMax=Math.max(...preview.air.temperature);
   let error='',stack='';try{solver.advance(1/30,empty,environment);}catch(e){error=String(e);stack=e instanceof Error?e.stack??'':'';expect(solver.state).toEqual(before);expect(solver.climate.snapshot()).toEqual(climateBefore);}
   reports.push({temperature,initiallyValid:true,initializedSurface,initializedAirMin,initializedAirMax,geometryScale:preview.air.geometryScale,initializeEnergyResidual:totalEnthalpy(actual,preview)-initialEnergy,error,stack,rollback:error?true:null,valid:validSnapshot({...snapshot,state:[...solver.state],climate:solver.climate.snapshot()},grid.count)});
  }
  mkdirSync('artifacts/audit-alpha18',{recursive:true});writeFileSync('artifacts/audit-alpha18/surface18-cold-activation.json',JSON.stringify(reports,null,2)+'\n');
  console.log('surface18 cold activation reports',JSON.stringify(reports));
  for(const report of reports){expect(report.error).toBe('');expect(report.valid).toBe(true);expect(report.initializedSurface).toBeGreaterThanOrEqual(-273.14);expect(report.initializedAirMin).toBeGreaterThanOrEqual(-273.14);expect(Math.abs(report.initializeEnergyResidual)).toBeLessThan(1e-7);expect(report.geometryScale).toBeGreaterThan(0);expect(report.geometryScale).toBeLessThanOrEqual(1);}
 });
});
