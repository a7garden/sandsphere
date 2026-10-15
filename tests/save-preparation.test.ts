import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {packSave,packSaveAsync,unpackSave} from '../src/sim/saveCodec';
import {prepareSystemSave,validSystem,migrateWorld} from '../src/sim/system';
import {createSphere} from '../src/sim/sphere';
import {seedWorld} from '../src/sim/model';
import {TelemetryStore} from '../src/sim/telemetry';
import {snapshotTelemetryStore} from '../src/sim/telemetryPersistence';
const grid=createSphere(0),make=()=>migrateWorld({version:4,preset:'coast',time:0,state:[...seedWorld(grid)],discoveries:[],environment:{ambient:18,sunlight:1,sun:[0,1,0]},supplied:0,removed:0},grid.count);
class ControlledWorker {
 static latest:ControlledWorker;
 request:{id:number;action:string;count:number;payload:ArrayBuffer}|null=null;
 onmessage:((e:{data:unknown})=>void)|null=null;onerror:((e:{message:string;preventDefault:()=>void})=>void)|null=null;onmessageerror:(()=>void)|null=null;terminated=false;
 constructor(){ControlledWorker.latest=this;}
 postMessage(request:NonNullable<ControlledWorker['request']>,transfer:Transferable[]){this.request=structuredClone(request,{transfer});}
 complete(){const r=this.request!,system=unpackSave(r.payload) as ReturnType<typeof make>;
  try{if(r.action==='prepare')this.onmessage?.({data:{id:r.id,payload:packSave(prepareSystemSave(system,r.count))}});else if(validSystem(system,r.count))this.onmessage?.({data:{id:r.id}});else throw new Error('완전한 저장본만 업로드할 수 있습니다.');}
  catch(e){this.onmessage?.({data:{id:r.id,error:String(e)}});}
 }
 terminate(){this.terminated=true;}
}
beforeEach(()=>vi.resetModules());afterEach(()=>vi.unstubAllGlobals());
it('prepares a captured world in a worker without detaching live inputs and validates replies',async()=>{
 vi.stubGlobal('Worker',ControlledWorker);const {prepareSystemSaveAsync,validateSystemSaveAsync}=await import('../src/sim/savePreparation');
 const original=make(),expected=prepareSystemSave(original,grid.count),before=structuredClone(original),job=prepareSystemSaveAsync(original,grid.count);
 await vi.waitFor(()=>expect(ControlledWorker.latest.request).not.toBeNull());expect(original).toEqual(before);ControlledWorker.latest.complete();expect(await job).toEqual(expected);
 const validation=validateSystemSaveAsync(expected,grid.count);await vi.waitFor(()=>expect(ControlledWorker.latest.request?.action).toBe('validate'));ControlledWorker.latest.complete();await validation;
});
it('falls back from worker infrastructure failure while retaining the exact captured input',async()=>{
 vi.stubGlobal('Worker',ControlledWorker);const {prepareSystemSaveAsync}=await import('../src/sim/savePreparation'),system=make(),before=structuredClone(system),job=prepareSystemSaveAsync(system,grid.count);
 await vi.waitFor(()=>expect(ControlledWorker.latest.request).not.toBeNull());ControlledWorker.latest.onerror?.({message:'Worker failed',preventDefault(){}});
 expect(await job).toEqual(prepareSystemSave(before,grid.count));expect(system).toEqual(before);expect(ControlledWorker.latest.terminated).toBe(true);
});
it('rejects invalid worker saves without treating validation failure as a successful fallback',async()=>{
 vi.stubGlobal('Worker',ControlledWorker);const {validateSystemSaveAsync}=await import('../src/sim/savePreparation');const job=validateSystemSaveAsync({...make(),version:99 as 3},grid.count),rejection=expect(job).rejects.toThrow('완전');
 await vi.waitFor(()=>expect(ControlledWorker.latest.request).not.toBeNull());ControlledWorker.latest.complete();await rejection;expect(ControlledWorker.latest.terminated).toBe(false);
});
it('cooperative and synchronous packing produce identical immutable payloads',async()=>{
 const value={large:Array.from({length:300000},(_,i)=>Math.sin(i)),name:'cooperative'};expect(new Uint8Array(await packSaveAsync(value))).toEqual(new Uint8Array(packSave(value)));expect((unpackSave(await packSaveAsync(value)) as typeof value).large).toEqual(value.large);
});
it('captures telemetry energy and history before asynchronous persistence while the live recorder continues',()=>{
 const store=new TelemetryStore(),input={time:0,state:seedWorld(grid),environment:{ambient:18,sunlight:1,sun:[0,1,0]},supplied:0,removed:0,escaped:0,transferredIn:0,transferredOut:0};store.sample('planet-1','Before',input);store.step('planet-1',1,[1,2,3,4],new Float32Array(grid.count*2));
 const captured=snapshotTelemetryStore(store),before=structuredClone(captured.planets.get('planet-1'));
 store.step('planet-1',1,[10,20,30,40],new Float32Array(grid.count*2));store.sample('planet-1','After',{...input,time:1});store.reset('planet-1');
 expect(captured.planets.get('planet-1')).toEqual(before);expect(captured.planets.get('planet-1')!.energy).not.toBe(store.planets.get('planet-1')!.energy);
});
