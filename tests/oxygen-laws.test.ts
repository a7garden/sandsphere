import {heatForTarget} from '../src/sim/toolHeat';
import {describe,it,expect} from 'vitest';
import {ATOMIC_MASS,elementalMass,type Element} from '../src/sim/chemistry';
import {BIO_REACTIONS,COMBUSTION_REACTIONS,reactEcosystem,combust} from '../src/sim/ecology';
import {stoichiometricReaction,reactInventory,photoreaction,chemicalCost} from '../src/sim/materialReaction';
import {CHEMICAL_ENERGY} from '../src/sim/thermodynamics';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,capacity,phaseEnergy,enthalpy,totalMass,totalEnthalpy,react,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {AIR_LAYERS,AIR_SPECIES,AIR_FIELDS} from '../src/sim/layeredAtmosphere';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {measurePlanet,energyResidual,telemetryCsv,TelemetryStore} from '../src/sim/telemetry';
import {parseTelemetryCsv} from '../src/sim/telemetryCsvImport';
const grid=createSphere(0),zero=new Float32Array(grid.count*COMMAND_STRIDE);
const environment={ambient:22,sunlight:0,sun:[1,0,0],gravity:1,climate:false,body:sandboxDefinition('rock',1)};
const chemical=(s:ArrayLike<number>)=>CHEMICAL_ENERGY.reduce<number>((h,e,f)=>h+(s[f]??0)*e,0);
const elements=(s:ArrayLike<number>)=>{const t=new Float64Array(STRIDE);for(let p=0;p<s.length;p+=STRIDE)for(let f=0;f<STRIDE;f++)t[f]+=s[p+f];return elementalMass(t);};
function checkElements(a:Record<Element,number>,b:Record<Element,number>,tolerance=1e-6){for(const e of Object.keys(ATOMIC_MASS) as Element[])expect(Math.abs(a[e]-b[e]),e).toBeLessThan(tolerance*Math.max(1,a[e]));}
function finish(s:Float32Array,h:number){s[F.temperature]=(h-phaseEnergy(s,0))/capacity(s,0);}
function snapshot(s:CpuSolver,climate=false):Snapshot{return {version:11,preset:'coast',state:[...s.state],environment:{...environment,climate},climate:s.climate.snapshot(),time:1,discoveries:[],supplied:0,removed:0,planet:{primary:'rock'}};}
describe('elemental oxygen reaction network',()=>{
 it('rejects mass-balanced but element-unbalanced conversions',()=>{
  expect(()=>stoichiometricReaction([[15,1]],[[19,1]])).toThrow('원소');
  expect(()=>stoichiometricReaction([[13,1]],[[14,1]])).toThrow('원소');
 });
 it('conserves every element and mass for every registered biological and combustion reaction',()=>{
  for(const rule of [...Object.values(BIO_REACTIONS),...COMBUSTION_REACTIONS.map(r=>r.reaction)]){
   const s=new Float64Array(STRIDE);for(const [f,m] of rule.consumed)s[f]=m*2;
   const before=elementalMass(s),mass=s.reduce((a,b)=>a+b);expect(reactInventory(s,0,rule,99)).toBeCloseTo(2,12);
   checkElements(before,elementalMass(s),1e-12);expect(s.reduce((a,b)=>a+b)).toBeCloseTo(mass,12);expect(s.every(v=>v>=0)).toBe(true);
  }
 });
 it('uses the actual limiting oxygen stock and stops after exhaustion',()=>{
  const s=new Float64Array(STRIDE);s[F.methane]=2;s[F.oxygen]=4;
  const before=elementalMass(s);expect(reactInventory(s,0,BIO_REACTIONS.methane,20)).toBe(1);
  expect(s[F.methane]).toBe(1);expect(s[F.oxygen]).toBe(0);expect(s[F.carbonDioxide]).toBe(2.75);expect(s[F.water]).toBe(2.25);
  expect(reactInventory(s,0,BIO_REACTIONS.methane,20)).toBe(0);checkElements(before,elementalMass(s),1e-12);
 });
 it('pyrolyzes organics without oxygen but does not burn methane or ignite cold methane',()=>{
  const s=new Float32Array(STRIDE);s[F.methane]=1;s[F.soil]=2;const before=s.slice();
  expect(combust(s,0,10,900)).toBe(0);expect(s[F.methane]).toBe(before[F.methane]);expect(s[F.charcoal]).toBeGreaterThan(0);
  s[F.oxygen]=10;s[F.soil]=0;s[F.charcoal]=0;s[F.soot]=0;s[F.carbonMonoxide]=0;expect(combust(s,0,10,490)).toBe(0);
  // Atmospheric methane is advanced by the layer operator, not burned a second time on the surface.
  expect(combust(s,0,10,900,AIR_FIELDS)).toBe(0);expect(s[F.methane]).toBe(1);
 });
 it('photosynthetic oxygen feeds fermentation methane combustion with no free energy cycle',()=>{
  const s=new Float64Array(STRIDE);s[F.carbonDioxide]=4.4;s[F.water]=1.8;
  const before=elementalMass(s),mass=s.reduce((a,b)=>a+b);
  reactInventory(s,0,BIO_REACTIONS.uptake,4.4);const stored=chemical(s);
  expect(s[F.oxygen]).toBeCloseTo(3.2,12);expect(s[F.plant]).toBeCloseTo(3,12);
  reactInventory(s,0,BIO_REACTIONS.seed,3);reactInventory(s,0,BIO_REACTIONS.seedDecay,3);
  reactInventory(s,0,BIO_REACTIONS.ferment,3);const fermentationHeat=stored-chemical(s),fuel=chemical(s);
  expect(s[F.methane]).toBeCloseTo(.8,12);reactInventory(s,0,BIO_REACTIONS.methane,1);
  expect(chemical(s)).toBeCloseTo(0,8);expect(fermentationHeat+fuel).toBeCloseTo(stored,8);
  expect(stored).toBeCloseTo(13500,8);expect(s.reduce((a,b)=>a+b)).toBeCloseTo(mass,12);checkElements(before,elementalMass(s),1e-12);
 });
 it('stores finite photons across tiny Float32 events without spending more than received',()=>{
  const s=new Float32Array(STRIDE);s[F.temperature]=22;s[F.plant]=.1;s[F.water]=.12;s[F.carbonDioxide]=.02;
  const before=elements(s),mass=totalMass(s);let light=0;
  for(let k=0;k<300;k++){const h=enthalpy(s,0),absorbedSolar=.0001;light+=absorbedSolar;reactEcosystem(s,0,1/30,{temperature:22,light:1,absorbedSolar,rootability:1});finish(s,h+absorbedSolar);}
  expect(s[F.oxygen]).toBeGreaterThan(0);expect(s[F.photonEnergy]).toBeGreaterThanOrEqual(0);
  expect(s[F.oxygen]*30/32*CHEMICAL_ENERGY[F.plant]).toBeLessThanOrEqual(light*.25+1e-5);
  expect(totalMass(s)).toBeCloseTo(mass,5);checkElements(before,elements(s),2e-6);
  const b=s.slice();expect(photoreaction(s,0,BIO_REACTIONS.uptake,99,1e-12)).toBe(0);expect(s).toEqual(b);
 });
 it('organic combustion ignites methane and its heat starts ordinary water phase change',()=>{
  const s=new Float32Array(grid.count*STRIDE);s[F.temperature]=490;s[F.soil]=6;s[F.methane]=1;s[F.oxygen]=10;s[F.nitrogen]=.3;
  const before=elements(s),mass=totalMass(s),h=totalEnthalpy(s),energy=new Float32Array(grid.count*4);let exchanges=0;
  react(s,0,1/30,{...environment,ambient:22},grid,undefined,undefined,undefined,energy);exchanges+=energy.reduce((a,b)=>a+b);
  expect(s[F.temperature]).toBeGreaterThan(500);expect(s[F.methane]).toBe(1);
  for(let n=0;n<30;n++){energy.fill(0);react(s,0,1/30,environment,grid,undefined,undefined,undefined,energy);exchanges+=energy.reduce((a,b)=>a+b);}
  expect(s[F.methane]).toBeLessThan(.9);expect(s[F.vapor]).toBeGreaterThan(.01);expect(s[F.oxygen]).toBeLessThan(10);
  checkElements(before,elements(s),2e-6);expect(totalMass(s)).toBeCloseTo(mass,4);expect(totalEnthalpy(s)-h-exchanges).toBeCloseTo(0,2);
 });
 it('retains excess fuel at the thermal model boundary instead of discarding combustion heat',()=>{
  const s=new Float32Array(STRIDE);s[F.temperature]=2399;s[F.soil]=50;s[F.methane]=50;s[F.oxygen]=500;
  const h=enthalpy(s,0),before=elements(s);combust(s,0,10,2399);finish(s,h);
  expect(s[F.temperature]).toBeLessThanOrEqual(2400.01);expect(s[F.methane]).toBeGreaterThan(49);expect(s[F.soil]).toBeGreaterThan(49);checkElements(before,elements(s));expect(enthalpy(s,0)).toBeCloseTo(h,1);
 });
 it('does not let a surface reaction take oxygen from upper layers',()=>{
  const s=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++){s[i*STRIDE+F.temperature]=600;s[i*STRIDE+F.nitrogen]=.3;}s[F.soil]=1;
  const solver=new CpuSolver(grid,s);solver.climate.prepareSurface(solver.state,{...environment,climate:true});const air=solver.climate.air;
  air.mass[(AIR_LAYERS-1)*AIR_SPECIES+6]=1;air.attach(solver.state);
  air.surfaceReaction(solver.state,0,()=>combust(solver.state,0,1,600));expect(solver.state[F.charcoal]).toBeGreaterThan(0);expect(solver.state[F.carbonDioxide]).toBe(0);expect(solver.state[F.carbonMonoxide]).toBe(0);expect(air.mass[(AIR_LAYERS-1)*AIR_SPECIES+6]).toBe(1);
 });
 it.each([false,true])('keeps oxygen, reaction heat and finite resources across solver steps and JSON restart (layered %s)',climate=>{
  const s=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++){const p=i*STRIDE;s[p+F.temperature]=600;s[p+F.nitrogen]=1;s[p+F.oxygen]=.2;s[p+F.methane]=.02;s[p+F.soil]=.1;s[p+F.rock]=5;}
  const solver=new CpuSolver(grid,s.slice()),e={...environment,climate},before=elements(s),m=totalMass(s),h=totalEnthalpy(s);let exchanges=0,escaped=0;
  for(let n=0;n<60;n++){solver.advance(1/30,zero,e);exchanges+=solver.energyChanges.reduce((a,b)=>a+b);escaped+=solver.escapeCells.reduce((a,b)=>a+b);}
  expect(solver.state[F.methane]).toBeLessThan(s[F.methane]);checkElements(before,elements(solver.state),1e-5);expect(totalMass(solver.state,solver.climate)+escaped).toBeCloseTo(m,4);expect(Math.abs(totalEnthalpy(solver.state,solver.climate)-h-exchanges)).toBeLessThan(.05);
  const saved=JSON.parse(JSON.stringify(snapshot(solver,climate)));expect(validSnapshot(saved,grid.count)).toBe(true);
  const resumed=new CpuSolver(grid,new Float32Array(upgradeSnapshot(saved,grid.count).state));resumed.climate.restore(saved.climate);
  solver.advance(1/30,zero,e);resumed.advance(1/30,zero,e);expect(resumed.state).toEqual(solver.state);expect(resumed.climate.snapshot()).toEqual(solver.climate.snapshot());
 });
 it.each([false,true])('supplies oxygen through the shared paused command boundary (layered %s)',climate=>{
  const solver=new CpuSolver(grid,new Float32Array(grid.count*STRIDE)),command=zero.slice(),e={...environment,climate};command[11]=.25;command[4]=heatForTarget(solver.state,0,100,'heat',command,null,climate);
  const h=totalEnthalpy(solver.state);solver.advance(0,command,e);expect(solver.state[F.temperature]).toBeCloseTo(100,5);expect(solver.state[F.oxygen]).toBe(.25);expect(totalMass(solver.state)).toBe(.25);
  expect(totalEnthalpy(solver.state,solver.climate)-h-solver.energyChanges.reduce((a,b)=>a+b)).toBeCloseTo(0,3);
  expect(validSnapshot(snapshot(solver,climate),grid.count)).toBe(true);
 });
 it('reads v1–v8 stocks without adding oxygen, excitation energy or changing temperatures',()=>{
  for(const version of [1,2,3,4,5,6,7,8] as const){const s=new CpuSolver(grid,new Float32Array(grid.count*STRIDE));for(let i=0;i<grid.count;i++){s.state[i*STRIDE+F.temperature]=23;s.state[i*STRIDE+F.soil]=2;s.state[i*STRIDE+F.methane]=.1;}
   const old={...snapshot(s),version};expect(validSnapshot(old,grid.count)).toBe(true);const before=JSON.stringify(old),upgraded=upgradeSnapshot(old,grid.count);
   expect(upgraded.version).toBe(11);expect(upgraded.state).toEqual(old.state);expect(JSON.stringify(old)).toBe(before);expect(upgraded.state[F.oxygen]).toBe(0);expect(upgraded.state[F.photonEnergy]).toBe(0);
  }
 });
 it('upgrades a genuine six-species layer snapshot without shifting species or temperatures',()=>{
  const s=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++){s[i*STRIDE+F.temperature]=22;s[i*STRIDE+F.nitrogen]=.3;s[i*STRIDE+F.methane]=.01;}
  const solver=new CpuSolver(grid,s);solver.climate.prepareSurface(solver.state,{...environment,climate:true});solver.climate.air.attach(solver.state);const saved=snapshot(solver,true),air=saved.climate!.atmosphere!;
  air.version=3;air.mass=Array.from({length:air.temperature.length},(_,q)=>air.mass.slice(q*AIR_SPECIES,q*AIR_SPECIES+6)).flat();saved.version=8;
  expect(validSnapshot(saved,grid.count)).toBe(true);const original=JSON.stringify(saved),restored=new CpuSolver(grid,new Float32Array(saved.state));restored.climate.restore(saved.climate);const modern=restored.climate.snapshot().atmosphere!;
  expect(modern.version).toBe(6);expect(modern.temperature).toEqual(air.temperature);for(let q=0;q<air.temperature.length;q++){expect(modern.mass.slice(q*AIR_SPECIES,q*AIR_SPECIES+6)).toEqual(air.mass.slice(q*6,q*6+6));expect(modern.mass[q*AIR_SPECIES+6]).toBe(0);}
  expect(JSON.stringify(saved)).toBe(original);expect(totalEnthalpy(restored.state,restored.climate)).toBeCloseTo(totalEnthalpy(solver.state,saved.climate),7);
 });
 it('preserves energy-definition boundaries in mixed observation CSVs',()=>{
  const store=new TelemetryStore(),input={state:new Float32Array(STRIDE),time:0,environment,supplied:0,removed:0,escaped:0,transferredIn:0,transferredOut:0};
  const record=store.sample('a','A',input),old=structuredClone(record.baseline);delete old.values.chemistryVersion;record.baseline=old;record.points[0]=old;store.sample('a','A',{...input,time:1});
  const now=record.points[1];expect(energyResidual(now,old)).toBeNull();const roundtrip=parseTelemetryCsv(telemetryCsv(record));expect(energyResidual(roundtrip.points[1],roundtrip.points[0])).toBeNull();
 });
});
