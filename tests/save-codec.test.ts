import {writeFileSync} from 'node:fs';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {packSave,unpackSave} from '../src/sim/saveCodec';
import {loadRecord,saveSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {encodeSave,decodeSave} from '../src/account/firebase';
import {createSphere} from '../src/sim/sphere';
import {createJupiterPlanet} from '../src/sim/planetCreation';
import {CpuSolver,COMMAND_STRIDE,emptyStock,type Snapshot} from '../src/sim/model';
import {migrateWorld,prepareSystemSave,validSystem} from '../src/sim/system';
import {TelemetryStore} from '../src/sim/telemetry';
import {fullTelemetryArchive,type SavedPlanetTelemetry} from '../src/sim/telemetryPersistence';

afterEach(()=>vi.unstubAllGlobals());
describe('lossless persistence payload',()=>{
 it('preserves Float64 arrays, signed zero and restart caches without modifying inputs',()=>{
  const values=Array.from({length:96},(_,i)=>i===0?-0:i===1?Number.MIN_VALUE:i===2?Number.MAX_VALUE:Math.sin(i)*1e-200);
  const original={values,nested:{cache:values.slice(),name:'행성 01'},metadata:[1,2,3]},before=structuredClone(original);
  const result=unpackSave(packSave(original)) as typeof original;
  expect(result).toEqual(before);expect(original).toEqual(before);expect(Object.is(result.values[0],-0)).toBe(true);
  expect(result.values).not.toBe(original.values);
 });
 it('retains the first binary envelope and restores shared numeric record keys and null values',()=>{
  const metadata=new TextEncoder().encode(JSON.stringify({values:{$sandsphereFloat64:[0,32]}})),start=16+Math.ceil(metadata.length/8)*8,legacy=new ArrayBuffer(start+32*8),bytes=new Uint8Array(legacy),view=new DataView(legacy);
  bytes.set([83,65,78,68,83,86,48,49]);view.setUint32(8,metadata.length,true);view.setUint32(12,32,true);bytes.set(metadata,16);for(let i=0;i<32;i++)view.setFloat64(start+i*8,i/7,true);
  expect(unpackSave(legacy)).toEqual({values:Array.from({length:32},(_,i)=>i/7)});
  const values=Object.fromEntries(Array.from({length:80},(_,i)=>['metric'+i,i%9===0?null:Math.sin(i)])),value={points:Array.from({length:10},()=>({values:{...values}}))};expect(unpackSave(packSave(value))).toEqual(value);
 });
 it('reads the legacy UTF-8 JSON payload and rejects corrupt binary bounds',()=>{
  expect(unpackSave(new TextEncoder().encode('{"version":3,"name":"한글"}').buffer)).toEqual({version:3,name:'한글'});
  const packed=packSave({values:Array(64).fill(1)});
  expect(()=>unpackSave(packed.slice(0,packed.byteLength-1))).toThrow('크기');
  const bad=packSave({values:{$sandsphereFloat64:[999999,64]}});
  expect(()=>unpackSave(bad)).toThrow('범위');
 });
 it('reads old gzip JSON cloud saves through the current decoder',async()=>{
  const grid=createSphere(0),state=Array(grid.count*40).fill(0);for(let i=0;i<grid.count;i++)state[i*40+8]=20;
  const system=migrateWorld({version:4,preset:'coast',state,time:0,supplied:0,removed:0,discoveries:[],environment:{ambient:20,sunlight:1,sun:[0,1,0]}},grid.count);
  const gzip=await new Response(new Blob([JSON.stringify(system)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  expect(await decodeSave(gzip,grid.count)).toEqual(system);
 });
 it('stores packed systems and their companion atomically while reading legacy IDB objects',async()=>{
  const records=new Map<string,unknown>(),writes:string[][]=[];
  const db={close:vi.fn(),transaction:()=>{const batch:string[]=[];writes.push(batch);const tx={oncomplete:null as null|(()=>void),objectStore:()=>({put:(value:unknown,key:string)=>{records.set(key,structuredClone(value));batch.push(key);queueMicrotask(()=>tx.oncomplete?.());},get:(key:string)=>{const req={result:records.get(key),onsuccess:null as null|(()=>void)};queueMicrotask(()=>req.onsuccess?.());return req;}})};return tx;}};
  vi.stubGlobal('indexedDB',{open:()=>{const req={result:db,onsuccess:null as null|(()=>void)};queueMicrotask(()=>req.onsuccess?.());return req;}});
  const system={version:3,planets:[{values:Array.from({length:64},(_,i)=>i/7)}]};
  await saveSnapshot(system,'test',{slot:'test-base',value:{savedAt:3}});
  expect(records.get('test')).toBeInstanceOf(ArrayBuffer);expect(writes[0]).toEqual(['test-base','test']);expect(await loadRecord('test')).toEqual(system);
  records.set('old',system);expect(await loadRecord('old')).toEqual(system);expect(await loadRecord('missing')).toBeUndefined();
 });
 it('round-trips eight evolved full-resolution giants within the unchanged cloud limits and resumes exactly',async()=>{
  const grid=createSphere(4),p=createJupiterPlanet(grid),solver=new CpuSolver(grid,p.state),commands=new Float32Array(grid.count*COMMAND_STRIDE);solver.climate.restore(p.climate);
  for(let n=0;n<14;n++)solver.advance(1/30,commands,p.environment);
  const snapshot:Snapshot={version:11,preset:'coast',state:[...solver.state],climate:solver.climate.snapshot(),environment:p.environment,time:14/30,supplied:0,removed:0,discoveries:[]};
  const world={activeId:'planet-0',planets:Array.from({length:4},(_,i)=>({id:'planet-'+i,name:'Evolved '+i,snapshot:structuredClone(snapshot)})),stock:emptyStock()};
  const system=prepareSystemSave({version:3,mode:'sandbox',...world,other:structuredClone(world),savedAt:1},grid.count);
  expect(validSystem(system,grid.count)).toBe(true);const packed=packSave(system),blob=await encodeSave(system),decoded=await decodeSave(await blob.arrayBuffer(),grid.count);
  console.log('evolved giant save',{rawBytes:packed.byteLength,gzipBytes:blob.size});expect(blob.size).toBeLessThan(20*1024*1024);expect(JSON.stringify(decoded)).toBe(JSON.stringify(system));
  const restored=upgradeSnapshot(decoded.planets[0].snapshot,grid.count),resumed=new CpuSolver(grid,new Float32Array(restored.state));resumed.climate.restore(restored.climate);
  solver.advance(1/30,commands,p.environment);resumed.advance(1/30,commands,p.environment);expect(resumed.state).toEqual(solver.state);expect(resumed.climate.checkpoint()).toEqual(solver.climate.checkpoint());
  expect(restored.climate!.giant!.mass).not.toBe(decoded.planets[0].snapshot.climate!.giant!.mass);
  // Maximum retained history, synthesized independently of a long climate run.
  const telemetry=new TelemetryStore();telemetry.sample('planet-0','Evolved 0',{time:0,state:solver.state,climate:solver.climate.snapshot(),environment:p.environment,supplied:0,removed:0,escaped:0,transferredIn:0,transferredOut:0,directions:grid.directions});
  const initial=telemetry.planets.get('planet-0')!,base=initial.points[0],points=Array.from({length:2048},(_,i)=>{const time=i+1,values={...base.values};for(const key of ['tempMean','tempMin','tempMax','tempP10','tempMedian','tempP90','pressure','gasTemp'])if(values[key]!==null)values[key]=Number(values[key])+Math.sin(time*.013)*.001;for(let k=0;k<4;k++)values['energy'+k]=time*(k+1)*.00001;return {...base,time,values};});
  const archive={version:1 as const,planets:system.planets.map(planet=>({...initial,id:planet.id,name:planet.name,points,energy:[0,1,2,3].map(k=>Number(points.at(-1)!.values['energy'+k])),lastSample:2048,interval:1} as SavedPlanetTelemetry))};
  expect(fullTelemetryArchive(archive)).toBe(true);system.telemetry=archive;system.other!.telemetry=structuredClone(archive);for(const world of [system,system.other!])for(const planet of world.planets)planet.snapshot.time=2048;
  const full=await encodeSave(system),fullDecoded=await decodeSave(await full.arrayBuffer(),grid.count);expect(full.size).toBeLessThan(20*1024*1024);expect(fullTelemetryArchive(fullDecoded.telemetry)).toBe(true);expect(fullTelemetryArchive(fullDecoded.other!.telemetry)).toBe(true);expect(JSON.stringify(fullDecoded)).toBe(JSON.stringify(system));const metrics={pointsPerPlanet:2048,planets:8,gzipBytes:full.size,packedBytes:packSave(system).byteLength};console.log('evolved giants with maximum history',metrics);if(process.env.SANDSPHERE_PERFORMANCE_RESULTS)writeFileSync(process.env.SANDSPHERE_PERFORMANCE_RESULTS,JSON.stringify(metrics,null,2));
  solver.dispose();resumed.dispose();
 },60000);
});
