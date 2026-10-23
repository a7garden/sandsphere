import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,seedPlanet,type Environment,type PhysicalState} from '../src/sim/model';
import {WeatherClimate} from '../src/sim/weatherClimate';
import {AIR_LAYERS,AIR_SPECIES,AIR_GAS_INDICES,type LayeredAtmosphere} from '../src/sim/layeredAtmosphere';
import {createJupiterPlanet} from '../src/sim/planetCreation';
import {radiativeFluxes} from '../src/sim/climatePhysics';
import {initializeSpectralAcceleration,setSpectralAccelerationEnabled} from '../src/sim/spectralRadiation';

const grid=createSphere(0),environment:Environment={ambient:20,sunlight:.8,sun:[1,.2,.1],gravity:1,rotationRate:.02,climate:true};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type AirInternals={dynamics(dt:number,e:Environment):void;radiation(s:PhysicalState,i:number,dt:number,e:Environment,energy:Float32Array):void};
const internals=(air:LayeredAtmosphere)=>air as unknown as AirInternals;

// Recorded from the pre-optimization alpha.18 working tree on 2026-10-23.
// These cover exact arithmetic order, not an accuracy tolerance or performance target.
it.each([[20,false],[20,true],[-240,false],[-240,true]] as const)('retains exact layered transport and spectral radiation at %s C (SIMD %s)',async(temperature,accelerated)=>{
 setSpectralAccelerationEnabled(accelerated);
 if(accelerated){
  const status=await initializeSpectralAcceleration({load:async()=>new Uint8Array(readFileSync('src/sim/data/spectral-optics-simd.wasm'))});
  expect(status.backend).toBe('wasm-simd');
 }
 const e={...environment,ambient:temperature},s=new Float64Array(seedPlanet(grid,'sand',temperature)),climate=new WeatherClimate(grid);
 for(let i=0;i<grid.count;i++){s[i*STRIDE+F.water]=temperature>0?.5:0;s[i*STRIDE+F.nitrogen]=.3;}
 climate.prepareSurface(s,e);const air=climate.air,energy=new Float32Array(grid.count*4);
 for(let i=0;i<grid.count;i++)for(let k=0;k<AIR_LAYERS;k++){
  const q=i*AIR_LAYERS+k,p=q*AIR_SPECIES;air.mass[p]+=1e-7*(i+1);air.mass[p+3]+=1e-6*(k+1);air.mass[p+4]=temperature>0?2e-7*(k%3):0;
  air.temperature[q]=temperature+(i%3)*.1;const x=grid.directions[i*3],z=grid.directions[i*3+2];air.velocity[q*3]=z*3;air.velocity[q*3+2]=-x*3;
 }
 const columns=[radiativeFluxes(air.radiationColumn(s,0,e)),radiativeFluxes(air.radiationColumn(s,1,e))];
 for(let step=0;step<3;step++){for(let i=0;i<grid.count;i++)internals(air).radiation(s,i,.1,e,energy);internals(air).dynamics(.1,e);}
 const actual=digest({columns,air:air.checkpoint(),surface:[...s],energy:[...energy]});
 expect(actual).toBe(temperature===20?'0824ddf3a5ed38235e458931efba658e04999b2f08429d9ee4c76dc6b96c294f':'c1663464af2461e1b6fb21c7baa33434f8404b8bc8acc5acb4d579722dc5f7e2');
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
 air.setRadiationDiagnostics();internals(air).radiation(s,0,0,environment,energy);internals(air).radiation(s,0,0,environment,energy);
 air.mass[0]+=1e-5;air.mass[3]+=1e-5;air.temperature[0]+=2;internals(air).radiation(s,0,0,environment,energy);
 const counters=air.radiationDiagnostics()!;
 expect(counters.calls).toBe(3);expect(counters.initial).toBe(1);expect(counters.rebuilds).toBe(2);expect(counters.hits).toBe(1);expect(counters.temperature).toBe(1);
 expect(counters.gas[AIR_GAS_INDICES.indexOf(0)]).toBe(1);expect(counters.gas[AIR_GAS_INDICES.indexOf(3)]).toBe(1);
 const saved=air.checkpoint();counters.gas.fill(999);expect(air.radiationDiagnostics()!.gas).not.toEqual(counters.gas);
 air.setRadiationDiagnostics(false);expect(air.radiationDiagnostics()).toBeUndefined();expect(air.checkpoint()).toEqual(saved);
});

it('allocates deep state on demand and can release and restore an exact checkpoint',()=>{
 const climate=new WeatherClimate(grid),giant=climate.giant;
 expect(giant.ready).toBe(false);expect(giant.mass.length).toBe(0);expect(giant.temperature.length).toBe(0);expect(giant.velocity.length).toBe(0);
 const p=createJupiterPlanet(grid);climate.restore(p.climate);const saved=giant.checkpoint()!;expect(giant.mass.length).toBeGreaterThan(0);
 giant.restore();expect(giant.ready).toBe(false);expect(giant.mass.length).toBe(0);expect(giant.checkpoint()).toBeUndefined();
 giant.restore(saved);expect(giant.checkpoint()).toEqual(saved);giant.dynamics(3,p.environment);const evolved=giant.checkpoint();giant.restore(saved);giant.dynamics(3,p.environment);expect(giant.checkpoint()).toEqual(evolved);
});
