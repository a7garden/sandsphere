import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,MASS_FIELDS,totalMass,totalEnthalpy,totals,enthalpy,type Environment,type Snapshot} from '../src/sim/model';
import {BIO_REACTIONS,COMBUSTION_REACTIONS,PYROLYSIS_REACTIONS} from '../src/sim/ecology';
import {reactInventory} from '../src/sim/materialReaction';
import {ATOMIC_MASS,elementalMass,type Element} from '../src/sim/chemistry';
import {OceanDynamics,validOcean} from '../src/sim/oceanDynamics';
import {createSphere} from '../src/sim/sphere';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {validSnapshot} from '../src/sim/storage';
import {GASES} from '../src/sim/gases';
import {AIR_SPECIES,AIR_FIELDS} from '../src/sim/layeredAtmosphere';
import {SPECIFIC_HEAT,MIN_THERMODYNAMIC_TEMPERATURE} from '../src/sim/thermodynamics';
import {waterStateAtTemperature} from '../src/sim/phaseEquilibrium';
import {statisticalCloud} from '../src/sim/climatePhysics';

// This audit intentionally changes no production code or previous tolerances.
// Run: REAUDIT19_SURFACE=1 npx vitest run tests/reaudit19-surface.test.ts --maxWorkers=1 --disableConsoleIntercept
const directory=`artifacts/reaudit19/reruns/${Date.now()}-${process.pid}/surface`;
const sourceFiles=['src/sim/model.ts','src/sim/materialReaction.ts','src/sim/ecology.ts','src/sim/materialPhysics.ts','src/sim/waterPhysics.ts','src/sim/oceanDynamics.ts','src/sim/solidMechanics.ts','src/sim/thermodynamics.ts','src/sim/weatherClimate.ts','src/sim/layeredAtmosphere.ts','src/sim/mechanicalBoundary.ts','src/sim/animalNavigation.ts','src/sim/physicalState.ts','src/sim/phaseEquilibrium.ts','src/sim/climatePhysics.ts','src/sim/buoyancy.ts'];
const hashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
const write=(name:string,value:unknown)=>{mkdirSync(directory,{recursive:true});writeFileSync(`${directory}/${name}.json`,JSON.stringify(value,null,2)+'\n');};
const grid=createSphere(0),empty=new Float32Array(grid.count*COMMAND_STRIDE);
const environment=(layered:boolean):Environment=>({ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:layered,body:sandboxDefinition('rock')});
const snapshot=(solver:CpuSolver,e:Environment):Snapshot=>({version:11,preset:'coast',time:0,state:[...solver.state],climate:solver.climate.snapshot(),environment:e,supplied:0,removed:0,discoveries:[]});
const numerical=(ledger:Float32Array)=>ledger.reduce((sum,value,index)=>sum+(index%4===3?value:0),0);

