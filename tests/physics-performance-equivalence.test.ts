import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,seedPlanet,type Environment,type PhysicalState} from '../src/sim/model';
import {WeatherClimate} from '../src/sim/weatherClimate';
import {AIR_LAYERS,AIR_SPECIES,AIR_GAS_INDICES,radiationGasMassFloors,type LayeredAtmosphere} from '../src/sim/layeredAtmosphere';
import {createJupiterPlanet} from '../src/sim/planetCreation';
import {radiativeFluxes} from '../src/sim/climatePhysics';
import {initializeSpectralAcceleration,setSpectralAccelerationEnabled} from '../src/sim/spectralRadiation';
import {WeatherClimate as OriginalWeatherClimate} from './helpers/preOptimizationAtmosphere/weatherClimate';
import {seedPlanet as originalSeedPlanet} from './helpers/preOptimizationAtmosphere/model';
import referenceManifest from './helpers/preOptimizationAtmosphere/manifest.json';
import sourceBaseline from '../docs/performance/2026-10-23/source-baseline.json';

const grid=createSphere(0),environment:Environment={ambient:20,sunlight:.8,sun:[1,.2,.1],gravity:1,rotationRate:.02,climate:true};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type AirInternals={advance(s:PhysicalState,dt:number,e:Environment,energy:Float32Array):void;dynamics(dt:number,e:Environment):void;radiation(s:PhysicalState,i:number,dt:number,e:Environment,energy:Float32Array,boundary?:undefined,allowance?:Uint8Array):void;rebuildAllowance(s:PhysicalState,step:number):Uint8Array|undefined};
const internals=(air:unknown)=>air as AirInternals;

function exactReference(actual:unknown,expected:unknown,path='reference'):void {
 if(Object.is(actual,expected))return;
 if(!actual||!expected||typeof actual!=='object'||typeof expected!=='object')throw new Error(`${path}: exact mismatch (${String(actual)} vs ${String(expected)})`);
 if(ArrayBuffer.isView(actual)||ArrayBuffer.isView(expected)){
  if(!ArrayBuffer.isView(actual)||!ArrayBuffer.isView(expected)||actual.constructor.name!==expected.constructor.name||actual.byteLength!==expected.byteLength)throw new Error(`${path}: typed-array shape differs`);
  if(!('length' in actual)||!('length' in expected))throw new Error(`${path}: unsupported view needs an explicit exact comparator`);
  const a=actual as unknown as ArrayLike<number>,b=expected as unknown as ArrayLike<number>;
  for(let i=0;i<a.length;i++)if(!Object.is(a[i],b[i]))throw new Error(`${path}[${i}]: exact mismatch (${a[i]} vs ${b[i]})`);return;
 }
 if(Array.isArray(actual)!==Array.isArray(expected))throw new Error(`${path}: array/object shape differs`);
 const a=actual as Record<string,unknown>,b=expected as Record<string,unknown>,keys=Object.keys(a);
 if(keys.length!==Object.keys(b).length||keys.some(key=>!Object.hasOwn(b,key)))throw new Error(`${path}: object keys differ`);
 for(const key of keys)exactReference(a[key],b[key],`${path}.${key}`);
}

it('pins the independent original modules and shared math dependencies to the pre-optimization source receipt',()=>{
 const recorded=sourceBaseline.files as Record<string,string>;
 for(const [file,entry]of Object.entries(referenceManifest.frozen)){
  expect(entry.originalSha256,entry.originalPath).toBe(recorded[entry.originalPath]);
  const fixture=readFileSync('tests/helpers/preOptimizationAtmosphere/'+file,'utf8');expect(fixture.startsWith(referenceManifest.header)).toBe(true);
  const original=fixture.slice(referenceManifest.header.length).replaceAll("from '../../../src/sim/","from './");
  expect(createHash('sha256').update(original).digest('hex'),entry.originalPath).toBe(entry.originalSha256);
 }
 for(const [file,sha]of Object.entries(referenceManifest.shared)){expect(sha,file).toBe(recorded[file]);expect(createHash('sha256').update(readFileSync(file)).digest('hex'),file).toBe(sha);}
});

it('compares signed zero and the lowest differing Float64 bit without an epsilon',()=>{
 expect(()=>exactReference(new Float64Array([0]),new Float64Array([-0]))).toThrow('exact mismatch');
 expect(()=>exactReference(new Float64Array([1]),new Float64Array([1+Number.EPSILON]))).toThrow('exact mismatch');
});

