import {it,expect} from 'vitest';
import {LayeredAtmosphere,COLUMN_KG,AIR_LAYERS,surfaceEnthalpy,saturatedVapor} from '../src/sim/layeredAtmosphere';
import {F,STRIDE} from '../src/sim/model';
import type {SphereGrid} from '../src/sim/sphere';
const grid:SphereGrid={count:1,directions:new Float32Array([1,0,0]),indices:new Uint32Array(),geometry:new Float32Array(4),neighbors:new Uint32Array(),distances:new Float32Array()};
it('falling rain collects cloud and conserves water and carried enthalpy',()=>{
 const experiment=(seedRain:boolean)=>{
  const state=new Float32Array(STRIDE);state[F.nitrogen]=.3;state[F.temperature]=20;
  const air=new LayeredAtmosphere(grid,[]);air.initialize(state,{ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true});
  for(let k=0;k<AIR_LAYERS;k++){air.temperature[k]=20;air.mass[k*6]=0;air.mass[k*6+4]=0;air.mass[k*6+5]=0;}
  air.mass[4]=1e-6;if(seedRain)air.mass[6+4]=.01;
  for(let iteration=0;iteration<16;iteration++)for(let k=0;k<2;k++)air.mass[k*6]=saturatedVapor(air.mass[k*6+1],air.mass[k*6+1]/.028014,20,air.pressure(0,k));
  air.attach(state);air.advance(state,0,{ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true},new Float32Array(4));
  air.detach(state,{ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true});
  // Isolate the microphysics operator from saturation adjustment/dynamics.
  const beforeWater=Array.from(air.mass).reduce((sum,m,k)=>sum+(k%6===0||k%6>=4?m:0),0)+state[F.water]+state[F.ice],beforeHeat=surfaceEnthalpy(state,0)+air.totalEnergy(),beforeRoundoff=(air as unknown as {roundoff:Float64Array}).roundoff[0];
  const rain=new Float32Array(2);
  (air as unknown as {precipitation:(s:Float32Array,i:number,dt:number,p:Float32Array)=>void}).precipitation(state,0,30,rain);
  air.attach(state);
  const afterWater=Array.from(air.mass).reduce((sum,m,k)=>sum+(k%6===0||k%6>=4?m:0),0)+state[F.water]+state[F.ice];
  expect(afterWater).toBeCloseTo(beforeWater,8);
  expect(surfaceEnthalpy(state,0)+air.totalEnergy()-((air as unknown as {roundoff:Float64Array}).roundoff[0]-beforeRoundoff)).toBeCloseTo(beforeHeat,8);
  return air.mass[4]*COLUMN_KG;
 };
 const dry=experiment(false),rainy=experiment(true);
 expect(dry).toBeGreaterThan(0);expect(dry).toBeLessThan(1e-6*COLUMN_KG);
 expect(rainy).toBeLessThan(dry);
});
it('retains rain smaller than a Float32 ocean increment across repeated transfers',()=>{
 const state=new Float32Array(STRIDE);state[F.nitrogen]=.3;state[F.water]=30;state[F.temperature]=20;
 const env={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true},air=new LayeredAtmosphere(grid,[]);
 air.initialize(state,env);air.mass[4]=1e-4;air.attach(state);air.detach(state,env);
 const water=()=>state[F.water]+state[F.ice]+Array.from(air.mass).reduce((sum,m,k)=>sum+(k%6===0||k%6>=4?m:0),0),before=water();
 for(let step=0;step<500;step++)(air as unknown as {precipitation:(s:Float32Array,i:number,dt:number)=>void}).precipitation(state,0,.01);
 expect(water()).toBeCloseTo(before,10);
 expect(air.mass[0]+air.mass[4]+air.mass[5]).toBeGreaterThan(0);
});

it('aggregates ice into falling snow with conservative sublimation and heat-limited melt',()=>{
 const state=new Float32Array(STRIDE);state[F.nitrogen]=.3;state[F.water]=1;state[F.temperature]=20;
 const env={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true},air=new LayeredAtmosphere(grid,[]);
 air.initialize(state,env);
 for(let k=0;k<AIR_LAYERS;k++){air.temperature[k]=k<2?20:-40;air.mass[k*6]=0;air.mass[k*6+4]=0;air.mass[k*6+5]=0;}
 air.mass[3*6+5]=.01;air.attach(state);air.detach(state,env);
 const water=()=>state[F.water]+state[F.ice]+Array.from(air.mass).reduce((sum,m,k)=>sum+(k%6===0||k%6>=4?m:0),0),beforeWater=water(),beforeHeat=surfaceEnthalpy(state,0)+air.totalEnergy(),old=(air as unknown as {roundoff:Float64Array}).roundoff[0],rain=new Float32Array(2);
 (air as unknown as {precipitation:(s:Float32Array,i:number,dt:number,p:Float32Array)=>void}).precipitation(state,0,30,rain);
 expect(air.mass[3*6+5]).toBeLessThan(.01);expect(air.mass.every(m=>Number.isFinite(m)&&m>=0)).toBe(true);
 expect(water()).toBeCloseTo(beforeWater,8);
 expect(surfaceEnthalpy(state,0)+air.totalEnergy()-((air as unknown as {roundoff:Float64Array}).roundoff[0]-old)).toBeCloseTo(beforeHeat,8);
 expect(air.temperature[0]).toBeGreaterThanOrEqual(0);
});