describe.skipIf(process.env.REAUDIT19_SURFACE!=='1')('independent alpha18 surface reaudit19',()=>{
 it('checks all registered finite reaction routes, including incomplete oxidation and pyrolysis',()=>{
  const start=hashes(),rules=[...Object.entries(BIO_REACTIONS).map(([name,reaction])=>({name,reaction})),...COMBUSTION_REACTIONS.flatMap(def=>[['complete',def.reaction],['incomplete',def.incomplete],['smoky',def.smoky]].flatMap(([route,reaction])=>reaction?[{name:`${def.field}-${route}`,reaction:reaction as typeof def.reaction}]:[])),...PYROLYSIS_REACTIONS.map(def=>({name:`${def.field}-pyrolysis`,reaction:def.reaction}))],reports=[];
  for(const {name,reaction} of rules){
   const s=new Float64Array(STRIDE);for(const [field,coefficient] of reaction.consumed)s[field]=coefficient*2;
   const before=s.slice(),atoms=elementalMass(s),extent=reactInventory(s,0,reaction,1e6),after=elementalMass(s),noResource=reactInventory(s,0,reaction,1e6),massResidual=totalMass(s)-totalMass(before),elementResidual=Math.max(...Object.keys(ATOMIC_MASS).map(key=>Math.abs(after[key as Element]-atoms[key as Element])));
   const emptyStock=new Float64Array(STRIDE),emptyBefore=emptyStock.slice();expect(reactInventory(emptyStock,0,reaction,1)).toBe(0);expect(emptyStock).toEqual(emptyBefore);
   reports.push({name,extent,noResource,massResidual,elementResidual,stocks:[...s]});
   expect(extent,name).toBeCloseTo(2,13);expect(noResource,name).toBe(0);expect(s.every(value=>value>=0),name).toBe(true);expect(Math.abs(massResidual),name).toBeLessThan(1e-12);expect(elementResidual,name).toBeLessThan(1e-12);
  }
  write('finite-routes',{start,end:hashes(),reports});expect(hashes()).toEqual(start);
 });

 it('checks actual solver stocks across asymmetric material and heat conditions',()=>{
  const start=hashes(),reports=[];let seed=7919;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const fields=[F.sand,F.clay,F.ceramic,F.glass,F.water,F.ice,F.salt,F.dissolved,F.vapor,F.molten,F.rock,F.nitrogen,F.methane,F.carbonDioxide,F.cloud,F.cloudIce,F.soil,F.plant,F.herbivore,F.carnivore,F.iron,F.seed,F.carbonDioxideIce,F.surfaceDust,F.airborneDust,F.oxygen,F.charcoal,F.carbonMonoxide,F.soot];
  for(const layered of [false,true])for(const temperature of [-273.139,-260,-20,0,22,500,1800,5000])for(const scale of [.001,1000]){
   const s=new Float32Array(grid.count*STRIDE),e=environment(layered);
   for(let cell=0;cell<grid.count;cell++){
    const p=cell*STRIDE;s[p+F.temperature]=temperature;
    for(const field of fields)s[p+field]=random()<.35?0:scale*10**(-5+random()*5);
    s[p+F.rock]+=8;s[p+F.nitrogen]+=.3;
   }
   const solver=new CpuSolver(grid,s),before=totals(solver.state,solver.climate),mass0=totalMass(solver.state,solver.climate),energy0=totalEnthalpy(solver.state,solver.climate),lost=new Float64Array(STRIDE);
   const validBefore=validSnapshot(snapshot(solver,e),grid.count);let error='',stack='',boundary=0,numeric=0,numericAbs=0,steps=0;
   try{for(;steps<8;steps++){
    solver.advance(1/30,empty,e);
    for(let k=0;k<solver.energyChanges.length;k++)if(k%4===3){numeric+=solver.energyChanges[k];numericAbs+=Math.abs(solver.energyChanges[k]);}else boundary+=solver.energyChanges[k];
    for(let cell=0;cell<grid.count;cell++)for(let k=0;k<GASES.length;k++)lost[GASES[k].field]+=solver.escapeCells[cell*GASES.length+k];
   }}catch(caught){error=String(caught);stack=caught instanceof Error?caught.stack??'':'';}
   const after=totals(solver.state,solver.climate),delta=new Float64Array(STRIDE);for(const field of MASS_FIELDS){after[field]+=lost[field];delta[field]=after[field]-before[field];}
   const atoms=elementalMass(before),deltaAtoms=elementalMass(delta),elementRelative=Math.max(...Object.keys(ATOMIC_MASS).map(key=>Math.abs(deltaAtoms[key as Element])/Math.max(1,atoms[key as Element]))),massResidual=MASS_FIELDS.reduce((sum,field)=>sum+delta[field],0),energyResidual=totalEnthalpy(solver.state,solver.climate)-energy0-boundary-numeric;
   reports.push({layered,temperature,scale,steps,validBefore,validAfter:validSnapshot(snapshot(solver,e),grid.count),error,stack,mass0,energy0,massResidual,elementRelative,energyResidual,energyRelative:energyResidual/Math.max(1,Math.abs(energy0)),boundary,numeric,numericAbs,minimumTemperature:Math.min(...solver.state.filter((_,index)=>index%STRIDE===F.temperature))});
  }
  write('asymmetric-solver-matrix',{seed:7919,start,end:hashes(),reports});
  console.log('surface asymmetric audit',JSON.stringify(reports));
  expect(hashes()).toEqual(start);for(const report of reports){expect(report.validBefore,JSON.stringify(report)).toBe(true);expect(report.error,JSON.stringify(report)).toBe('');expect(report.validAfter,JSON.stringify(report)).toBe(true);expect(Math.abs(report.massResidual)/Math.max(1,report.mass0),JSON.stringify(report)).toBeLessThan(1e-10);expect(report.elementRelative,JSON.stringify(report)).toBeLessThan(1e-9);expect(Math.abs(report.energyResidual),JSON.stringify(report)).toBeLessThan(1e-4);}
 },120000);

 it('reduces cold surface activation failures to a single supplied material',()=>{
  const start=hashes(),reports=[];
  for(const temperature of [-273.139,-260,22,5000])for(const field of [F.water,F.ice,F.vapor,F.cloud,F.cloudIce,F.soil])for(const amount of [.0001,.1,10])for(const uniform of [false,true]){
   const s=new Float32Array(grid.count*STRIDE),e=environment(true);
   for(let cell=0;cell<grid.count;cell++){const p=cell*STRIDE;s[p+F.temperature]=temperature;s[p+F.rock]=8;s[p+F.nitrogen]=.3;if(uniform||cell===0)s[p+field]=amount;}
   const solver=new CpuSolver(grid,s),initial=snapshot(solver,e),initialClimate=solver.climate.snapshot(),validBefore=validSnapshot(initial,grid.count);let error='',stack='';
   try{solver.advance(1/30,empty,e);}catch(caught){error=String(caught);stack=caught instanceof Error?caught.stack??'':'';}
   const report={temperature,field,amount,uniform,validBefore,error,stack,rollbackExact:error?JSON.stringify(solver.state)===JSON.stringify(s)&&JSON.stringify(solver.climate.snapshot())===JSON.stringify(initialClimate):null};reports.push(report);
   if(error)write(`minimal-${temperature}-${field}-${amount}-${uniform}`,{source:hashes(),initial,report});
  }
  write('minimal-material-scan',{start,end:hashes(),reports});console.log('minimal surface failures',JSON.stringify(reports.filter(report=>report.error)));
  expect(hashes()).toEqual(start);expect(reports.filter(report=>!report.validBefore)).toEqual([]);expect(reports.filter(report=>report.error)).toEqual([]);
 },120000);

 it('records the same minimal cold states under matched time refinement',()=>{
  const start=hashes(),reports=[];
  for(const field of [F.vapor,F.cloud,F.cloudIce])for(const parts of [1,2,4,10,100,1000]){
   const s=new Float32Array(grid.count*STRIDE),e=environment(true);for(let cell=0;cell<grid.count;cell++){s[cell*STRIDE+F.temperature]=-273.139;s[cell*STRIDE+F.rock]=8;s[cell*STRIDE+F.nitrogen]=.3;}s[field]=.0001;
   const solver=new CpuSolver(grid,s),before=snapshot(solver,e);let steps=0,error='',stack='';
   try{for(;steps<parts;steps++)solver.advance(1/(30*parts),empty,e);}catch(caught){error=String(caught);stack=caught instanceof Error?caught.stack??'':'';}
   reports.push({field,parts,dt:1/(30*parts),completedTime:steps/(30*parts),steps,error,stack,validBefore:validSnapshot(before,grid.count),validAfter:validSnapshot(snapshot(solver,e),grid.count),geometryScale:solver.climate.air.geometryScale});
  }
  write('cold-refinement',{start,end:hashes(),reports});console.log('cold matched refinement',JSON.stringify(reports));expect(hashes()).toEqual(start);expect(reports.filter(report=>report.error)).toEqual([]);
 },120000);

 it('captures the rejected local inventories without changing their production operations',()=>{
  const start=hashes(),reports=[];
  for(const field of [F.vapor,F.cloud]){
   const s=new Float32Array(grid.count*STRIDE),e=environment(true);for(let cell=0;cell<grid.count;cell++){s[cell*STRIDE+F.temperature]=-273.139;s[cell*STRIDE+F.rock]=8;s[cell*STRIDE+F.nitrogen]=.3;}s[field]=.0001;
   const solver=new CpuSolver(grid,s),air=solver.climate.air,internals=air as unknown as {gravity:number;dynamics:(dt:number,e:Environment)=>void;out:Float64Array;phase:(q:number,i:number,k:number,condensed?:Float32Array)=>void;dry:(q:number)=>{mass:number;moles:number};speed2:(q:number)=>number;};let detail:unknown;
   if(field===F.vapor){const original=internals.dynamics.bind(air);internals.dynamics=(dt,e)=>{try{original(dt,e);}catch(error){detail={dt,maxOutgoingFraction:Math.max(...internals.out),limit:.45,geometryScale:air.geometryScale,maxUpdraft:Math.max(...air.updraft),minimumAirTemperature:Math.min(...air.temperature),maximumAirTemperature:Math.max(...air.temperature)};throw error;}};}
   else {const original=internals.phase.bind(air);internals.phase=(q,i,k,condensed)=>{try{original(q,i,k,condensed);}catch(error){const a=q*AIR_SPECIES,water=air.mass[a]+air.mass[a+4]+air.mass[a+5],dry=internals.dry(q),dryCapacity=air.layerCapacity(q)-[0,4,5].reduce((sum,f)=>sum+air.mass[a+f]*SPECIFIC_HEAT[AIR_FIELDS[f]],0),potential=air.layerMass(q)*(9.81*internals.gravity*air.height(k)+internals.speed2(q)*.5)/1000,target=air.layerEnergy(q),minimum=waterStateAtTemperature(dryCapacity,dry.moles,water,air.pressure(i,k),potential,Math.fround(MIN_THERMODYNAMIC_TEMPERATURE),true,(total,sat)=>statisticalCloud(total,sat).condensate);detail={q,i,k,temperature:air.temperature[q],dryCapacity,water,vapor:air.mass[a],liquid:air.mass[a+4],ice:air.mass[a+5],target,minimumEquilibriumEnergy:minimum.energy,shortfall:minimum.energy-target,geometryScale:air.geometryScale};throw error;}};}
   let error='';try{solver.advance(1/30,empty,e);}catch(caught){error=String(caught);}reports.push({field,error,detail});expect(error).not.toBe('');
  }
  write('local-rejection-details',{start,end:hashes(),reports});expect(hashes()).toEqual(start);
 });

 it('keeps ordinary mixed material stocks, energy and JSON restarts over 600 steps',()=>{
  const start=hashes(),reports=[];
  for(const layered of [false,true]){
   const s=new Float32Array(grid.count*STRIDE),e={...environment(layered),sunlight:1};
   for(let cell=0;cell<grid.count;cell++){const p=cell*STRIDE;s[p+F.temperature]=22;s[p+F.rock]=8;s[p+F.nitrogen]=.3;s[p+F.water]=.03;s[p+F.soil]=.2;s[p+F.plant]=.1;s[p+F.herbivore]=.01;s[p+F.carnivore]=.005;s[p+F.carbonDioxide]=.02;s[p+F.oxygen]=.1;s[p+F.methane]=.0001;}
   const solver=new CpuSolver(grid,s),mass0=totalMass(solver.state,solver.climate),energy0=totalEnthalpy(solver.state,solver.climate),before=totals(solver.state,solver.climate),lost=new Float64Array(STRIDE);let resumed:CpuSolver|undefined,boundary=0,numeric=0,numericAbs=0,restarts=0,restartExact=true;
   for(let step=0;step<600;step++){
    solver.advance(1/30,empty,e);if(resumed){resumed.advance(1/30,empty,e);restartExact&&=JSON.stringify(resumed.state)===JSON.stringify(solver.state)&&JSON.stringify(resumed.climate.snapshot())===JSON.stringify(solver.climate.snapshot());}
    for(let k=0;k<solver.energyChanges.length;k++)if(k%4===3){numeric+=solver.energyChanges[k];numericAbs+=Math.abs(solver.energyChanges[k]);}else boundary+=solver.energyChanges[k];
    for(let cell=0;cell<grid.count;cell++)for(let k=0;k<GASES.length;k++)lost[GASES[k].field]+=solver.escapeCells[cell*GASES.length+k];
    if((step+1)%150===0){const saved=JSON.parse(JSON.stringify(snapshot(solver,e)));expect(validSnapshot(saved,grid.count)).toBe(true);resumed=new CpuSolver(grid,new Float32Array(saved.state));resumed.climate.restore(saved.climate);restarts++;}
   }
   const after=totals(solver.state,solver.climate),delta=new Float64Array(STRIDE);for(const field of MASS_FIELDS)delta[field]=after[field]+lost[field]-before[field];const elements=elementalMass(delta),massResidual=MASS_FIELDS.reduce((sum,field)=>sum+delta[field],0),energyResidual=totalEnthalpy(solver.state,solver.climate)-energy0-boundary-numeric,elementResidual=Math.max(...Object.values(elements).map(Math.abs));
   reports.push({layered,steps:600,restarts,restartExact,mass0,energy0,massResidual,energyResidual,elementResidual,numeric,numericAbs,boundary,validAfter:validSnapshot(snapshot(solver,e),grid.count)});
   expect(restartExact).toBe(true);expect(Math.abs(massResidual)).toBeLessThan(1e-7);expect(elementResidual).toBeLessThan(1e-7);expect(Math.abs(energyResidual)).toBeLessThan(1e-4);
  }
  write('mixed-600-restart',{start,end:hashes(),reports});expect(hashes()).toEqual(start);
 },120000);

 it('checks liquid equilibrium, directed transport, momentum reaction and JSON mechanical restart',()=>{
  const start=hashes(),g=createSphere(0);for(let cell=0;cell<g.count;cell++)g.geometry[cell*4+3]=0;
  const j=g.neighbors[0],a=[...g.directions.subarray(0,3)],b=[...g.directions.subarray(j*3,j*3+3)],d=b.map((value,k)=>value-a[k]),norm=Math.hypot(...d),distance=2*Math.asin(Math.min(1,norm/2)),edges=[{i:0,j,distance,t:d.map(value=>value/norm)}],s=new Float64Array(g.count*STRIDE),ocean=new OceanDynamics(g,edges),ledger=new Float32Array(g.count*4);
  ocean.setThermal(undefined,false);for(let cell=0;cell<g.count;cell++){s[cell*STRIDE+F.rock]=1;s[cell*STRIDE+F.temperature]=20;s[cell*STRIDE+F.water]=2;s[cell*STRIDE+F.dissolved]=.2;}
  ocean.configure(s,9.81);ocean.reconcile(s,ledger);ledger.fill(0);const equilibrium=s.slice(),equilibriumMechanical=ocean.snapshot();ocean.transport(s,1,6.371e6,ledger);ocean.drag(s,60,ledger);
  expect(s).toEqual(equilibrium);expect(ocean.snapshot()).toEqual(equilibriumMechanical);expect(numerical(ledger)).toBe(0);
  s[F.water]+=1;ocean.externalPotential(s,ledger);ocean.reconcile(s,ledger);ledger.fill(0);
  const heat=()=>Array.from({length:g.count},(_,cell)=>enthalpy(s,cell)).reduce((sum,value)=>sum+value,0),energy0=heat()+ocean.energy(),mass0=totalMass(s),beforeWater=s[F.water],momentum=()=>[0,1,2].map(k=>ocean.boundaryImpulse[k]+Array.from({length:g.count},(_,cell)=>ocean.momentum[cell*3+k]).reduce((sum,value)=>sum+value,0)),momentum0=momentum();
  for(let n=0;n<100;n++)ocean.transport(s,1/30,6.371e6,ledger);
  const energyResidual=heat()+ocean.energy()-energy0-numerical(ledger),massResidual=totalMass(s)-mass0,momentumResidual=momentum().map((value,k)=>value-momentum0[k]);
  const restored=new OceanDynamics(g,edges);restored.setThermal(undefined,false);restored.restore(JSON.parse(JSON.stringify(ocean.snapshot())));const resumed=s.slice(),newLedger=new Float32Array(ledger.length);restored.transport(resumed,1/30,6.371e6,newLedger);ledger.fill(0);ocean.transport(s,1/30,6.371e6,ledger);
  write('hydraulic-control',{start,end:hashes(),beforeWater,afterWater:s[F.water],energyResidual,massResidual,momentumResidual,restartStateExact:[...resumed].every((value,index)=>value===s[index]),restartMechanicalExact:JSON.stringify(restored.snapshot())===JSON.stringify(ocean.snapshot())});
  expect(s[F.water]).toBeLessThan(beforeWater);expect(Math.abs(energyResidual)).toBeLessThan(1e-9);expect(Math.abs(massResidual)).toBeLessThan(1e-12);for(const value of momentumResidual)expect(Math.abs(value)).toBeLessThan(1e-10);expect(validOcean(ocean.snapshot(),g.count)).toBe(true);expect(resumed).toEqual(s);expect(restored.snapshot()).toEqual(ocean.snapshot());expect(newLedger).toEqual(ledger);expect(hashes()).toEqual(start);
 });
});
