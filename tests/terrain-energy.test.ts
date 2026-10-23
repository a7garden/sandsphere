import {describe,it,expect} from 'vitest';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,enthalpy,totalMass,totalEnthalpy} from '../src/sim/model';
import {OceanDynamics,validOcean,oceanEnergy} from '../src/sim/oceanDynamics';
import {createSphere} from '../src/sim/sphere';
import {MIN_THERMODYNAMIC_TEMPERATURE} from '../src/sim/thermodynamics';
import {exactStockTransfer} from '../src/sim/solidMechanics';
import {terrainScenario,TERRAIN_MOUND} from './helpers/terrainScenario';

function fixture(water=0,temperature=20){
 const grid=createSphere(0);for(let i=0;i<grid.count;i++)grid.geometry[i*4+3]=0;
 const j=grid.neighbors[0],a=Array.from(grid.directions.subarray(0,3)),b=Array.from(grid.directions.subarray(j*3,j*3+3)),delta=b.map((v,k)=>v-a[k]),norm=Math.hypot(...delta);
 const ocean=new OceanDynamics(grid,[{i:0,j,distance:.01,t:delta.map(v=>v/norm)}]),s=new Float32Array(grid.count*STRIDE),ledger=new Float32Array(grid.count*4);
 for(let i=0;i<grid.count;i++){s[i*STRIDE+F.rock]=1;s[i*STRIDE+F.temperature]=temperature;}
 s[F.sand]=10;s[j*STRIDE+F.water]=water;ocean.configure(s,9.81);ocean.reconcile(s,ledger);ledger.fill(0);
 const heat=()=>Array.from({length:grid.count},(_,i)=>enthalpy(s,i)).reduce((a,b)=>a+b,0),energy=()=>heat()+ocean.energy(),numerical=()=>ledger.reduce((a,b,i)=>a+(i%4===3?b:0),0);
 return {grid,j,ocean,s,ledger,heat,energy,numerical};
}

