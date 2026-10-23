import {describe,expect,it} from 'vitest';
import {CpuSolver,F,STRIDE,MASS_FIELDS,totals,emptyStock,type Environment,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {createCommandBatch} from '../src/sim/supply';
import {advanceProgress,expeditionStates,freshProgress,observeCampaignPlanets,planetInventory,lifeSampleAvailability} from '../src/sim/progress';
import {BackgroundWorlds,type PlanetRecord} from '../src/sim/system';
import {atmosphereState,REFERENCE_COLUMN_MASS} from '../src/sim/atmosphere';
import {AIR_LAYERS,AIR_SPECIES,COLUMN_KG} from '../src/sim/layeredAtmosphere';
import {frameExecution,takeFrameSteps,runFrameSteps,type FrameActivity} from '../src/sim/frameExecution';
import {SimulationClock,PHYSICS_DT} from '../src/sim/clock';
import {OrbitDisplay,type MotionSnapshot} from '../src/render/orbitDisplay';
import {observedCellStock} from '../src/sim/observations';
import {airInventory} from './helpers/airInventory';
import {stabilityInventory} from './helpers/stabilityScenario';

const grid=createSphere(0),environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:false};
function world(layered=false){
 const state=new Float32Array(grid.count*STRIDE);
 for(let i=0;i<grid.count;i++){state[i*STRIDE+F.rock]=8;state[i*STRIDE+F.nitrogen]=.3;state[i*STRIDE+F.temperature]=20;}
 const solver=new CpuSolver(grid,state),e={...environment,climate:layered};
 if(layered){const commands=createCommandBatch(grid.count);commands[0]=1e-10;solver.advance(0,commands,e);}
 return {solver,e};
}
function planet(solver:CpuSolver,e=environment,id='planet-1'):PlanetRecord{
 const snapshot:Snapshot={version:11,preset:'coast',time:0,state:[...solver.state],climate:solver.climate.snapshot(),environment:structuredClone(e),supplied:0,removed:0,discoveries:[],spin:{angle:0,running:true,period:120}};
 return {id,name:id,snapshot};
}
const activity:FrameActivity={paused:false,operation:false,awaitingCreation:false,placementOpen:false,modeOpen:false,busy:false,cameraDragging:false};

