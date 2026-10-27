import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {CpuSolver,F,STRIDE,seedPlanet,totalEnthalpy,totalMass,type Environment,type Snapshot} from '../src/sim/model';
import {createSphere,type SphereGrid} from '../src/sim/sphere';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {createCommandBatch} from '../src/sim/supply';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {BackgroundWorlds,type PlanetRecord} from '../src/sim/system';
import {PHYSICS_DT,SimulationClock} from '../src/sim/clock';
import {frameExecution,runFrameSteps,takeFrameSteps} from '../src/sim/frameExecution';
import {MIN_THERMODYNAMIC_TEMPERATURE} from '../src/sim/thermodynamics';
import {atmosphereState} from '../src/sim/atmosphere';
import {WorkerSolver} from '../src/sim/workerSolver';
import {resultTransferBuffers,type SolverWorkerReply,type SolverWorkerRequest} from '../src/sim/solverWorkerProtocol';
import {snapshotSurface} from '../src/sim/session';

// Opt-in audit receipts: assertions deliberately document observed limitations,
// rather than turning these confirmed defects into acceptance claims.
const root=`artifacts/reaudit19/reruns/${Date.now()}-${process.pid}/execution`,grid=createSphere(0);
const paths=['src/main.ts','src/sim/model.ts','src/sim/system.ts','src/sim/session.ts','src/sim/storage.ts','src/sim/frameExecution.ts','src/sim/atmosphere.ts','src/sim/workerSolver.ts','src/sim/solver.worker.ts','src/sim/solverWorkerProtocol.ts','src/sim/weatherClimate.ts','src/sim/layeredAtmosphere.ts','src/sim/oceanDynamics.ts'];
const hashes=()=>Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const startHashes=hashes();
function receipt(name:string,value:unknown){mkdirSync(root,{recursive:true});writeFileSync(`${root}/${name}.json`,JSON.stringify({name,value,sourceHashes:startHashes},null,2));expect(hashes()).toEqual(startHashes);}
const environment=():Environment=>({ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true,orbitDistance:1,orbitAngle:0,body:sandboxDefinition('rock')});
function world(temperature=20){return new CpuSolver(grid,seedPlanet(grid,'rock',temperature,'nitrogen'));}
function snapshot(solver:CpuSolver,e=environment()):Snapshot{return {version:11,preset:'coast',planet:{primary:'rock'},state:[...solver.state],climate:solver.climate.snapshot(),time:0,environment:structuredClone(e),supplied:0,removed:0,discoveries:[],spin:{angle:0,running:true,period:120,tilt:0}};}
function failure(operation:()=>void){try{operation();return null;}catch(error){return error instanceof Error?error.message:String(error);}}

