import {describe,it,expect} from 'vitest';
import {packSave,unpackSave,encodeSaveBytes,decodeSaveBytes,SAVE_RAW_LIMIT} from '../src/sim/saveCodec';
import {decodeSave} from '../src/account/firebase';
import {createSphere} from '../src/sim/sphere';
import {CpuSolver,COMMAND_STRIDE,emptyStock,seedWorld} from '../src/sim/model';
import {createJupiterPlanet} from '../src/sim/planetCreation';
import {migrateWorld,prepareSystemSave,type SystemSave} from '../src/sim/system';
import {TelemetryStore} from '../src/sim/telemetry';
import {archiveTelemetry} from '../src/sim/telemetryPersistence';
import {orbitalEnvironment} from '../src/sim/orbit';
import {sandboxDefinition} from '../src/sim/planetDefinition';

describe('lossless save transport',()=>{
 it('preserves Float64 carries, subnormals, both zero signs, vectors and metadata',async()=>{
  const values=Array.from({length:32},(_,i)=>i%3===0?-0:i%3===1?Number.MIN_VALUE:Math.PI+i/7),value={a:-0,v:values,small:[-0,Math.PI],label:'낮과 밤',record:Object.fromEntries(Array.from({length:32},(_,i)=>['field'+i,i%3===0?null:i%3===1?-0:Math.PI]))};
  expect(unpackSave(packSave(value))).toEqual(value);
  expect(await decodeSaveBytes(await encodeSaveBytes(value))).toEqual(value);
 });
 it('reads legacy JSON gzip and rejects truncated, corrupt and excessive transport',async()=>{
  const grid=createSphere(0),system=migrateWorld({version:4,preset:'coast',time:0,state:[...seedWorld(grid)],discoveries:[],environment:{ambient:18,sunlight:1,sun:[0,1,0]},supplied:0,removed:0},grid.count);
  const legacy=await new Response(new Blob([JSON.stringify(system)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  expect(await decodeSave(legacy,grid.count)).toEqual(system);
  const raw=packSave({values:Array(32).fill(Math.PI)});
  expect(()=>unpackSave(raw.subarray(0,raw.length-1))).toThrow();
  const corrupt=raw.slice();new DataView(corrupt.buffer).setUint32(16,0xffffffff,true);expect(()=>unpackSave(corrupt)).toThrow();
  const bytes=await encodeSaveBytes(system);bytes[bytes.length-2]^=255;await expect(decodeSaveBytes(bytes)).rejects.toThrow();
  expect(()=>packSave({values:new Float64Array(SAVE_RAW_LIMIT/8+1).fill(Math.PI)})).toThrow();
 });
 for(const kind of ['giant','wet'] as const)it(`fits progressed eight full-resolution ${kind} planets with telemetry in unchanged budgets and resumes exact state`,async()=>{
  const grid=createSphere(4),created=kind==='giant'?createJupiterPlanet(grid):{state:seedWorld(grid,'coast',22),environment:{...orbitalEnvironment(1),climate:true,body:sandboxDefinition('rock',1,1)},climate:undefined},solver=new CpuSolver(grid,created.state),commands=new Float32Array(grid.count*COMMAND_STRIDE);solver.climate.restore(created.climate);
  for(let step=0;step<14;step++)solver.advance(1/30,commands,created.environment);
  const snapshot={version:11 as const,preset:'coast' as const,state:[...solver.state],climate:solver.climate.snapshot(),environment:created.environment,time:14/30,supplied:0,removed:0,discoveries:[]};
  const planets=Array.from({length:4},(_,i)=>({id:'planet-'+i,name:'Giant '+i,snapshot:structuredClone(snapshot)})),store=new TelemetryStore();
  for(const planet of planets)store.sample(planet.id,planet.name,{...snapshot,directions:grid.directions,state:solver.state,escaped:0,transferredIn:0,transferredOut:0});
  const telemetry=archiveTelemetry(store,planets.map(p=>({id:p.id,name:p.name,input:{...p.snapshot,directions:grid.directions,state:solver.state,escaped:0,transferredIn:0,transferredOut:0}})));
  // A full recorder history must survive too; no points or detail arrays are discarded.
  for(const record of telemetry.planets){const point=structuredClone(record.points[0]);record.points=Array.from({length:2048},(_,i)=>({...structuredClone(point),time:i/2047*snapshot.time}));record.baseline=record.points[0];record.lastSample=snapshot.time;}
  const world={activeId:'planet-0',planets,stock:emptyStock(),telemetry},system=prepareSystemSave({version:3,mode:'sandbox',...world,other:structuredClone(world),savedAt:1} as SystemSave,grid.count);
  const packed=packSave(system),bytes=await encodeSaveBytes(system),decoded=await decodeSave(bytes.buffer,grid.count);
  console.log('progressed full-resolution eight-planet save',{kind,rawBytes:packed.length,gzipBytes:bytes.length,telemetryPoints:16384});
  expect(packed.length).toBeLessThan(64*1024*1024);expect(bytes.length).toBeLessThan(20*1024*1024);expect(decoded).toEqual(system);
  const resumed=new CpuSolver(grid,new Float32Array(decoded.planets[0].snapshot.state));resumed.climate.restore(decoded.planets[0].snapshot.climate);
  solver.advance(1/30,commands,created.environment);resumed.advance(1/30,commands,created.environment);
  expect(resumed.state).toEqual(solver.state);expect(resumed.climate.snapshot()).toEqual(solver.climate.snapshot());solver.dispose();resumed.dispose();
 },120000);
});
