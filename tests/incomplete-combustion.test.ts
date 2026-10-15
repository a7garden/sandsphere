import {describe,it,expect} from 'vitest';
import {elementalMass,ATOMIC_MASS,type Element} from '../src/sim/chemistry';
import {COMBUSTION_REACTIONS,PYROLYSIS_REACTIONS,combust,oxidationRoutes} from '../src/sim/ecology';
import {reactInventory,chemicalCost} from '../src/sim/materialReaction';
import {F,STRIDE,MASS_FIELDS,COMMAND_STRIDE,CpuSolver,enthalpy,capacity,phaseEnergy,totalMass,totalEnthalpy,type Snapshot} from '../src/sim/model';
import {AIR_FIELDS,AIR_SPECIES,AIR_LAYERS,airMassWidth} from '../src/sim/layeredAtmosphere';
import {GASES} from '../src/sim/gases';
import {createSphere} from '../src/sim/sphere';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {TelemetryStore,telemetryCsv,COMBUSTION_METRICS} from '../src/sim/telemetry';
import {parseTelemetryCsv} from '../src/sim/telemetryCsvImport';
import {columnColor} from '../src/render/columnGeometry';
import {depthProfile} from '../src/ui/depthProfile';
const grid=createSphere(0),empty=new Float32Array(grid.count*COMMAND_STRIDE);
const environment={ambient:22,sunlight:0,sun:[1,0,0],gravity:1,climate:false,body:sandboxDefinition('rock',1)};
const keys=Object.keys(ATOMIC_MASS) as Element[];
function elements(s:ArrayLike<number>){const stock=new Float64Array(STRIDE);for(let p=0;p<s.length;p+=STRIDE)for(let f=0;f<STRIDE;f++)stock[f]+=s[p+f];return elementalMass(stock);}
function sameElements(a:ReturnType<typeof elementalMass>,b:ReturnType<typeof elementalMass>,tol=1e-6){for(const e of keys)expect(Math.abs(a[e]-b[e]),e).toBeLessThan(tol*Math.max(1,a[e]));}
function closedStep(s:Float32Array,dt:number){const h=enthalpy(s,0);combust(s,0,dt,s[F.temperature]);s[F.temperature]=(h-phaseEnergy(s,0))/capacity(s,0);return enthalpy(s,0)-h;}
function snapshot(s:CpuSolver,climate=false):Snapshot{return {version:11,preset:'coast',state:[...s.state],environment:{...environment,climate},climate:s.climate.snapshot(),time:1,discoveries:[],supplied:0,removed:0,planet:{primary:'rock'}};}
describe('incomplete combustion and pyrolysis share finite stoichiometric laws',()=>{
 it('balances every complete, incomplete and pyrolysis rule independently',()=>{
  const rules=[...COMBUSTION_REACTIONS.flatMap(d=>[d.reaction,...('incomplete' in d&&d.incomplete?[d.incomplete]:[])]),...PYROLYSIS_REACTIONS.map(d=>d.reaction)];
  for(const rule of rules){const s=new Float64Array(STRIDE);for(const [f,m] of rule.consumed)s[f]=m;const before=elementalMass(s),mass=s.reduce((a,b)=>a+b);expect(reactInventory(s,0,rule,100)).toBeCloseTo(1,12);sameElements(before,elementalMass(s),1e-12);expect(s.reduce((a,b)=>a+b)).toBeCloseTo(mass,12);expect(s.every(v=>v>=0)).toBe(true);}
 });
 it('has the same net chemical energy through CO as direct oxidation, and through char as organic combustion',()=>{
  for(const def of COMBUSTION_REACTIONS){if(!('incomplete' in def)||!def.incomplete)continue;const co=def.incomplete.produced.find(([f])=>f===F.carbonMonoxide)![1];expect(chemicalCost(def.incomplete)+co*chemicalCost(COMBUSTION_REACTIONS.at(-1)!.reaction)).toBeCloseTo(chemicalCost(def.reaction),10);}
  for(const def of PYROLYSIS_REACTIONS){expect(chemicalCost(def.reaction)).toBeGreaterThan(0);expect(chemicalCost(def.reaction)+.4*chemicalCost(COMBUSTION_REACTIONS.find(d=>d.field===F.charcoal)!.reaction)).toBeCloseTo(-4500,10);}
 });
 it.each([F.methane,F.soil,F.charcoal])('produces CO from oxygen-poor fuel %s, then oxidizes it on oxygen supply',field=>{
  const s=new Float32Array(STRIDE);s[F.temperature]=800;s[field]=1;s[F.oxygen]=.02;const before=elements(s),h=enthalpy(s,0),m=totalMass(s);
  let error=0;for(let n=0;n<10;n++)error+=closedStep(s,.1);
  expect(s[F.carbonMonoxide]).toBeGreaterThan(.001);expect(s[F.oxygen]).toBeLessThan(.001);sameElements(before,elements(s));expect(totalMass(s)).toBeCloseTo(m,6);expect(Math.abs(enthalpy(s,0)-h)).toBeLessThan(.02);
  const co=s[F.carbonMonoxide],co2=s[F.carbonDioxide];s[F.oxygen]+=10;const fed=elements(s),hf=enthalpy(s,0);for(let n=0;n<50;n++)error+=closedStep(s,.02);
  expect(s[F.carbonMonoxide]).toBeLessThan(co);expect(s[F.carbonDioxide]).toBeGreaterThan(co2);sameElements(fed,elements(s),3e-6);expect(Math.abs(enthalpy(s,0)-hf)).toBeLessThan(.08);expect(Math.abs(error)).toBeLessThan(.1);
 });
 it('oxygen-rich methane has no incomplete branch, and branch share is timestep independent',()=>{
  const def=COMBUSTION_REACTIONS[0];expect(oxidationRoutes(def,1,8,.1,800)[1].requested).toBe(0);
  const ratio=(dt:number)=>{const r=oxidationRoutes(def,1,3,dt,800);return r[1].requested/(r[0].requested+r[1].requested);};expect(ratio(.1)).toBeCloseTo(ratio(.001),14);
 });
 it('forms charcoal without oxygen, consumes heat, and stops at the activation boundary',()=>{
  const s=new Float32Array(STRIDE);s[F.soil]=100;s[F.temperature]=301;const before=elements(s),h=enthalpy(s,0);closedStep(s,100);
  expect(s[F.charcoal]).toBeGreaterThan(0);expect(s[F.water]).toBeGreaterThan(0);expect(s[F.oxygen]).toBe(0);expect(s[F.carbonMonoxide]).toBe(0);expect(s[F.temperature]).toBeCloseTo(300,3);expect(s[F.soil]).toBeGreaterThan(99);sameElements(before,elements(s));expect(Math.abs(enthalpy(s,0)-h)).toBeLessThan(.04);
  const cold=new Float32Array(STRIDE);cold[F.soil]=2;cold[F.temperature]=299;const copy=cold.slice();closedStep(cold,100);expect(cold).toEqual(copy);
 });
 it('retains fuel rather than clipping released heat at the upper temperature bound',()=>{
  const s=new Float32Array(STRIDE);s[F.charcoal]=100;s[F.carbonMonoxide]=100;s[F.oxygen]=1000;s[F.temperature]=2399;const h=enthalpy(s,0);closedStep(s,10);
  expect(s[F.temperature]).toBeLessThanOrEqual(2400.001);expect(s[F.charcoal]+s[F.carbonMonoxide]).toBeGreaterThan(199);expect(Math.abs(enthalpy(s,0)-h)).toBeLessThan(.3);
 });
 it('char oxidation heat triggers methane ignition in the following local step',()=>{
  const s=new Float32Array(STRIDE);s[F.charcoal]=2;s[F.methane]=.1;s[F.oxygen]=10;s[F.temperature]=490;closedStep(s,.1);expect(s[F.temperature]).toBeGreaterThan(500);const methane=s[F.methane];closedStep(s,.1);expect(s[F.methane]).toBeLessThan(methane);
 });
 it('converges under timestep refinement for the coupled oxygen-poor network',()=>{
  const run=(dt:number)=>{const s=new Float32Array(STRIDE);s[F.temperature]=800;s[F.soil]=1;s[F.methane]=.1;s[F.oxygen]=.5;for(let n=0;n<Math.round(.5/dt);n++)closedStep(s,dt);return s;};
  const a=run(.02),b=run(.01),c=run(.005),distance=(x:Float32Array,y:Float32Array)=>MASS_FIELDS.reduce((d,f)=>d+Math.abs(x[f]-y[f]),0);expect(distance(b,c)).toBeLessThan(distance(a,b)*.8);
 });
 it.each([false,true])('closes element, mass and energy budgets with reoxygenation and exact JSON restart (layered %s)',climate=>{
  const state=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++){const p=i*STRIDE;state[p+F.temperature]=800;state[p+F.nitrogen]=.3;state[p+F.soil]=1;state[p+F.methane]=.1;state[p+F.oxygen]=.01;}
  const solver=new CpuSolver(grid,state),e={...environment,climate},m=totalMass(state),h=totalEnthalpy(state),before=elements(state),exported=new Float64Array(STRIDE);let energy=0,escaped=0,supplied=0;
  for(let n=0;n<90;n++){
   const command=empty.slice();if(n===45){for(let i=0;i<grid.count;i++)command[i*COMMAND_STRIDE+11]=.2;supplied=grid.count*.2;}
   solver.advance(1/30,command,e);energy+=solver.energyChanges.reduce((a,b)=>a+b);escaped+=solver.escapeCells.reduce((a,b)=>a+b);
   for(let i=0;i<grid.count;i++)for(let k=0;k<GASES.length;k++)exported[GASES[k].field]+=solver.escapeCells[i*GASES.length+k];
   if(n===44){expect(solver.state[F.charcoal]).toBeGreaterThan(0);expect(solver.state[F.carbonMonoxide]).toBeGreaterThan(0);}
  }
  const after=elements(solver.state),lost=elementalMass(exported);for(const el of keys)after[el]+=lost[el];before.O+=supplied;sameElements(before,after,1e-5);expect(Math.abs(totalMass(solver.state)+escaped-m-supplied)).toBeLessThan(1e-4);expect(Math.abs(totalEnthalpy(solver.state,solver.climate)-h-energy)).toBeLessThan(.15);
  const save=JSON.parse(JSON.stringify(snapshot(solver,climate)));expect(validSnapshot(save,grid.count)).toBe(true);const resumed=new CpuSolver(grid,new Float32Array(save.state));resumed.climate.restore(save.climate);solver.advance(1/30,empty,e);resumed.advance(1/30,empty,e);expect(resumed.state).toEqual(solver.state);expect(resumed.climate.snapshot()).toEqual(solver.climate.snapshot());
 });
 it('transports CO and its energy between cells and includes it in escape accounting',()=>{
  const s=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++)s[i*STRIDE+F.temperature]=600;s[F.carbonMonoxide]=1;const solver=new CpuSolver(grid,s),h=totalEnthalpy(s),m=totalMass(s);solver.advance(.1,empty,{...environment,gravity:.01,body:sandboxDefinition('rock',.01)});
  expect(solver.state[F.carbonMonoxide]).toBeLessThan(1);expect(solver.state.some((v,i)=>i>STRIDE&&i%STRIDE===F.carbonMonoxide&&v>0)).toBe(true);expect(solver.escapeCells.filter((_,i)=>i%GASES.length===5).reduce((a,b)=>a+b)).toBeGreaterThan(0);expect(totalMass(solver.state)+solver.escapeCells.reduce((a,b)=>a+b)).toBeCloseTo(m,6);expect(Math.abs(totalEnthalpy(solver.state)-h-solver.energyChanges.reduce((a,b)=>a+b))).toBeLessThan(.05);
 });
 it('loads real seven-species v9/v4 saves without changing stocks, temperatures or oxygen',()=>{
  const s=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++){s[i*STRIDE+F.temperature]=22;s[i*STRIDE+F.nitrogen]=.3;s[i*STRIDE+F.oxygen]=.02;}
  const solver=new CpuSolver(grid,s);solver.climate.prepareSurface(s,{...environment,climate:true});solver.climate.air.attach(s);const old=snapshot(solver,true);old.version=9;const air=old.climate!.atmosphere!;air.mass=air.mass.filter((_,i)=>i%AIR_SPECIES<7);air.version=4;
  expect(airMassWidth(air)).toBe(7);expect(validSnapshot(old,grid.count)).toBe(true);const original=JSON.stringify(old),upgraded=upgradeSnapshot(old,grid.count);expect(upgraded.version).toBe(11);expect(upgraded.state).toEqual(old.state);const resumed=new CpuSolver(grid,new Float32Array(upgraded.state));resumed.climate.restore(upgraded.climate);const now=resumed.climate.snapshot().atmosphere!;expect(now.version).toBe(6);expect(now.temperature).toEqual(air.temperature);
  for(let q=0;q<grid.count*AIR_LAYERS;q++){expect(now.mass.slice(q*AIR_SPECIES,q*AIR_SPECIES+7)).toEqual(air.mass.slice(q*7,q*7+7));expect(now.mass[q*AIR_SPECIES+7]).toBe(0);}expect(totalEnthalpy(resumed.state,resumed.climate)).toBeCloseTo(totalEnthalpy(s,old.climate),7);expect(JSON.stringify(old)).toBe(original);
  old.state[F.charcoal]=1;expect(validSnapshot(old,grid.count)).toBe(false);old.state[F.charcoal]=0;old.state[F.carbonMonoxide]=1;expect(validSnapshot(old,grid.count)).toBe(false);
 });
 it('makes charcoal visible in ground color and depth composition',()=>{
  const s=new Float32Array(grid.count*STRIDE),before=columnColor(s,0);s[F.charcoal]=1;expect(columnColor(s,0)[0]).toBeLessThan(before[0]);expect(depthProfile(s,0,grid).layers[0].components.some(c=>c.id==='charcoal'&&c.mass===1)).toBe(true);
 });
 it('imports alpha.8 observation CSV columns as unknown new species, preserving the energy basis',()=>{
  const store=new TelemetryStore(),record=store.sample('a','A',{state:new Float32Array(STRIDE),time:0,environment,supplied:0,removed:0,escaped:0,transferredIn:0,transferredOut:0});
  const csv=telemetryCsv(record),lines=csv.split('\n'),header=lines.find(l=>l.startsWith('simulation_s'))!.split(','),skip=header.flatMap((h,i)=>COMBUSTION_METRICS.some(k=>h.startsWith(k+' ['))?[i]:[]),legacy=lines.map(line=>line.startsWith('#')||!line?line:line.split(',').filter((_,i)=>!skip.includes(i)).join(',')).join('\n');
  const loaded=parseTelemetryCsv(legacy);for(const key of COMBUSTION_METRICS)expect(loaded.baseline.values[key]).toBeNull();expect(loaded.baseline.values.chemistryVersion).toBe(2);
 });
});