describe('committed observations and camera-independent execution',()=>{
 it('publishes live layer inventory at the water goal without copying or changing persisted climate',()=>{
  const {solver,e}=world(true),p=planet(solver,e),oldClimate=p.snapshot.climate,oldState=p.snapshot.state;
  solver.climate.air.mass.fill(0);solver.climate.air.mass[0]=1.2;solver.climate.air.mass[4]=.04;solver.climate.air.mass[5]=.07;solver.climate.air.attach(solver.state);
  const stock=emptyStock(),progress=freshProgress();
  expect(advanceProgress(progress,[p],stock)).not.toContain('water');
  // The production publisher reads the pair synchronously, retains only the
  // totals vector, and never requests a large climate serialization.
  solver.climate.snapshot=()=>{throw new Error('observations must not serialize climate');};
  const observed=observeCampaignPlanets([p],p.id,solver,0),metrics=expeditionStates(progress,observed,stock).find(s=>s.id==='water')!.metrics;
  expect(metrics.map(m=>m.current)).toEqual([1.2,.04+.07]);expect(advanceProgress(progress,observed,stock)).toContain('water');
  expect(p.snapshot.state).toBe(oldState);expect(p.snapshot.climate).toBe(oldClimate);
  solver.climate.air.mass.fill(0);expect(planetInventory(observed[0])[F.vapor]).toBe(1.2);
 });

 it('uses retained low bits at campaign thresholds, including legacy snapshots without climate',()=>{
  const {solver}=world(),actual=new Float64Array(solver.state);actual[F.vapor]=.999999005;actual[F.cloudIce]=.0999999001;actual[F.glass]=2+.00000001;actual[F.plant]=.01-.000000001;
  solver.state=solver.climate.publishSurface(actual);
  const p=planet(solver),legacy={...p,snapshot:{...p.snapshot,version:3 as const,climate:undefined}},observed=observeCampaignPlanets([p],p.id,solver,0);
  expect(solver.state[F.vapor]).toBeLessThan(1-1e-6);expect(solver.state[F.cloudIce]).toBeLessThan(.1*(1-1e-6));
  expect(advanceProgress(freshProgress(),observed,emptyStock())).toContain('water');
  expect(advanceProgress(freshProgress(),[p],emptyStock())).toContain('water');
  expect(advanceProgress(freshProgress(),[legacy],emptyStock())).not.toContain('water');
  expect(planetInventory(observed[0])[F.glass]).toBe(actual[F.glass]);
  expect(lifeSampleAvailability(freshProgress(),observed,emptyStock())[0].existing).toBe(actual[F.plant]);
  expect(planetInventory(legacy).every(Number.isFinite)).toBe(true);
 });

 it.each([false,true])('mass audit helpers include canonical surface carry without treating temperature as mass (layers=%s)',layered=>{
  const {solver}=world(layered),actual=solver.climate.physicalSurface(solver.state);actual[F.water]=1000-.00001;
  solver.state=solver.climate.publishSurface(actual);
  const canonical=totals(solver.state,solver.climate);
  for(const helper of [airInventory,stabilityInventory]){const measured=helper(solver);for(const f of MASS_FIELDS)expect(measured[f]).toBe(canonical[f]);expect(measured[F.temperature]).toBe(0);expect(measured[F.water]).toBe(actual[F.water]);}
  for(const f of MASS_FIELDS){let columns=0;for(let i=0;i<grid.count;i++)columns+=observedCellStock(solver.state,i,f,solver.climate);expect(columns).toBeCloseTo(canonical[f],12);}
 });

 it.each([false,true])('includes suspended liquid and ice weight in bulk pressure (layers=%s)',layered=>{
  const {solver,e}=world(layered);
  if(layered){const a=solver.climate.air;a.mass.fill(0);a.dustMass.fill(0);a.temperature.fill(20);a.mass[1]=.3;a.mass[4]=.04;a.mass[5]=.06;a.mass[8]=.02;a.dustMass[0]=.01;a.attach(solver.state);}
  else {const actual=new Float64Array(solver.state);actual.fill(0);actual[F.temperature]=20;actual[F.nitrogen]=.3;actual[F.cloud]=.04;actual[F.cloudIce]=.06;actual[F.soot]=.02;actual[F.airborneDust]=.01;solver.state=solver.climate.publishSurface(actual);}
  const info=atmosphereState(solver.state,e,solver.climate),saved=solver.climate.snapshot();
  expect(info.pressure).toBeCloseTo((.3+.04+.06+.02+.01)/(grid.count*REFERENCE_COLUMN_MASS),14);
  expect(atmosphereState(solver.state,e,saved)).toEqual(info);
  if(layered){let load=0;for(let q=0;q<AIR_LAYERS;q++)load+=solver.climate.air.layerMass(q);expect(info.pressure*grid.count*REFERENCE_COLUMN_MASS).toBeCloseTo(load,14);expect(load*COLUMN_KG*9.81).toBeGreaterThan(0);}
 });

 it('keeps fixed steps, background evolution, backlog and orbital display identical throughout a camera drag',async()=>{
  async function run(dragging:boolean){
   const {solver}=world(),p=planet(solver,environment,'planet-2'),planets=[planet(solver),p],backgrounds=new BackgroundWorlds(grid),clock=new SimulationClock(),commands=createCommandBatch(grid.count);
   const a={...activity,cameraDragging:dragging},motion:MotionSnapshot={time:0,environment:structuredClone(environment),paused:false,spin:{angle:0,running:true,period:120}},display=new OrbitDisplay(motion);let steps=0;
   for(let frame=0;frame<120;frame++){
    const policy=frameExecution(a),count=takeFrameSteps(clock,1/60,1,1,a);
    await runFrameSteps(count,async()=>{solver.advance(PHYSICS_DT,commands,environment);steps++;motion.time+=PHYSICS_DT;motion.spin!.angle+=PHYSICS_DT*Math.PI*2/120;},async()=>{backgrounds.step(planets,'planet-1',PHYSICS_DT);});
    display.update({...motion,paused:policy.motionPaused},1/60,1);
   }
   return {state:solver.state,climate:solver.climate.snapshot(),background:p.snapshot,steps,backlog:clock.backlog,spin:display.spin};
  }
  expect(await run(true)).toEqual(await run(false));
  const clock=new SimulationClock();expect(takeFrameSteps(clock,.1,1,1,{...activity,busy:true,cameraDragging:true})).toBe(0);expect(clock.backlog).toBe(.1);
  expect(takeFrameSteps(clock,0,1,4,{...activity,cameraDragging:true})).toBe(3);expect(clock.backlog).toBeCloseTo(0,14);
  expect(frameExecution({...activity,cameraDragging:true})).toEqual({calculate:true,motionPaused:false,refreshSurface:false});
 });

 it('finishes an already accepted active/background batch when a camera drag starts between steps',async()=>{
  let active=0,background=0,dragging=false;
  const clock=new SimulationClock(),count=takeFrameSteps(clock,4*PHYSICS_DT,1,4,activity);
  await runFrameSteps(count,async()=>{active++;dragging=true;},async()=>{background++;expect(frameExecution({...activity,cameraDragging:dragging}).calculate).toBe(true);});
  expect([active,background]).toEqual([4,4]);expect(clock.backlog).toBeCloseTo(0,14);
 });
});