// Only the message transport is controlled. Every requested step executes the
// production CpuSolver against transferred typed checkpoints, not a second law.
class ControlledCpuWorker {
 static latest:ControlledCpuWorker;
 onmessage:((event:{data:SolverWorkerReply})=>void)|null=null;
 onerror:((event:{message:string;preventDefault:()=>void})=>void)|null=null;
 onmessageerror:(()=>void)|null=null;
 grid:SphereGrid|null=null;request:Extract<SolverWorkerRequest,{type:'step'}>|null=null;
 constructor(){ControlledCpuWorker.latest=this;}
 postMessage(request:SolverWorkerRequest,transfer:Transferable[]=[]){
  const copy=structuredClone(request,{transfer});
  if(copy.type==='init'){this.grid=copy.grid;queueMicrotask(()=>this.onmessage?.({data:{id:copy.id,type:'ready',backend:'CPU'}}));}
  else this.request=copy;
 }
 async complete(){
  const request=this.request!,cpu=new CpuSolver(this.grid!,request.state);
  cpu.climate.restoreCheckpoint(request.climate);cpu.climate.lift.set(request.lift);
  await cpu.step(request.dt,request.commands,request.environment);
  const result={state:cpu.state,climate:cpu.climate.checkpoint(),lift:cpu.climate.lift,escapeCells:cpu.escapeCells,condensedCells:cpu.condensedCells,precipitatedCells:cpu.precipitatedCells,energyChanges:cpu.energyChanges,feedingCells:cpu.feedingCells};
  this.onmessage?.({data:structuredClone({id:request.id,type:'result',result},{transfer:resultTransferBuffers(result)})});
 }
 terminate(){}
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe.skipIf(process.env.REAUDIT19_EXECUTION!=='1')('alpha19 execution audit of alpha18 bytes',()=>{
 it('records the admitted cold aggregate boundary that cannot initialize or accept a heating rescue',()=>{
  const solver=world(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE)),e=environment(),saved=JSON.parse(JSON.stringify(snapshot(solver,e))) as Snapshot;
  const valid=validSnapshot(saved,grid.count),loaded=upgradeSnapshot(saved,grid.count),resumed=new CpuSolver(grid,new Float32Array(loaded.state));resumed.climate.restore(loaded.climate);
  const before=snapshot(resumed,e),commands=createCommandBatch(grid.count),empty=createCommandBatch(grid.count);
  const normalFailure=failure(()=>resumed.advance(PHYSICS_DT,empty,e));commands[4]=1e6;
  const heatingFailure=failure(()=>resumed.advance(0,commands,e));
  receipt('cold-admission',{status:'confirmed-admission-runtime-gap',valid,temperature:saved.state[F.temperature],nitrogen:saved.state[F.nitrogen],normalFailure,heatingFailure,unchanged:JSON.stringify(snapshot(resumed,e))===JSON.stringify(before),scope:'Exact admitted Float32 lower boundary of aggregate gas; alpha18 docs explicitly declare rejection when no placement energy exists.'});
  expect(valid).toBe(true);expect(normalFailure).toContain('높이에 배치할 열에너지 재고');expect(heatingFailure).toBe(normalFailure);expect(snapshot(resumed,e)).toEqual(before);
 });

 it('records synchronous background clock mutation on the same valid rejected save and async isolation',async()=>{
  const saved=snapshot(world(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE))),before=structuredClone(saved),planet:PlanetRecord={id:'planet-cold',name:'Cold',snapshot:saved};
  expect(validSnapshot(saved,grid.count)).toBe(true);
  const error=failure(()=>new BackgroundWorlds(grid).step([planet],'planet-other',PHYSICS_DT));
  const asyncPlanet:PlanetRecord={id:'planet-cold',name:'Cold',snapshot:structuredClone(before)},failures:string[]=[];
  vi.spyOn(console,'warn').mockImplementation(()=>{});
  await new BackgroundWorlds(grid,async state=>new CpuSolver(grid,state)).stepAsync([asyncPlanet],'planet-other',PHYSICS_DT,undefined,(_,error)=>failures.push(String(error)));
  receipt('background-failure',{status:'confirmed-sync-rollback-defect',error,beforeTime:before.time,afterSyncTime:saved.time,beforeOrbit:before.environment.orbitAngle,afterSyncOrbit:saved.environment.orbitAngle,beforeSpin:before.spin!.angle,afterSyncSpin:saved.spin!.angle,sameSyncMatter:JSON.stringify(saved.state)===JSON.stringify(before.state),asyncTime:asyncPlanet.snapshot.time,asyncOrbit:asyncPlanet.snapshot.environment.orbitAngle,asyncPaused:asyncPlanet.snapshot.paused,asyncFailures:failures,scope:'Production BackgroundWorlds.step is offline/science synchronous path. Live stepAsync is separately verified to keep last committed time/orbit and pause failed world.'});
  expect(error).toContain('높이에 배치할 열에너지 재고');expect(saved.time).toBe(PHYSICS_DT);expect(saved.environment.orbitAngle).not.toBe(before.environment.orbitAngle);expect(saved.state).toEqual(before.state);expect(asyncPlanet.snapshot.time).toBe(before.time);expect(asyncPlanet.snapshot.environment).toEqual(before.environment);expect(asyncPlanet.snapshot.paused).toBe(true);
 });

 it('records the artificial 1 K bulk thermometer floor for valid sub-kelvin canonical air',()=>{
  const solver=world(-273.139),e=environment();solver.advance(PHYSICS_DT,createCommandBatch(grid.count),e);
  const saved=snapshot(solver,e),observation=atmosphereState(solver.state,e,solver.climate);
  const air=solver.climate.air;let mass=0,weighted=0;
  for(let q=0;q<air.temperature.length;q++){const nitrogen=air.mass[q*9+1];mass+=nitrogen;weighted+=nitrogen*air.temperature[q];}
  const expected=weighted/mass;
  receipt('subkelvin-observation',{status:'confirmed-observation-floor',validSnapshot:validSnapshot(saved,grid.count),canonicalMoleMeanCelsius:expected,reportedCelsius:observation.temperature,canonicalKelvin:expected+273.15,reportedKelvin:observation.temperature+273.15,scaleHeightInflation:(observation.temperature+273.15)/(expected+273.15),scope:'Nitrogen-only gas, hence mass and mole weighted means coincide; numerical display floor is separate from the declared isothermal geometry approximation.'});
  expect(validSnapshot(saved,grid.count)).toBe(true);expect(expected+273.15).toBeLessThan(.02);expect(observation.temperature).toBe(-272.15);expect(observation.temperature-expected).toBeGreaterThan(.98);
 });

