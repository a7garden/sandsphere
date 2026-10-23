import {WeatherClimate} from '../src/sim/weatherClimate';
import {radiativeFluxes} from '../src/sim/climatePhysics';
import {describe,it,expect} from 'vitest';
import {BIO_REACTIONS,PHOTOCHEMICAL_FRACTION,reactEcosystem} from '../src/sim/ecology';
import {chemicalCost,photoreaction,reactInventory} from '../src/sim/materialReaction';
import {CHEMICAL_ENERGY,MATERIAL_ENERGY} from '../src/sim/thermodynamics';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,capacity,enthalpy,phaseEnergy,totalMass,totalEnthalpy,seedPlanet,react,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {upgradeSnapshot,validSnapshot} from '../src/sim/storage';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {energyResidual,measurePlanet} from '../src/sim/telemetry';
const grid=createSphere(1),zero=new Float32Array(grid.count*COMMAND_STRIDE);
const environment={ambient:22,sunlight:1,sun:[...grid.directions.slice(0,3)],gravity:1,climate:true,body:sandboxDefinition('rock',1)};
function stock(t=22){const s=new Float32Array(STRIDE);s[F.temperature]=t;s[F.soil]=2;s[F.plant]=.1;s[F.water]=.12;s[F.carbonDioxide]=.02;return s;}
const chem=(s:Float32Array)=>s.reduce((h,m,f)=>h+m*CHEMICAL_ENERGY[f%STRIDE],0);
const context={temperature:22,light:1,absorbedSolar:.0001,rootability:1};
function closed(s:Float32Array,dt:number,c=context){const h=enthalpy(s,0),used=reactEcosystem(s,0,dt,c);s[F.temperature]=(h-phaseEnergy(s,0))/capacity(s,0);return used;}
describe('finite chemical energy and material sandbox',()=>{
 it('limits photochemistry by photons and every finite carbon stock',()=>{
  const s=stock(),h=chem(s),m=totalMass(s),budget=.03;
  const used=photoreaction(s,0,BIO_REACTIONS.uptake,100,budget);
  expect(used).toBeGreaterThan(0);expect(used).toBeLessThanOrEqual(budget);expect(chem(s)-h).toBeLessThanOrEqual(used+1e-8);expect(totalMass(s)).toBeCloseTo(m,7);
  expect(photoreaction(s,0,BIO_REACTIONS.uptake,100,0)).toBe(0);
  s[F.carbonDioxide]=0;expect(photoreaction(s,0,BIO_REACTIONS.uptake,100,1)).toBe(0);
 });
 it('does not create products when the finite photon budget is below a reactant Float32 quantum',()=>{
  const s=stock();s[F.carbonDioxide]=100000;const before=s.slice();
  expect(photoreaction(s,0,BIO_REACTIONS.uptake,1,1e-12)).toBe(0);expect(s).toEqual(before);
 });
 it('stores no more than the allocated absorbed sunlight, with mass and total energy closed',()=>{
  const s=stock(),m=totalMass(s),h=enthalpy(s,0),ch=chem(s),used=closed(s,1);
  expect(used+s[F.photonEnergy]).toBeGreaterThan(0);expect(used).toBeLessThanOrEqual(context.absorbedSolar*PHOTOCHEMICAL_FRACTION+1e-15);
  expect(chem(s)-ch).toBeLessThanOrEqual(used+1e-7);expect(totalMass(s)).toBeCloseTo(m,6);expect(enthalpy(s,0)).toBeCloseTo(h,4);
 });
 it.each(['dark','dry','salty','sterile','no carbon'] as const)('cannot grow new biomass when %s',control=>{
  const s=stock(),c={...context,absorbedSolar:10};
  if(control==='dark'){c.absorbedSolar=0;c.light=0;}if(control==='dry')s[F.water]=0;if(control==='salty')s[F.dissolved]=1;
  if(control==='sterile')s[F.plant]=0;if(control==='no carbon'){s[F.soil]=0;s[F.carbonDioxide]=0;}
  const before=s[F.plant]+s[F.seed];closed(s,.1,c);expect(s[F.plant]+s[F.seed]).toBeLessThanOrEqual(before+1e-8);
 });
 it('wet organic matter generates methane and CO2; dryness/salt suppress that route',()=>{
  for(const kind of ['wet','dry','salt']){const s=stock();s[F.plant]=0;if(kind==='dry')s[F.water]=0;if(kind==='salt')s[F.dissolved]=1;
   const before=totalMass(s),h=enthalpy(s,0);closed(s,2,{...context,light:0,absorbedSolar:0});
   expect(s[F.methane]>0).toBe(kind==='wet');expect(totalMass(s)).toBeCloseTo(before,6);expect(enthalpy(s,0)).toBeCloseTo(h,4);
  }
 });
 it('feeds generated gases into radiation: the same mass of inert nitrogen lacks their infrared feedback',()=>{
  const material=stock();material[F.plant]=0;material[F.carbonDioxide]=0;closed(material,100,{...context,absorbedSolar:0,light:0});
  expect(material[F.methane]).toBeGreaterThan(0);expect(material[F.carbonDioxide]).toBeGreaterThan(0);
  const active=seedPlanet(grid,'rock',22,'nitrogen'),control=active.slice();
  for(let i=0;i<grid.count;i++){const p=i*STRIDE;active[p+F.methane]=material[F.methane];active[p+F.carbonDioxide]=material[F.carbonDioxide];control[p+F.nitrogen]+=material[F.methane]+material[F.carbonDioxide];}
  const a=new WeatherClimate(grid),b=new WeatherClimate(grid),q=new Float32Array(grid.count*4);a.step(active,0,environment,q);b.step(control,0,environment,q);
  // Hold temperature/light fixed to isolate composition from the initial-column redistribution.
  a.air.temperature.fill(22);b.air.temperature.fill(22);active[F.temperature]=control[F.temperature]=22;
  const fa=radiativeFluxes(a.air.radiationColumn(active,0,environment,0)),fb=radiativeFluxes(b.air.radiationColumn(control,0,environment,0));
  expect(fa.down[0]).toBeGreaterThan(fb.down[0]);
 });
 it('heating the same materials opens the oxygen combustion route without light',()=>{
  const cold=stock(),hot=stock(600);cold[F.water]=hot[F.water]=0;cold[F.oxygen]=hot[F.oxygen]=4;
  closed(cold,1,{...context,light:0,absorbedSolar:0});closed(hot,1,{...context,temperature:600,light:0,absorbedSolar:0});
  expect(hot[F.carbonDioxide]).toBeGreaterThan(cold[F.carbonDioxide]+.1);expect(hot[F.plant]).toBeLessThan(cold[F.plant]);
 });
 it('a photosynthesis → organic residue → gas cycle cannot make free energy',()=>{
  const s=stock(),initial=chem(s),m=totalMass(s),light=.0005;
  const used=photoreaction(s,0,BIO_REACTIONS.uptake,1,light);
  const before=chem(s);reactInventory(s,0,BIO_REACTIONS.seed,s[F.plant]);reactInventory(s,0,BIO_REACTIONS.seedDecay,s[F.seed]);
  reactInventory(s,0,BIO_REACTIONS.ferment,s[F.soil]);const released=before-chem(s);
  expect(chem(s)+released-initial).toBeCloseTo(used,4);expect(totalMass(s)).toBeCloseTo(m,6);expect(chemicalCost(BIO_REACTIONS.ferment)).toBeLessThan(0);
 });
 it('uses actual cloud temperature: an above-freezing cloud cannot freeze in a hidden colder layer',()=>{
  const s=new Float32Array(grid.count*STRIDE);s[F.temperature]=5;s[F.nitrogen]=.3;s[F.cloud]=.02;
  react(s,0,.1,{ambient:5,sunlight:0,sun:[1,0,0]},grid);
  expect(s[F.cloudIce]).toBe(0);expect(s[F.cloud]).toBeGreaterThan(0);
 });
 it.each([false,true])('couples ecology, gases, water and heat with closed budgets and exact JSON restart (layered %s)',climate=>{
  const s=seedPlanet(grid,'rock',22,'nitrogen');for(let i=0;i<grid.count;i++){const p=i*STRIDE;s[p+F.soil]=2;s[p+F.water]=.12;s[p+F.plant]=.1;s[p+F.carbonDioxide]=.02;}
  const a=new CpuSolver(grid,s),e={...environment,climate},m=totalMass(s),h=totalEnthalpy(s);let energy=0,escaped=0;
  for(let n=0;n<60;n++){a.advance(1/30,zero,e);energy+=a.energyChanges.reduce((a,b)=>a+b);escaped+=a.escapeCells.reduce((a,b)=>a+b);}
  expect(a.state.some((v,i)=>i%STRIDE===F.methane&&v>0)).toBe(true);
  expect(totalMass(a.state)+escaped).toBeCloseTo(m,4);expect(totalEnthalpy(a.state,a.climate)-h-energy).toBeCloseTo(0,2);
  const snapshot:Snapshot={version:11,preset:'coast',time:2,state:[...a.state],environment:e,climate:a.climate.snapshot(),discoveries:[],supplied:0,removed:0,planet:{primary:'rock'}};
  const saved=JSON.parse(JSON.stringify(snapshot));expect(validSnapshot(saved,grid.count)).toBe(true);const upgraded=upgradeSnapshot(saved,grid.count);
  expect(upgraded.state).toEqual(saved.state);const b=new CpuSolver(grid,new Float32Array(upgraded.state));b.climate.restore(upgraded.climate);
  a.advance(.1,zero,e);b.advance(.1,zero,e);expect(b.state).toEqual(a.state);expect(JSON.stringify(b.climate.snapshot())).toEqual(JSON.stringify(a.climate.snapshot()));
 });
 it('keeps old stocks/temperatures, interprets their stored chemical energy, and does not mix historical energy definitions',()=>{
  const s=stock(),old:Snapshot={version:3,preset:'coast',time:50,state:[...s],environment:{ambient:22,sunlight:1,sun:[1,0,0]},discoveries:[],supplied:0,removed:0};
  const upgraded=upgradeSnapshot(old,1);expect(upgraded.state).toEqual(old.state);expect(MATERIAL_ENERGY[F.plant]).toBeGreaterThan(0);
  const now=measurePlanet({state:s,time:50,environment:old.environment,supplied:0,removed:0,escaped:0,transferredIn:0,transferredOut:0}),before=structuredClone(now);
  delete before.values.chemicalEnergy;expect(energyResidual(now,before)).toBeNull();
 });
});
