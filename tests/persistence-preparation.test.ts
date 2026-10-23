import {describe,it,expect,vi} from 'vitest';
import {CpuSolver,F,COMMAND_STRIDE,COMMAND_FIELD,emptyStock,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {createSandboxPlanet} from '../src/sim/planetCreation';
import {snapshotSurface} from '../src/sim/session';
import {TelemetryStore} from '../src/sim/telemetry';
import {preparePersistenceCapture,type PersistenceCapture} from '../src/sim/persistencePreparation';
import {persistenceCaptureTransfers} from '../src/sim/persistencePreparationClient';
import {decodeSave} from '../src/account/firebase';

describe('worker persistence preparation',()=>{
 for(const editing of [false,true])it(`matches committed capture with ${editing?'pending, in-flight and falling inputs':'no pending inputs'}`,async()=>{
  const grid=createSphere(1),created=createSandboxPlanet(grid,'rock',1,1,'nitrogen',1),solver=new CpuSolver(grid,created.state);solver.climate.restore(created.climate);
  const pending=new Float64Array(grid.count*COMMAND_STRIDE),inFlight=new Float64Array(pending.length);if(editing){pending[COMMAND_FIELD.sand]=.0123456789012345;inFlight[COMMAND_STRIDE+COMMAND_FIELD.water]=.543210987654321;}
  const falling=editing?[{index:2,material:'sand' as const,amount:.013579}]:[];
  const metadata={version:11 as const,preset:'coast' as const,planet:{primary:'rock' as const},time:0,environment:created.environment,discoveries:[],supplied:2,removed:0,escaped:0,transferredIn:0,transferredOut:0,savedAt:20,paused:true};
  const store=new TelemetryStore();store.sample('planet-a','A',{...metadata,directions:grid.directions,state:solver.state,climate:solver.climate.snapshot()});
  const input:PersistenceCapture={grid,system:{version:3,mode:'sandbox',activeId:'planet-a',stock:emptyStock(),savedAt:21},planets:[{id:'planet-a',name:'A',metadata,state:[],climate:undefined,typed:false}],active:{metadata,state:solver.state.slice(),climate:solver.climate.checkpoint(),pending:pending.slice(),inFlight:inFlight.slice(),falling},telemetry:store.planets,otherRevision:0};
  const baseline=solver.climate.snapshot(),expected=snapshotSurface(solver.state,pending,falling,inFlight,solver.climate,created.environment);
  const prepared=await preparePersistenceCapture(input),decoded=await decodeSave(prepared.bytes.buffer,grid.count),actual=decoded.planets[0].snapshot;
  expect(actual.state).toEqual(Array.from(expected.state));expect(actual.climate).toEqual(expected.climate);expect(actual.removed).toBe(expected.pendingRemoved);expect(decoded.telemetry?.planets[0].points).toHaveLength(1);expect(solver.climate.snapshot()).toEqual(baseline);expect(solver.state.byteLength).toBeGreaterThan(0);
  solver.dispose();
 });
 it('transfers only owned capture buffers and leaves live grid and telemetry attached',()=>{
  const grid=createSphere(0),created=createSandboxPlanet(grid,'rock',1,1,'nitrogen',1),solver=new CpuSolver(grid,created.state);solver.climate.restore(created.climate);
  const metadata={version:11 as const,preset:'coast' as const,time:0,environment:created.environment,discoveries:[],supplied:0,removed:0};
  const store=new TelemetryStore();store.sample('planet-a','A',{...metadata,state:solver.state,escaped:0,transferredIn:0,transferredOut:0});
  const input:PersistenceCapture={grid,system:{version:3,mode:'sandbox',activeId:'planet-a',stock:emptyStock(),savedAt:1},planets:[],active:{metadata,state:solver.state.slice(),climate:solver.climate.checkpoint(),pending:new Float64Array(grid.count*COMMAND_STRIDE),falling:[]},telemetry:store.planets,otherRevision:0};
  const transferred=structuredClone(input,{transfer:persistenceCaptureTransfers(input)});
  expect(input.active.state.byteLength).toBe(0);expect(transferred.active.state.byteLength).toBe(solver.state.byteLength);expect(solver.state.byteLength).toBeGreaterThan(0);expect(grid.directions.byteLength).toBeGreaterThan(0);expect(store.planets.get('planet-a')!.energy.byteLength).toBe(32);solver.dispose();
 });
 it('marks telemetry samples, zero-time energy edits, baseline resets and metadata edits dirty',()=>{
  const grid=createSphere(0),created=createSandboxPlanet(grid,'rock',1,1,'nitrogen',1),store=new TelemetryStore(),input={time:0,state:created.state,environment:created.environment,supplied:0,removed:0,escaped:0,transferredIn:0,transferredOut:0};
  expect(store.revision).toBe(0);store.sample('planet-a','A',input);expect(store.revision).toBe(1);
  store.sample('planet-a','A',input);expect(store.revision).toBe(1);
  store.step('planet-a',0,new Float64Array([0,1,0,0]),new Float64Array(grid.count*2));expect(store.revision).toBe(2);
  store.externalEnergy('planet-a',[0,1,0,0]);store.reset('planet-a');store.changed();expect(store.revision).toBe(5);
 });
 it('reconciles a public projection edit without changing the live residual or unchanged fields',()=>{
  const grid=createSphere(0),created=createSandboxPlanet(grid,'rock',1,1,'nitrogen',1),solver=new CpuSolver(grid,created.state);solver.climate.restore(created.climate);
  const actual=solver.climate.physicalSurface(solver.state);actual[F.water]=1000+1e-6;solver.replace(solver.climate.publishSurface(actual));
  expect(solver.climate.air.surfaceProjectionUnchanged(solver.state)).toBe(true);
  const before=solver.climate.checkpoint();solver.state[F.water]=999;const projection=solver.state.slice();
  expect(before.surfaceMassCarry[F.water]).not.toBe(0);expect(solver.climate.air.surfaceProjectionUnchanged(solver.state)).toBe(false);
  const result=snapshotSurface(solver.state,new Float64Array(grid.count*COMMAND_STRIDE),[],null,solver.climate,created.environment);
  expect(result.state[F.water]).toBe(999);expect(result.climate!.surfaceMassCarry![F.water]).toBe(0);expect(solver.state).toEqual(projection);expect(solver.climate.checkpoint()).toEqual(before);
  const resumed=new CpuSolver(grid,result.state);resumed.climate.restore(result.climate);expect(resumed.climate.physicalSurface(resumed.state)[F.water]).toBe(999);solver.dispose();resumed.dispose();
 });
 it('skips zero-duration physics reconstruction for an unchanged published surface',()=>{
  const grid=createSphere(0),created=createSandboxPlanet(grid,'rock',1,1,'nitrogen',1),solver=new CpuSolver(grid,created.state);solver.climate.restore(created.climate);
  const snapshot=solver.climate.snapshot(),restore=vi.spyOn(solver.climate,'restore'),result=snapshotSurface(solver.state,new Float64Array(grid.count*COMMAND_STRIDE),[],null,solver.climate,created.environment);
  expect(result.state).toEqual(solver.state);expect(result.state).not.toBe(solver.state);expect(result.climate).toEqual(snapshot);expect(restore).not.toHaveBeenCalled();solver.dispose();
 });
});