 it('keeps committed checkpoints coherent across controlled worker transfer, JSON resume and camera hold',async()=>{
  const e=environment(),direct=world(20),commands=createCommandBatch(grid.count);commands[1]=2.00000000001;commands[4]=10;
  vi.stubGlobal('Worker',ControlledCpuWorker);const worker=(await WorkerSolver.create(grid,direct.state,true))!;
  const activity={paused:false,operation:false,awaitingCreation:false,placementOpen:false,modeOpen:false,busy:false,cameraDragging:true};
  const clock=new SimulationClock();let advances=0;
  for(let n=0;n<12;n++){
   const batch=n===0?commands:createCommandBatch(grid.count),before=worker.state.slice(),checkpoint=worker.climate.checkpoint(),step=worker.step(PHYSICS_DT,batch,e);
   expect(worker.state).toEqual(before);expect(worker.climate.checkpoint()).toEqual(checkpoint);
   direct.advance(PHYSICS_DT,batch,e);await ControlledCpuWorker.latest.complete();await step;
   expect(worker.state).toEqual(direct.state);expect(worker.climate.checkpoint()).toEqual(direct.climate.checkpoint());expect(worker.energyChanges).toEqual(direct.energyChanges);
   const count=takeFrameSteps(clock,PHYSICS_DT,1,1,activity);await runFrameSteps(count,async()=>{advances++;},async()=>{});
  }
  const persisted=JSON.parse(JSON.stringify(snapshot(direct,e))) as Snapshot,resumed=new CpuSolver(grid,new Float32Array(persisted.state));resumed.climate.restore(persisted.climate);
  const queued=createCommandBatch(grid.count);queued[6]=.25;const inputBefore=JSON.stringify(snapshot(direct,e)),captured=snapshotSurface(direct.state,queued,[],null,direct.climate,e);
  expect(JSON.stringify(snapshot(direct,e))).toBe(inputBefore);direct.advance(0,queued,e);resumed.advance(0,queued,e);
  expect(captured.state).toEqual(direct.state);expect(captured.climate).toEqual(direct.climate.snapshot());expect(resumed.state).toEqual(direct.state);expect(resumed.climate.snapshot()).toEqual(direct.climate.snapshot());
  receipt('worker-session-camera',{status:'pass',steps:12,advances,backlog:clock.backlog,cameraPolicy:frameExecution(activity),exactWorkerCPU:true,exactJSONResume:true,nonmutatingPendingPreview:true,mass:totalMass(direct.state,direct.climate),energy:totalEnthalpy(direct.state,direct.climate),scope:'Controlled structured-clone transport over production CPU. Native Worker scheduling, WebGPU and actual-game UI remain parent-owned/unverified here.'});worker.dispose();
  expect(advances).toBe(12);expect(clock.backlog).toBeCloseTo(0,14);
 });

 it('accounts external gravity work without inventing air potential heat when its mesh rescales',()=>{
  const solver=world(20),e=environment(),commands=createCommandBatch(grid.count);commands[4]=1;solver.advance(0,commands,e);
  const before=totalEnthalpy(solver.state,solver.climate),airBefore=solver.climate.air.totalEnergy(),heightBefore=solver.climate.air.height(0);
  const edited=structuredClone(e);edited.gravity=2;edited.body!.surfaceGravity=19.62;
  commands[4]=1e-9;solver.advance(0,commands,edited);
  const after=totalEnthalpy(solver.state,solver.climate),external=solver.energyChanges.reduce((sum,v,i)=>sum+(i%4===1?v:0),0),numeric=solver.energyChanges.reduce((sum,v,i)=>sum+(i%4===3?v:0),0);
  // The public external-energy ledger is Float32. Bound its own projection
  // quantum explicitly instead of claiming a zero absolute conservation error.
  const ledgerProjectionBound=solver.energyChanges.reduce((sum,v,i)=>sum+(i%4===1?Math.abs(v)*2**-23:0),0);
  receipt('gravity-edit',{status:'pass-with-measured-ledger-projection',before,after,external,numeric,residual:after-before-external-numeric,ledgerProjectionBound,airEnergyChange:solver.climate.air.totalEnergy()-airBefore,heightBefore,heightAfter:solver.climate.air.height(0),validAfter:validSnapshot(snapshot(solver,edited),grid.count),scope:'Zero-time explicit environment edit of ordinary air; fixed-bed potential work is external, pressure-coordinate air g*z stays invariant. Runtime radius/body editing has no UI control and is not exhaustively audited. First diagnostic run used an ungrounded 1e-7 absolute ledger tolerance and failed; this explicit bound derives from the Float32 ledger representation.'});
  expect(Math.abs(after-before-external-numeric)).toBeLessThan(ledgerProjectionBound);expect(solver.climate.air.totalEnergy()).toBe(airBefore);expect(solver.climate.air.height(0)).toBe(heightBefore/2);expect(validSnapshot(snapshot(solver,edited),grid.count)).toBe(true);
 });
});
