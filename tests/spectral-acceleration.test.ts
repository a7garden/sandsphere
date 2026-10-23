import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import fixture from './fixtures/ecckd-optics-reference.json';
import manifest from '../src/sim/data/spectral-optics-simd.json';
import type {SpectralGasLayer,SpectralGasOptics} from '../src/sim/spectralRadiation';

const bytes=new Uint8Array(readFileSync(resolve('src/sim/data/spectral-optics-simd.wasm')));
const layer:SpectralGasLayer={pressure:1e5,temperature:288,dryMoles:3.2,waterMoles:.01,carbonDioxideMoles:.0013,methaneMoles:6e-6};
const fresh=()=>import('../src/sim/spectralRadiation');
const exact=(a:SpectralGasOptics,b:SpectralGasOptics)=>{for(const key of ['longwave','shortwave','rayleigh'] as const)for(let g=0;g<32;g++)expect(Object.is(a[key][g],b[key][g])).toBe(true);};
beforeEach(()=>{vi.resetModules();vi.restoreAllMocks();vi.unstubAllGlobals();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

it('ships the documented strict Float64 SIMD binary without host imports',()=>{
 const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
 expect(sha(bytes)).toBe(manifest.binarySha256);expect(bytes.byteLength).toBe(manifest.binaryBytes);
 expect(sha(readFileSync(resolve(manifest.source)))).toBe(manifest.sourceSha256);
 expect(WebAssembly.Module.imports(new WebAssembly.Module(bytes))).toEqual([]);
 expect(manifest.compileFlags).toContain('-ffp-contract=off');expect(manifest.compileFlags).toContain('-fno-fast-math');
});

it('matches all independent fixture rows, cold/zero/trace cases and public result ownership exactly',async()=>{
 const s=await fresh(),cases:SpectralGasLayer[]=fixture.rows.map(r=>({pressure:r.pressure,temperature:r.temperature,dryMoles:r.dryMoles,waterMoles:r.waterMoles,carbonDioxideMoles:r.co2*r.dryMoles,methaneMoles:r.ch4*r.dryMoles,ozone:r.o3}));
 for(const pressure of [.01,1,3000,1e5,1e7])for(const temperature of [0,.01,33.15,119.999999,273.15,2500])for(const wet of [false,true])cases.push({pressure,temperature,dryMoles:3.2,waterMoles:wet?1e-7:0,carbonDioxideMoles:wet?1e-11:0,methaneMoles:wet?2e-9:0});
 cases.push({pressure:1000,temperature:33.15,dryMoles:-0,waterMoles:-0,carbonDioxideMoles:-0,methaneMoles:-0,ozone:0,n2o:0});
 const expected=cases.map(c=>s.spectralGasOptics(c));
 const load=vi.fn(async()=>bytes);const [a,b]=await Promise.all([s.initializeSpectralAcceleration({load}),s.initializeSpectralAcceleration({load})]);
 expect(a.backend).toBe('wasm-simd');expect(b.backend).toBe('wasm-simd');expect(load).toHaveBeenCalledTimes(1);expect(a.tableBytes).toBe(3256576);
 s.setSpectralAccelerationDiagnostics();
 for(let i=0;i<cases.length;i++)exact(s.spectralGasOptics(cases[i]),expected[i]);
 const independent=s.spectralGasOptics(layer),saved=structuredClone(independent);s.spectralGasOptics({...layer,waterMoles:0});exact(independent,saved);
 const counts=s.spectralAccelerationDiagnostics()!;expect(counts.acceleratedCalls).toBe(cases.length+2);expect(counts.runtimeFailures).toBe(0);counts.acceleratedCalls=-1;expect(s.spectralAccelerationDiagnostics()!.acceleratedCalls).toBeGreaterThan(0);
 s.setSpectralAccelerationEnabled(false);expect(s.spectralAccelerationStatus().backend).toBe('js');exact(s.spectralGasOptics(layer),saved);
 s.setSpectralAccelerationEnabled(true);expect(s.spectralAccelerationStatus().backend).toBe('wasm-simd');exact(s.spectralGasOptics(layer),saved);
});

it.each(['disabled','missing-webassembly','unsupported','fetch','compile','self-check'])('keeps JS on %s initialization without rejecting',async failure=>{
 const s=await fresh(),expected=s.spectralGasOptics(layer),load=vi.fn(async()=>bytes);
 if(failure==='missing-webassembly')vi.stubGlobal('WebAssembly',undefined);
 if(failure==='unsupported')vi.spyOn(WebAssembly,'validate').mockReturnValue(false);
 if(failure==='fetch')load.mockRejectedValue(new Error('offline'));
 if(failure==='compile')vi.spyOn(WebAssembly,'instantiate').mockRejectedValue(new WebAssembly.CompileError('CSP blocked'));
 if(failure==='self-check'){
  const native=WebAssembly.instantiate as (bytes:BufferSource,imports?:WebAssembly.Imports)=>Promise<WebAssembly.WebAssemblyInstantiatedSource>;
  const wrong=async(value:BufferSource,imports?:WebAssembly.Imports)=>{const actual=await native(value,imports),exports=actual.instance.exports;return {module:actual.module,instance:{exports:{...exports,optics:(...args:number[])=>{new Float64Array((exports.memory as WebAssembly.Memory).buffer,args[6],96).fill(123);}}} as unknown as WebAssembly.Instance};};
  vi.spyOn(WebAssembly,'instantiate').mockImplementation(wrong as typeof WebAssembly.instantiate);
 }
 const status=await s.initializeSpectralAcceleration({enabled:failure!=='disabled',load});expect(status.backend).toBe('js');if(failure==='disabled')expect(load).not.toHaveBeenCalled();
 exact(s.spectralGasOptics(layer),expected);
});

it('bounds initialization and never publishes a kernel after timeout or disable',async()=>{
 const native=await WebAssembly.instantiate(bytes,{}),s=await fresh();
 let finish!:(value:WebAssembly.WebAssemblyInstantiatedSource)=>void;
 vi.spyOn(WebAssembly,'instantiate').mockImplementation((()=>new Promise<WebAssembly.WebAssemblyInstantiatedSource>(resolve=>{finish=resolve;})) as unknown as typeof WebAssembly.instantiate);
 vi.useFakeTimers();const pending=s.initializeSpectralAcceleration({load:async()=>bytes});await vi.advanceTimersByTimeAsync(0);expect(finish).toBeTypeOf('function');
 await vi.advanceTimersByTimeAsync(3001);expect((await pending).backend).toBe('js');expect(s.spectralAccelerationStatus().state).toBe('failed');finish(native);await vi.advanceTimersByTimeAsync(0);expect(s.spectralAccelerationStatus().backend).toBe('js');expect(s.spectralAccelerationStatus().state).toBe('failed');
 vi.useRealTimers();vi.restoreAllMocks();
 const freshModule=await fresh();let load!:(value:Uint8Array)=>void;const disabled=freshModule.initializeSpectralAcceleration({load:()=>new Promise(resolve=>{load=resolve;})});freshModule.setSpectralAccelerationEnabled(false);load(bytes);expect((await disabled).backend).toBe('js');freshModule.setSpectralAccelerationEnabled(true);expect(freshModule.spectralAccelerationStatus().backend).toBe('js');
});

it('falls back after a real-instance runtime trap and overwrites destination results with correct JS output',async()=>{
 const s=await fresh(),expected=s.spectralGasOptics(layer),native=WebAssembly.instantiate as (bytes:BufferSource,imports?:WebAssembly.Imports)=>Promise<WebAssembly.WebAssemblyInstantiatedSource>;let trap=false;
 const wrapped=async(value:BufferSource,imports?:WebAssembly.Imports)=>{const actual=await native(value,imports),exports=actual.instance.exports;return {module:actual.module,instance:{exports:{...exports,optics:(...args:number[])=>{if(trap)throw new WebAssembly.RuntimeError('test trap');return (exports.optics as (...args:number[])=>void)(...args);}}} as unknown as WebAssembly.Instance};};
 vi.spyOn(WebAssembly,'instantiate').mockImplementation(wrapped as typeof WebAssembly.instantiate);
 expect((await s.initializeSpectralAcceleration({load:async()=>bytes})).backend).toBe('wasm-simd');s.setSpectralAccelerationDiagnostics();trap=true;
 const result={longwave:new Float64Array(32).fill(999),shortwave:new Float64Array(32).fill(999),rayleigh:new Float64Array(32).fill(999)};s.spectralGasOpticsInto(layer,result,new Float64Array(8));exact(result,expected);expect(s.spectralAccelerationStatus().backend).toBe('js');expect(s.spectralAccelerationDiagnostics()!.runtimeFailures).toBe(1);exact(s.spectralGasOptics(layer),expected);
});

it('uses JS for a nested call so active WASM output cannot be overwritten',async()=>{
 const s=await fresh(),other={...layer,waterMoles:0,carbonDioxideMoles:1},expected=s.spectralGasOptics(layer),nestedExpected=s.spectralGasOptics(other);await s.initializeSpectralAcceleration({load:async()=>bytes});s.setSpectralAccelerationDiagnostics();
 let nested=false;const longwave=new Float64Array(32),output={get longwave(){if(!nested){nested=true;exact(s.spectralGasOptics(other),nestedExpected);}return longwave;},shortwave:new Float64Array(32),rayleigh:new Float64Array(32)};
 s.spectralGasOpticsInto(layer,output,new Float64Array(8));exact(output,expected);expect(s.spectralAccelerationDiagnostics()!.nestedFallbacks).toBe(1);expect(s.spectralAccelerationDiagnostics()!.acceleratedCalls).toBe(1);
});

it.each(['wet','dry','methane','cold'])('retains full-step outputs and exact JSON/typed resume for %s with the real binary',async kind=>{
 const spectral=await fresh(),model=await import('../src/sim/model'),{createSphere}=await import('../src/sim/sphere'),grid=createSphere(0),temperature=kind==='cold'?-240:22,state=kind==='wet'?model.seedWorld(grid,'coast',temperature):model.seedPlanet(grid,'sand',temperature,kind==='methane'?'methane':'nitrogen'),environment={ambient:temperature,sunlight:kind==='cold'?0:1,sun:[1,0,0],gravity:kind==='methane'?.3:1,climate:true},commands=new Float32Array(grid.count*model.COMMAND_STRIDE);
 const run=(solver:InstanceType<typeof model.CpuSolver>,count:number)=>{const exchanges=[];for(let step=0;step<count;step++){solver.advance(1/30,commands,environment);exchanges.push({energy:solver.energyChanges.slice(),lift:solver.climate.lift.slice(),precipitation:solver.precipitatedCells.slice(),condensation:solver.condensedCells.slice(),escape:solver.escapeCells.slice(),feeding:solver.feedingCells.slice()});}return exchanges;};
 const baseline=new model.CpuSolver(grid,state.slice()),expected=run(baseline,3),baselineCheckpoint=baseline.climate.checkpoint();
 expect((await spectral.initializeSpectralAcceleration({load:async()=>bytes})).backend).toBe('wasm-simd');spectral.setSpectralAccelerationDiagnostics();const accelerated=new model.CpuSolver(grid,state.slice());expect(run(accelerated,3)).toEqual(expected);expect(accelerated.state).toEqual(baseline.state);expect(accelerated.climate.checkpoint()).toEqual(baselineCheckpoint);expect(spectral.spectralAccelerationDiagnostics()!.acceleratedCalls).toBeGreaterThan(0);
 const typed=new model.CpuSolver(grid,accelerated.state.slice());typed.climate.restoreCheckpoint(accelerated.climate.checkpoint());const json=new model.CpuSolver(grid,accelerated.state.slice());json.climate.restore(JSON.parse(JSON.stringify(accelerated.climate.snapshot())));const next=run(accelerated,1);expect(run(typed,1)).toEqual(next);expect(run(json,1)).toEqual(next);expect(typed.climate.checkpoint()).toEqual(accelerated.climate.checkpoint());expect(json.climate.checkpoint()).toEqual(accelerated.climate.checkpoint());expect(typed.state).toEqual(accelerated.state);expect(json.state).toEqual(accelerated.state);expect(spectral.spectralAccelerationDiagnostics()!.runtimeFailures).toBe(0);
});
