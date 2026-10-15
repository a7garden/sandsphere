import {describe,it,expect} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,MASS_FIELDS,COMMAND_STRIDE,CpuSolver,totalEnthalpy,type Snapshot,type Environment} from '../src/sim/model';
import {AIR_LAYERS,AIR_SPECIES,AIR_FIELDS,ATMOSPHERE_MIRRORS} from '../src/sim/layeredAtmosphere';
import {buoyancyAcceleration,surfaceExchangeSpeed} from '../src/sim/buoyancy';
import {elementalMass,ATOMIC_MASS,type Element} from '../src/sim/chemistry';
import {GASES} from '../src/sim/gases';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {plumeScenario} from './helpers/plumeScenario';
const grid=createSphere(0),empty=new Float32Array(grid.count*COMMAND_STRIDE);
function inventory(s:CpuSolver){const stock=new Float64Array(STRIDE);for(let i=0;i<grid.count;i++)for(const f of MASS_FIELDS)if(!(ATMOSPHERE_MIRRORS as readonly number[]).includes(f))stock[f]+=s.state[i*STRIDE+f];const a=s.climate.air;for(let q=0;q<a.temperature.length;q++){for(let f=0;f<AIR_SPECIES;f++)stock[AIR_FIELDS[f]]+=a.mass[q*AIR_SPECIES+f];stock[F.airborneDust]+=a.dustMass[q];}return stock;}
function run(layout:'vertical'|'lateral'|'separated'='vertical',control:'normal'|'source-off'|'flow-off'='normal',dt=1/30,seconds=4){
 const initial=plumeScenario(grid,layout),solver=new CpuSolver(grid,initial.state);solver.climate.restore(initial.climate);const air=solver.climate.air;
 const internal=air as unknown as {dynamics(dt:number,e:Environment):void;burnGas(q:number,dt:number):void},burn=internal.burnGas.bind(air);
 if(control==='flow-off')internal.dynamics=()=>{};
 let targetBurn=0,offSourceSootBurn=0,oxygenArrived=0,sootHigh=0,wind=0,lift=0,external=0,correction=0;const before=inventory(solver),h=totalEnthalpy(solver.state,solver.climate),lost=new Float64Array(STRIDE);
 // Observe actual local consumption, so transported CO₂ cannot masquerade as
 // remote ignition. Ablations exist only in this test, never in game physics.
 internal.burnGas=(q,step)=>{const fuel=air.mass[q*AIR_SPECIES+2],carbon=air.mass[q*AIR_SPECIES+8];if(q===initial.target)oxygenArrived=Math.max(oxygenArrived,air.mass[q*AIR_SPECIES+6]);if(!(control==='source-off'&&q===0))burn(q,step);if(q===initial.target)targetBurn+=fuel-air.mass[q*AIR_SPECIES+2];if(q!==0)offSourceSootBurn+=Math.max(0,carbon-air.mass[q*AIR_SPECIES+8]);};
 for(let n=0;n<Math.round(seconds/dt);n++){
  solver.advance(dt,empty,initial.environment);external+=solver.energyChanges.reduce((a,b)=>a+b);correction+=solver.energyChanges.filter((_,i)=>i%4===3).reduce((a,b)=>a+b);
  for(let i=0;i<grid.count;i++)for(let k=0;k<GASES.length;k++)lost[GASES[k].field]+=solver.escapeCells[i*GASES.length+k];
  sootHigh=Math.max(sootHigh,air.mass[2*AIR_SPECIES+8]);wind=Math.max(wind,...air.velocity.map(Math.abs));lift=Math.max(lift,...air.updraft);
 }
 const after=inventory(solver);for(let f=0;f<STRIDE;f++)after[f]+=lost[f];const a=elementalMass(before),b=elementalMass(after);
 const massResidual=after.reduce((a,b)=>a+b)-before.reduce((a,b)=>a+b),energyResidual=totalEnthalpy(solver.state,solver.climate)-h-external;
 expect(Math.abs(massResidual)).toBeLessThan(2e-6);for(const key of Object.keys(ATOMIC_MASS) as Element[])expect(Math.abs(a[key]-b[key]),key).toBeLessThan(2e-6*Math.max(1,a[key]));
 expect(Math.abs(energyResidual)).toBeLessThan(.01);expect(Math.abs(correction)/Math.max(1,Math.abs(h))).toBeLessThan(5e-6);
 return {solver,initial,targetBurn,offSourceSootBurn,oxygenArrived,sootHigh,wind,lift,massResidual,energyResidual,correction};
}
describe('combustion, buoyancy and reactive transport',()=>{
 it('uses the same buoyancy contrast for warm air and finite surface exchange',()=>{
  expect(buoyancyAcceleration(400,300,9.81)).toBeCloseTo(3.27,12);expect(buoyancyAcceleration(200,300,9.81)).toBeLessThan(0);
  expect(surfaceExchangeSpeed(0,300,300,500,9.81)).toBe(1);expect(surfaceExchangeSpeed(0,400,300,500,9.81)).toBeGreaterThan(1);expect(surfaceExchangeSpeed(0,400,300,500,0)).toBe(1);
 });
 it('turns source combustion into rising oxygen/soot transport and ignition in an initially sub-ignition layer',()=>{
  const fire=run(),noSource=run('vertical','source-off'),noFlow=run('vertical','flow-off'),separated=run('separated');
  expect(fire.targetBurn).toBeGreaterThan(.001);expect(fire.offSourceSootBurn).toBeGreaterThan(1e-6);expect(fire.oxygenArrived).toBeGreaterThan(.001);expect(fire.sootHigh).toBeGreaterThan(.0001);expect(fire.lift).toBeGreaterThan(noSource.lift);expect(fire.wind).toBeGreaterThan(noSource.wind);
  expect(noSource.targetBurn).toBe(0);expect(noFlow.targetBurn).toBe(0);expect(noFlow.oxygenArrived).toBe(0);expect(noFlow.sootHigh).toBe(0);expect(separated.targetBurn).toBe(0);
 });
 it('supplies oxygen to preheated fuel in a neighboring column, with no seeded wind',()=>{
  const fire=run('lateral'),noSource=run('lateral','source-off'),noFlow=run('lateral','flow-off');
  expect(fire.initial.target).toBeGreaterThan(AIR_LAYERS);expect(fire.targetBurn).toBeGreaterThan(2e-6);expect(fire.targetBurn).toBeGreaterThan(noSource.targetBurn*1.5);expect(noFlow.targetBurn).toBe(0);expect(fire.sootHigh).toBeGreaterThan(0);
 });
 it('keeps the causal result under a halved integration step',()=>{
  const a=run(),b=run('vertical','normal',1/60);expect(b.targetBurn).toBeGreaterThan(.001);expect(Math.abs(b.targetBurn/a.targetBurn-1)).toBeLessThan(.05);expect(Math.abs(b.lift/a.lift-1)).toBeLessThan(.05);
 });
 it('resumes v11/v6 fire with exactly the same stocks, heat, winds and lift',()=>{
  const {solver,initial}=run('vertical','normal',1/30,1),save:Snapshot={version:11,preset:'coast',state:[...solver.state],environment:initial.environment,climate:solver.climate.snapshot(),planet:{primary:'rock'},time:1,supplied:0,removed:0,discoveries:[]};
  const raw=JSON.stringify(save),old=JSON.parse(raw);expect(validSnapshot(old,grid.count)).toBe(true);const upgraded=upgradeSnapshot(old,grid.count);expect(JSON.stringify(old)).toBe(raw);expect(upgraded.state).toEqual(old.state);expect(upgraded.climate).toEqual(old.climate);
  const resumed=new CpuSolver(grid,new Float32Array(upgraded.state));resumed.climate.restore(upgraded.climate);for(let n=0;n<30;n++){solver.advance(1/30,empty,initial.environment);resumed.advance(1/30,empty,initial.environment);}expect(resumed.state).toEqual(solver.state);expect(resumed.climate.snapshot()).toEqual(solver.climate.snapshot());
 });
 it('heats still air by finite, conservative surface exchange without requiring fuel',()=>{
  const p=plumeScenario(grid),solver=new CpuSolver(grid,p.state);solver.climate.restore(p.climate);const air=solver.climate.air;air.detach(solver.state,p.environment);air.temperature[0]=22;solver.state[F.temperature]=800;const h=totalEnthalpy(solver.state,solver.climate),t=solver.state[F.temperature],q=air.temperature[0];
  (air as unknown as {surfaceExchange(s:Float32Array,i:number,dt:number):void}).surfaceExchange(solver.state,0,1);
  expect(air.temperature[0]).toBeGreaterThan(q);expect(solver.state[F.temperature]).toBeLessThan(t);expect(air.temperature[0]).toBeLessThan(solver.state[F.temperature]);const correction=air.checkpoint().roundoff.reduce((a,b)=>a+b);expect(Math.abs(totalEnthalpy(solver.state,solver.climate)-h-correction)).toBeLessThan(.01);
 });
});