function layeredScenario(temperature:number,Climate:typeof WeatherClimate|typeof OriginalWeatherClimate,seed:typeof seedPlanet){
 const e={...environment,ambient:temperature},s=new Float64Array(seed(grid,'sand',temperature)),climate=new Climate(grid);
 for(let i=0;i<grid.count;i++){s[i*STRIDE+F.water]=temperature>0?.5:0;s[i*STRIDE+F.nitrogen]=.3;}
 climate.prepareSurface(s,e);const air=climate.air,energy=new Float32Array(grid.count*4),prepared={air:air.checkpoint(),surface:s.slice()};
 for(let i=0;i<grid.count;i++)for(let k=0;k<AIR_LAYERS;k++){
  const q=i*AIR_LAYERS+k,p=q*AIR_SPECIES;air.mass[p]+=1e-7*(i+1);air.mass[p+3]+=1e-6*(k+1);air.mass[p+4]=temperature>0?2e-7*(k%3):0;
  air.temperature[q]=temperature+(i%3)*.1;const x=grid.directions[i*3],z=grid.directions[i*3+2];air.velocity[q*3]=z*3;air.velocity[q*3+2]=-x*3;
 }
 const columns=[radiativeFluxes(air.radiationColumn(s,0,e)),radiativeFluxes(air.radiationColumn(s,1,e))],stages=[];
 for(let step=0;step<3;step++){for(let i=0;i<grid.count;i++)internals(air).radiation(s,i,.1,e,energy);internals(air).dynamics(.1,e);stages.push({air:air.checkpoint(),surface:s.slice(),energy:energy.slice()});}
 return {prepared,stages,golden:{columns,air:air.checkpoint(),surface:[...s],energy:[...energy]}};
}

// Recorded from the pre-optimization alpha.18 working tree on 2026-10-23.
// The exact original-vs-current oracle runs on EVERY platform. Transcendental
// Math results are runtime-dependent, so the historical hash is an additional
// guard only in its recorded Darwin ARM64 / Node / V8 environment.
it.each([[20,false],[20,true],[-240,false],[-240,true]] as const)('retains exact layered transport and spectral radiation at %s C (SIMD %s)',async(temperature,accelerated)=>{
 setSpectralAccelerationEnabled(accelerated);
 if(accelerated){
  const status=await initializeSpectralAcceleration({load:async()=>new Uint8Array(readFileSync('src/sim/data/spectral-optics-simd.wasm'))});
  expect(status.backend).toBe('wasm-simd');
 }
 const original=layeredScenario(temperature,OriginalWeatherClimate,originalSeedPlanet),actual=layeredScenario(temperature,WeatherClimate,seedPlanet);
 exactReference(actual,original);
 if(process.platform==='darwin'&&process.arch==='arm64'&&process.version==='v24.20.0'&&process.versions.v8==='13.6.233.17-node.53'){
  const captured=temperature===20?'0824ddf3a5ed38235e458931efba658e04999b2f08429d9ee4c76dc6b96c294f':'c1663464af2461e1b6fb21c7baa33434f8404b8bc8acc5acb4d579722dc5f7e2';
  expect(digest(original.golden)).toBe(captured);expect(digest(actual.golden)).toBe(captured);
 }
 if(process.env.PHYSICS_ORACLE_DIAGNOSTICS==='1')console.log('independent original atmosphere oracle',{temperature,accelerated,platform:process.platform,arch:process.arch,node:process.version,v8:process.versions.v8,original:digest(original.golden),actual:digest(actual.golden)});
});

it('retains exact deep atmosphere transport through repeated stages',()=>{
 const p=createJupiterPlanet(grid),climate=new WeatherClimate(grid);climate.restore(p.climate);const giant=climate.giant;
 for(let step=0;step<3;step++)giant.dynamics(3,p.environment);
 expect(digest(giant.checkpoint())).toBe('7d2d5454d0a3faae5a0ff8464fb36b86621604731489c6802c9d06a84b948043');
});

it('keeps spectral diagnostic columns independent while the solver reuses its column',()=>{
 const s=new Float64Array(seedPlanet(grid,'sand',20)),climate=new WeatherClimate(grid);climate.prepareSurface(s,environment);const air=climate.air;
 for(let k=0;k<AIR_LAYERS;k++){air.mass[k*AIR_SPECIES]+=1e-6;air.mass[k*AIR_SPECIES+4]=k%2?1e-7:0;}
 const original=air.radiationColumn(s,0,environment,1),saved=structuredClone(original),energy=new Float32Array(grid.count*4);
 for(let i=0;i<3;i++){
  air.temperature[i*AIR_LAYERS]+=i;
  internals(air).radiation(s,i,0,environment,energy);
  const fresh=radiativeFluxes(air.radiationColumn(s,i,environment,1)),cache=air.checkpoint().radiationCache,r=i*(8+AIR_LAYERS*5);
  expect(cache[r+1]).toBe(fresh.down[0]-fresh.up[0]);expect(cache[r+2]).toBe(fresh.surfaceSolar);
 }
 expect(original).toEqual(saved);expect(air.radiationColumn(s,0,environment)).not.toBe(original);
});

