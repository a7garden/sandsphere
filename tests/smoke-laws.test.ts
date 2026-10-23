import {describe,it,expect} from 'vitest';
import {F,STRIDE,COMMAND_STRIDE,MASS_FIELDS,CpuSolver,totalMass,totalEnthalpy,enthalpy,capacity,phaseEnergy,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {WeatherClimate} from '../src/sim/weatherClimate';
import {AIR_LAYERS,AIR_FIELDS,AIR_SPECIES,airMassWidth} from '../src/sim/layeredAtmosphere';
import {SOOT,particleSettlingSpeed,particleLiftFlux} from '../src/sim/aerosolPhysics';
import {COMBUSTION_REACTIONS,PYROLYSIS_REACTIONS,combust} from '../src/sim/ecology';
import {reactInventory,chemicalCost} from '../src/sim/materialReaction';
import {ATOMIC_MASS,elementalMass,type Element} from '../src/sim/chemistry';
import {GASES} from '../src/sim/gases';
import {createJupiterPlanet} from '../src/sim/planetCreation';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {radiativeFluxes} from '../src/sim/climatePhysics';
import {smokeColumn} from '../src/render/smokeField';
import {TelemetryStore,SMOKE_METRICS,telemetryCsv} from '../src/sim/telemetry';
import {parseTelemetryCsv} from '../src/sim/telemetryCsvImport';
const grid=createSphere(0),empty=new Float32Array(grid.count*COMMAND_STRIDE),e={ambient:22,sunlight:0,sun:[1,0,0],gravity:1,climate:true,body:sandboxDefinition('rock',1)};
const elementKeys=Object.keys(ATOMIC_MASS) as Element[];
function elements(s:ArrayLike<number>){const total=new Float64Array(STRIDE);for(let p=0;p<s.length;p+=STRIDE)for(let f=0;f<STRIDE;f++)total[f]+=s[p+f];return elementalMass(total);}
function equalElements(a:ReturnType<typeof elements>,b:ReturnType<typeof elements>,tol=1e-6){for(const key of elementKeys)expect(Math.abs(a[key]-b[key]),key).toBeLessThan(tol*Math.max(1,a[key]));}
function world(t=22){const state=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++){state[i*STRIDE+F.temperature]=t;state[i*STRIDE+F.nitrogen]=.3;}const climate=new WeatherClimate(grid);climate.prepareSurface(state,e);return {state,climate,air:climate.air};}
function budget(w:ReturnType<typeof world>){const stock=new Float64Array(STRIDE);for(let p=0;p<w.state.length;p+=STRIDE)for(const f of MASS_FIELDS)stock[f]+=w.state[p+f];for(let q=0;q<w.air.temperature.length;q++){for(let f=0;f<AIR_SPECIES;f++)stock[AIR_FIELDS[f]]+=w.air.mass[q*AIR_SPECIES+f];stock[F.airborneDust]+=w.air.dustMass[q];}return {mass:stock.reduce((a,b)=>a+b),elements:elementalMass(stock),h:totalEnthalpy(w.state)+w.air.totalEnergy()+w.air.surfaceHeatCarry.reduce((a,b)=>a+b,0),roundoff:w.air.checkpoint().roundoff.reduce((a,b)=>a+b)};}
function balanced(before:ReturnType<typeof budget>,w:ReturnType<typeof world>){const after=budget(w);expect(after.mass).toBeCloseTo(before.mass,11);equalElements(before.elements,after.elements,1e-11);expect(after.h-before.h-(after.roundoff-before.roundoff)).toBeCloseTo(0,7);}
function saved(s:CpuSolver,climate=true):Snapshot{return {version:11,preset:'coast',state:[...s.state],climate:s.climate.snapshot(),environment:{...e,climate},time:1,supplied:0,removed:0,discoveries:[],planet:{primary:'rock'}};}
describe('mobile carbon and smoke',()=>{
 it('balances fine carbon formation and oxidation, with the same carbon potential as charcoal',()=>{
  const rules=[...COMBUSTION_REACTIONS.flatMap(d=>[d.reaction,...(d.incomplete?[d.incomplete]:[]),...(d.smoky?[d.smoky]:[])]),...PYROLYSIS_REACTIONS.map(d=>d.reaction)];
  for(const rule of rules){const s=new Float64Array(STRIDE);for(const [f,m] of rule.consumed)s[f]=m;const before=elementalMass(s),mass=s.reduce((a,b)=>a+b);reactInventory(s,0,rule,1);equalElements(before,elementalMass(s),1e-12);expect(s.reduce((a,b)=>a+b)).toBeCloseTo(mass,12);}
  const char=COMBUSTION_REACTIONS.find(d=>d.field===F.charcoal)!,soot=COMBUSTION_REACTIONS.find(d=>d.field===F.soot)!;expect(chemicalCost(char.reaction)).toBe(chemicalCost(soot.reaction));
 });
 it('produces finite smoke from oxygen-poor methane and heat-driven organic fragmentation',()=>{
  for(const field of [F.methane,F.soil]){const s=new Float32Array(STRIDE);s[field]=1;s[F.oxygen]=field===F.methane?.01:0;s[F.temperature]=800;const before=elements(s),h=enthalpy(s,0);combust(s,0,.1,800);s[F.temperature]=(h-phaseEnergy(s,0))/capacity(s,0);expect(s[F.soot]).toBeGreaterThan(0);equalElements(before,elements(s));expect(enthalpy(s,0)).toBeCloseTo(h,2);}
 });
 it('moves charcoal downhill as finite grains, and transports sensible and bond energy',()=>{
  const s=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++)s[i*STRIDE+F.temperature]=22;s[F.charcoal]=400;const solver=new CpuSolver(grid,s),m=totalMass(s),h=totalEnthalpy(s);solver.advance(.1,empty,{...e,climate:false});expect(solver.state[F.charcoal]).toBeLessThan(400);expect(solver.state.some((v,i)=>i%STRIDE===F.charcoal&&i>STRIDE&&v>0)).toBe(true);expect(totalMass(solver.state)).toBeCloseTo(m,4);expect(Math.abs(totalEnthalpy(solver.state,solver.climate)-h-solver.energyChanges.reduce((a,b)=>a+b))).toBeLessThan(.5);
 });
 it('lifts real grains, charges gravitational work, and conserves the momentum of stationary grain mixing',()=>{
  const w=world(50);w.state[F.charcoal]=1;w.air.velocity.set([100,0,0],0);const m=w.air.layerMass(0),momentum=m*100,before=budget(w);w.air.liftSoot(w.state,0,3600);expect(w.state[F.charcoal]).toBeLessThan(1);expect(w.air.mass[8]).toBeGreaterThan(0);expect(w.air.layerMass(0)*w.air.velocity[0]).toBeCloseTo(momentum,12);expect(w.state[F.temperature]).toBeLessThan(50);balanced(before,w);
 });
 it('does not lift absent, windless, or ice-covered fuel and accumulates sub-ULP demand across save',()=>{
  const w=world();w.state[F.charcoal]=100;const before=budget(w);w.air.liftSoot(w.state,0,100);expect(w.air.mass[8]).toBe(0);w.air.velocity[0]=100;w.state[F.ice]=100;w.air.liftSoot(w.state,0,1);expect(w.air.mass[8]).toBe(0);w.state[F.ice]=0;w.air.liftSoot(w.state,0,1);expect(w.air.snapshot()!.sootLiftCarry![0]).toBeGreaterThan(0);
  const restored=new WeatherClimate(grid);restored.restore(w.climate.snapshot());expect(restored.air.snapshot()).toEqual(w.air.snapshot());expect(before.mass).toBeGreaterThan(0);
  for(let n=0;n<1000;n++){w.air.liftSoot(w.state,0,1);}expect(w.air.mass[8]).toBeGreaterThan(0);
 });
 it('settles through adjacent layers and deposits carbon with potential/kinetic energy',()=>{
  const w=world(50);w.air.mass[AIR_SPECIES+8]=.001;w.air.velocity.set([10,0,0],3);const before=budget(w);w.air.settleSoot(w.state,0,1000);expect(w.air.mass[8]).toBeGreaterThan(0);expect(w.state[F.charcoal]).toBe(0);balanced(before,w);const second=budget(w);w.air.settleSoot(w.state,0,1000);expect(w.state[F.charcoal]).toBeGreaterThan(0);balanced(second,w);
 });
 it('leaves a sub-ULP deposition in the air and continues settling higher layers',()=>{
  const w=world();w.state[F.charcoal]=100000;w.air.mass[8]=1e-12;w.air.mass[AIR_SPECIES+8]=.1;const before=budget(w);w.air.settleSoot(w.state,0,1);expect(w.state[F.charcoal]).toBe(100000);expect(w.air.mass[8]).toBeGreaterThan(1e-12);balanced(before,w);
 });
 it('uses the same pressure/gravity-dependent particle law for soot sedimentation',()=>{
  expect(particleSettlingSpeed(SOOT,100,22,9.81)).toBeGreaterThan(particleSettlingSpeed(SOOT,100000,22,9.81));expect(particleSettlingSpeed(SOOT,100000,22,0)).toBe(0);expect(particleLiftFlux(SOOT,0,1,0)).toBe(0);
 });
 it('advects carbon horizontally with gas, then oxidizes it where oxygen arrives',()=>{
  const w=world(600),edge=(w.air as unknown as {edges:{i:number;j:number;t:number[]}[]}).edges[0],q=edge.i*AIR_LAYERS;w.air.mass[q*AIR_SPECIES+8]=.01;
  for(const cell of [edge.i,edge.j])w.air.velocity.set(edge.t.map(v=>v*200),cell*AIR_LAYERS*3);
  const before=budget(w);(w.air as unknown as {dynamics(dt:number,environment:typeof e):void}).dynamics(1,e);expect(w.air.mass[edge.j*AIR_LAYERS*AIR_SPECIES+8]).toBeGreaterThan(0);balanced(before,w);
  const r=edge.j*AIR_LAYERS,co2=w.air.mass[r*AIR_SPECIES+3];w.air.mass[r*AIR_SPECIES+6]=1;const fed=budget(w);(w.air as unknown as {burnGas(q:number,dt:number):void}).burnGas(r,1);expect(w.air.mass[r*AIR_SPECIES+3]).toBeGreaterThan(co2);balanced(fed,w);
 });
 it('absorbs sunlight from transported soot with a closed radiation-column budget',()=>{
  const w=world(),clear=radiativeFluxes(w.air.radiationColumn(w.state,0,e,500));w.air.mass[8]=.000001;const smoky=radiativeFluxes(w.air.radiationColumn(w.state,0,e,500));expect(smoky.surfaceSolar).toBeLessThan(clear.surfaceSolar);expect(500-smoky.reflectedSolar-smoky.surfaceSolar).toBeGreaterThan(500-clear.reflectedSolar-clear.surfaceSolar);
 });
 it('invalidates cached radiation when soot and mineral dust exchange equal extinction',()=>{
  const w=world(),energy=new Float32Array(grid.count*4),run=w.air as unknown as {radiation(s:Float32Array,i:number,dt:number,environment:typeof e,energy:Float32Array):void};
  w.air.mass[8]=1e-6;run.radiation(w.state,0,0,e,energy);const smoky=w.air.checkpoint().radiationCache[2];
  w.air.mass[8]=0;w.air.dustMass[0]=2e-6;run.radiation(w.state,0,0,e,energy);const dust=w.air.checkpoint().radiationCache[2];
  expect(dust).not.toBe(smoky);expect(dust).toBeCloseTo(radiativeFluxes(w.air.radiationColumn(w.state,0,e,1)).surfaceSolar,12);
 });
 it('renders zero smoke without carbon, and projects real height and mass after vertical movement',()=>{
  const w=world();expect(smokeColumn(w.state,0,w.air).opacity).toBe(0);w.air.mass[8]=.001;const low=smokeColumn(w.state,0,w.air);w.air.mass[8]=0;w.air.mass[10*AIR_SPECIES+8]=.001;const high=smokeColumn(w.state,0,w.air);expect(high.mass).toBe(low.mass);expect(high.opacity).toBe(low.opacity);expect(high.height).toBeGreaterThan(low.height);
 });
 it.each([false,true])('conserves resources and energy across emission, transport, oxidation, commands and JSON restart (layered %s)',climate=>{
  const s=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++){const p=i*STRIDE;s[p+F.temperature]=800;s[p+F.nitrogen]=.3;s[p+F.soil]=.3;s[p+F.oxygen]=.01;s[p+F.methane]=.03;s[p+F.charcoal]=i===0?300:.1;}
  const solver=new CpuSolver(grid,s),before=elements(s),m=totalMass(s),h=totalEnthalpy(s),lost=new Float64Array(STRIDE);let energy=0,escaped=0,supplied=0;
  for(let n=0;n<60;n++){const command=empty.slice();if(n===30){for(let i=0;i<grid.count;i++)command[i*COMMAND_STRIDE+11]=.1;supplied=grid.count*.1;}solver.advance(1/30,command,{...e,climate});energy+=solver.energyChanges.reduce((a,b)=>a+b);escaped+=solver.escapeCells.reduce((a,b)=>a+b);for(let i=0;i<grid.count;i++)for(let k=0;k<GASES.length;k++)lost[GASES[k].field]+=solver.escapeCells[i*GASES.length+k];}
  expect(solver.state.some((v,i)=>i%STRIDE===F.soot&&v>0)).toBe(true);const after=elements(solver.state),exported=elementalMass(lost);for(const key of elementKeys)after[key]+=exported[key];before.O+=supplied;equalElements(before,after,1e-5);expect(Math.abs(totalMass(solver.state)+escaped-m-supplied)).toBeLessThan(.001);expect(Math.abs(totalEnthalpy(solver.state,solver.climate)-h-energy)).toBeLessThan(1);
  const save=JSON.parse(JSON.stringify(saved(solver,climate)));expect(validSnapshot(save,grid.count)).toBe(true);const resumed=new CpuSolver(grid,new Float32Array(save.state));resumed.climate.restore(save.climate);solver.advance(1/30,empty,{...e,climate});resumed.advance(1/30,empty,{...e,climate});expect(resumed.state).toEqual(solver.state);expect(resumed.climate.snapshot()).toEqual(solver.climate.snapshot());
 });
 it('upgrades actual 36-field v10 and 8-species v5 without altering carbon, oxygen, energy or temperature',()=>{
  const w=world();w.state[F.charcoal]=.25;w.air.mass[7]=.001;w.air.attach(w.state);const solver=new CpuSolver(grid,w.state);solver.climate.restore(w.climate.snapshot());const old=saved(solver);old.version=10;old.climate!.version=4;delete old.climate!.surfaceMassCarry;old.state=old.state.filter((_,i)=>i%STRIDE<36);const air=old.climate!.atmosphere!;air.mass=air.mass.filter((_,i)=>i%AIR_SPECIES<8);air.version=5;delete air.geometryScale;delete air.gasRadiationCache;delete air.boundaryImpulse;delete air.surfaceHeatCarry;delete air.sootLiftCarry;delete air.sootRadiationCache;
  expect(airMassWidth(air)).toBe(8);expect(validSnapshot(old,grid.count)).toBe(true);const original=JSON.stringify(old),upgraded=upgradeSnapshot(old,grid.count);expect(validSnapshot(upgraded,grid.count)).toBe(true);for(let i=0;i<grid.count;i++){expect(upgraded.state.slice(i*STRIDE,i*STRIDE+36)).toEqual(old.state.slice(i*36,(i+1)*36));expect(upgraded.state.slice(i*STRIDE+36,(i+1)*STRIDE)).toEqual([0,0,0,0]);}
  const restored=new CpuSolver(grid,new Float32Array(upgraded.state));restored.climate.restore(upgraded.climate);expect(restored.climate.air.temperature).toEqual(w.air.temperature);expect(totalEnthalpy(restored.state,restored.climate)).toBeCloseTo(totalEnthalpy(w.state,old.climate),8);expect(JSON.stringify(old)).toBe(original);
  const bad=structuredClone(upgraded);bad.state[F.soot]=1;expect(validSnapshot(bad,grid.count)).toBe(false);bad.state[F.soot]=0;bad.state[39]=1;expect(validSnapshot(bad,grid.count)).toBe(false);
 });
 it('reads the actual 36-field giant v10 layout without changing its deep atmosphere',()=>{
  const p=createJupiterPlanet(grid),old:Snapshot={version:10,preset:'coast',state:[...p.state].filter((_,i)=>i%STRIDE<36),climate:p.climate,environment:p.environment,spin:p.spin,time:7,supplied:0,removed:0,discoveries:[]};
  expect(validSnapshot(old,grid.count)).toBe(true);const original=JSON.stringify(old),upgraded=upgradeSnapshot(old,grid.count);expect(validSnapshot(upgraded,grid.count)).toBe(true);expect(upgraded.climate).toEqual(old.climate);expect(upgraded.state).toEqual([...p.state]);expect(upgraded.time).toBe(7);expect(JSON.stringify(old)).toBe(original);
 });
 it('imports alpha.9 telemetry without inventing historical soot observations',()=>{
  const store=new TelemetryStore(),record=store.sample('a','A',{state:new Float32Array(STRIDE),time:0,environment:e,supplied:0,removed:0,escaped:0,transferredIn:0,transferredOut:0});const lines=telemetryCsv(record).split('\n'),header=lines.find(l=>l.startsWith('simulation_s'))!.split(','),index=header.findIndex(h=>h.startsWith('soot ['));const legacy=lines.map(l=>!l||l.startsWith('#')?l:l.split(',').filter((_,i)=>i!==index).join(',')).join('\n');expect(parseTelemetryCsv(legacy).baseline.values[SMOKE_METRICS[0]]).toBeNull();
 });
});