describe('finite mixed-bed gravitational work',()=>{
 it('admits complete parcels with exactly equal represented debit and credit',()=>{
  for(const [d,r,q] of [[10,.01,.17],[.001,100,.0001],[1e-20,1e-22,1e-23],[100000,99999,.1]]){
   const donor=Math.fround(d),receiver=Math.fround(r),amount=exactStockTransfer(donor,receiver,q);
   expect(amount).toBeLessThanOrEqual(q);expect(amount).toBeGreaterThanOrEqual(0);
   expect(Math.fround(donor-amount)+Math.fround(receiver+amount)).toBe(donor+receiver);
  }
 });
 it('turns descending bed potential into heat while carrying material enthalpy',()=>{
  const p=fixture(),before=p.energy(),h=p.heat(),mass=totalMass(p.s);p.ocean.transportSolids(p.s,.1,p.ledger);
  expect(p.s[p.j*STRIDE+F.sand]).toBeGreaterThan(0);expect(p.heat()).toBeGreaterThan(h);expect(p.ocean.solidPotential.reduce((a,b)=>a+b)-p.ocean.solidDatum).toBeLessThan(0);
  expect(totalMass(p.s)).toBe(mass);expect(p.energy()-before-p.numerical()).toBeCloseTo(0,9);
 });
 it('does not buy work against a water-loaded receiver with thermal energy',()=>{
  for(const t of [MIN_THERMODYNAMIC_TEMPERATURE,20,4000]){
   const p=fixture(100,t),state=p.s.slice(),h=p.energy();p.ocean.transportSolids(p.s,1e8,p.ledger);
   expect(p.s).toEqual(state);expect(p.energy()).toBe(h);expect(p.numerical()).toBe(0);
  }
 });
 it('admits cold downhill motion without over-drawing the local thermal reservoir',()=>{
  const p=fixture(0,MIN_THERMODYNAMIC_TEMPERATURE),h=p.energy();p.ocean.transportSolids(p.s,1e8,p.ledger);
  expect(p.s[p.j*STRIDE+F.sand]).toBeGreaterThan(0);expect(p.s[F.temperature]).toBeGreaterThanOrEqual(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE));expect(p.s[p.j*STRIDE+F.temperature]).toBeGreaterThanOrEqual(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE));
  expect(p.energy()-h-p.numerical()).toBeCloseTo(0,8);
 });
 it.each([F.sand,F.clay,F.molten,F.charcoal])('transports material %s with its heat, bond energy, and bed work',field=>{
  const p=fixture(0,1800);p.s[F.sand]=0;p.s[field]=10;p.s[F.firing]=20;p.ocean.externalPotential(p.s,p.ledger);p.ledger.fill(0);
  const h=p.energy(),mass=totalMass(p.s),dose=p.s[F.clay]*p.s[F.firing];p.ocean.transportSolids(p.s,.1,p.ledger);
  expect(p.s[p.j*STRIDE+field]).toBeGreaterThan(0);expect(totalMass(p.s)).toBe(mass);expect(p.energy()-h-p.numerical()).toBeCloseTo(0,8);
  if(field===F.clay)expect(p.s[F.clay]*p.s[F.firing]+p.s[p.j*STRIDE+F.clay]*p.s[p.j*STRIDE+F.firing]).toBeCloseTo(dose,5);
 });
 it('introduces the solid coordinate in an existing v2 save without changing stocks, temperature, or total energy',()=>{
  const p=fixture(2),saved=p.ocean.snapshot();saved.version=2;delete saved.solidPotential;delete saved.solidDatum;delete saved.solidReady;
  expect(validOcean(saved,p.grid.count)).toBe(true);const oldEnergy=oceanEnergy(saved),state=p.s.slice();p.ocean.restore(saved);p.ocean.configure(p.s,9.81);
  expect(p.s).toEqual(state);expect(p.ocean.energy()).toBeCloseTo(oldEnergy,12);expect(validOcean(p.ocean.snapshot(),p.grid.count)).toBe(true);
  const next=new OceanDynamics(p.grid,[]);next.restore(JSON.parse(JSON.stringify(p.ocean.snapshot())));expect(next.snapshot()).toEqual(p.ocean.snapshot());
 });
 it('keeps exactly salt-free hydraulic water salt-free through repeated transport',()=>{
  const p=fixture();p.s[F.water]=2;p.s[F.sand]=0;p.ocean.externalPotential(p.s,p.ledger);p.ocean.reconcile(p.s,p.ledger);
  for(let n=0;n<2000;n++)p.ocean.transport(p.s,1/30,1000,p.ledger);
  for(let i=0;i<p.grid.count;i++)expect(p.s[i*STRIDE+F.dissolved]).toBe(0);
 });
 it.each([[false,false],[true,false],[false,true],[true,true]])('runs production bed admission with climate=%s, water loading=%s',(layered,loaded)=>{
  const grid=createSphere(1),p=terrainScenario(grid,layered,loaded),solver=new CpuSolver(grid,p.state),empty=new Float32Array(grid.count*COMMAND_STRIDE),h=totalEnthalpy(solver.state,solver.climate),mass=totalMass(solver.state,solver.climate);
  let energy=0;for(let n=0;n<60;n++){solver.advance(1/30,empty,p.environment);energy+=solver.energyChanges.reduce((a,b)=>a+b,0);}
  if(loaded)expect(solver.state[F.sand]).toBe(TERRAIN_MOUND);else expect(solver.state[F.sand]).toBeLessThan(TERRAIN_MOUND);
  expect(Math.abs(totalMass(solver.state,solver.climate)-mass)).toBeLessThan(.002);expect(Math.abs(totalMass(solver.state,solver.climate)-mass)/mass).toBeLessThan(2e-6);expect(Math.abs(totalEnthalpy(solver.state,solver.climate)-h-energy)/Math.max(1,Math.abs(h))).toBeLessThan(2e-7);
 });
});