it('reports all simultaneous invalidation reasons without changing physics or save state',()=>{
 const s=new Float64Array(seedPlanet(grid,'sand',20)),climate=new WeatherClimate(grid);climate.prepareSurface(s,environment);const air=climate.air,energy=new Float32Array(grid.count*4);
 const floors=radiationGasMassFloors();
 air.setRadiationDiagnostics();internals(air).radiation(s,0,0,environment,energy);internals(air).radiation(s,0,0,environment,energy);
 // Sub-tolerance drift reuses the coefficients; the same species crossing its
 // floor invalidates alongside the thermal bound.
 air.mass[0]+=floors[0]*.5;internals(air).radiation(s,0,0,environment,energy);
 const cached=air.radiationDiagnostics()!;
 expect(cached.calls).toBe(3);expect(cached.initial).toBe(1);expect(cached.rebuilds).toBe(1);expect(cached.hits).toBe(2);
 air.mass[0]+=floors[0]*2;air.mass[3]+=floors[3]*2;air.temperature[0]+=2;internals(air).radiation(s,0,0,environment,energy);
 const counters=air.radiationDiagnostics()!;
 expect(counters.calls).toBe(4);expect(counters.rebuilds).toBe(2);expect(counters.hits).toBe(2);expect(counters.temperature).toBe(1);
 expect(counters.gas[AIR_GAS_INDICES.indexOf(0)]).toBe(1);expect(counters.gas[AIR_GAS_INDICES.indexOf(3)]).toBe(1);
 const saved=air.checkpoint();counters.gas.fill(999);expect(air.radiationDiagnostics()!.gas).not.toEqual(counters.gas);
 air.setRadiationDiagnostics(false);expect(air.radiationDiagnostics()).toBeUndefined();expect(air.checkpoint()).toEqual(saved);
});

it('defers saturated rebuilds inside the declared envelope, oldest first, and resumes identically',()=>{
 const s=new Float64Array(seedPlanet(grid,'sand',20)),climate=new WeatherClimate(grid);climate.prepareSurface(s,environment);const air=climate.air,energy=new Float32Array(grid.count*4),stride=8+AIR_LAYERS*5;
 internals(air).advance(s,1/60,environment,energy);
 for(let q=0;q<air.temperature.length;q++)air.temperature[q]+=5;
 air.setRadiationDiagnostics();
 const mask=internals(air).rebuildAllowance(s,1)!;
 expect(mask).toBeDefined();
 let rebuilt=0,deferred=0;for(const value of mask){if(value===1)rebuilt++;if(value===2)deferred++;}
 expect(rebuilt).toBe(1);expect(deferred).toBe(grid.count-1);
 for(let i=0;i<grid.count;i++)internals(air).radiation(s,i,1,environment,energy,undefined,mask);
 const cached=air.radiationDiagnostics()!;
 expect(cached.calls).toBe(grid.count);expect(cached.rebuilds).toBe(1);expect(cached.deferred).toBe(grid.count-1);
 const after=air.checkpoint().radiationCache;
 expect(after[0]).toBe(1);for(let i=1;i<grid.count;i++)expect(after[i*stride]).toBe(2);
 const next=internals(air).rebuildAllowance(s,1)!;
 expect(next[0]).toBe(0);expect(next[1]).toBe(1);
 // Deferral is a pure function of the serialized cache: a mid-backlog resume
 // runs in lockstep with the uninterrupted solver.
 const resumedSurface=new Float64Array(s),resumedClimate=new WeatherClimate(grid);
 resumedClimate.restore(JSON.parse(JSON.stringify(climate.snapshot())));
 for(let n=0;n<3;n++){internals(air).advance(s,1/60,environment,energy);internals(resumedClimate.air).advance(resumedSurface,1/60,environment,energy);}
 expect(resumedSurface).toEqual(s);expect(resumedClimate.snapshot()).toEqual(climate.snapshot());
});

it('allocates deep state on demand and can release and restore an exact checkpoint',()=>{
 const climate=new WeatherClimate(grid),giant=climate.giant;
 expect(giant.ready).toBe(false);expect(giant.mass.length).toBe(0);expect(giant.temperature.length).toBe(0);expect(giant.velocity.length).toBe(0);
 const p=createJupiterPlanet(grid);climate.restore(p.climate);const saved=giant.checkpoint()!;expect(giant.mass.length).toBeGreaterThan(0);
 giant.restore();expect(giant.ready).toBe(false);expect(giant.mass.length).toBe(0);expect(giant.checkpoint()).toBeUndefined();
 giant.restore(saved);expect(giant.checkpoint()).toEqual(saved);giant.dynamics(3,p.environment);const evolved=giant.checkpoint();giant.restore(saved);giant.dynamics(3,p.environment);expect(giant.checkpoint()).toEqual(evolved);
});
