import {describe,it,expect} from 'vitest';
import {byrneOpticalDepth,geenOpticalDepth,geenSolarDepth,friersonOpticalDepth,parcelEquilibrium,radiativeFluxes,STEFAN_BOLTZMANN as sigma} from '../src/sim/climatePhysics';
import {saturationPressure} from '../src/sim/waterPhysics';

describe('published climate closures and independent physical limits',()=>{
 it('recovers the analytic isothermal Schwarzschild solution under vertical refinement',()=>{
  const blackbody=(t:number)=>sigma*(t+273.15)**4;
  for(const n of [1,5,20,80]){
   const f=radiativeFluxes({temperature:Array(n).fill(-10),opticalDepth:Array(n).fill(2.4/n),cloudTransportDepth:Array(n).fill(0),surfaceTemperature:20,surfaceAlbedo:.3,solar:340});
   expect(f.olr).toBeCloseTo(blackbody(20)*Math.exp(-2.4)+blackbody(-10)*(1-Math.exp(-2.4)),9);
   expect(f.down[0]).toBeCloseTo(blackbody(-10)*(1-Math.exp(-2.4)),9);
   expect(f.surfaceNet+f.heating.reduce((a,b)=>a+b,0)).toBeCloseTo(f.toaNet,9);
  }
 });
 it('conserves two-stream solar flux, including arbitrarily many reflections',()=>{
  for(const tau of [0,.01,1,100])for(const albedo of [0,.3,1]){
   const f=radiativeFluxes({temperature:[0,0,0],opticalDepth:[0,0,0],cloudTransportDepth:[tau,tau/2,tau],surfaceTemperature:0,surfaceAlbedo:albedo,solar:400});
   expect(f.surfaceSolar+f.reflectedSolar).toBeCloseTo(400,8);
   for(let k=0;k<3;k++)expect(f.swDown[k]-f.swUp[k]).toBeCloseTo(f.surfaceSolar,8);
   expect(f.heating.every(h=>Math.abs(h)<1e-10)).toBe(true);
  }
 });
 it('heats the air with absorbed solar flux and retains coupled column conservation',()=>{
  const f=radiativeFluxes({temperature:[0,0],opticalDepth:[.5,.1],cloudTransportDepth:[5,2],solarAbsorptionDepth:[.2,.1],surfaceTemperature:20,surfaceAlbedo:.6,solar:400});
  expect(f.surfaceNet+f.heating.reduce((a,b)=>a+b,0)).toBeCloseTo(f.toaNet,9);
  const solarHeating=400-f.reflectedSolar-f.surfaceSolar;expect(solarHeating).toBeGreaterThan(0);
  expect(geenSolarDepth(0,1e5,0,360)).toBeCloseTo(.0596,12);
  const whole=geenSolarDepth(0,1e5,.01,360);let split=0;for(let i=0;i<100;i++)split=geenSolarDepth(split,1000,.01,360);
  expect(whole).toBeCloseTo(split,5);expect(whole).toBeGreaterThan(.0596);
 });
 it('matches Isca Byrne opacity coefficients, zero column limit and CO2 perturbations',()=>{
  expect(byrneOpticalDepth(1e5,0,360)).toBeCloseTo(.8678,12);
  expect(byrneOpticalDepth(1e5,.01,360)).toBeCloseTo(20.8468,12);
  expect(byrneOpticalDepth(1e5,0,720)-byrneOpticalDepth(1e5,0,360)).toBeCloseTo(.17*Math.log(2),12);
  expect(byrneOpticalDepth(0,.1,400)).toBe(0);
  expect(byrneOpticalDepth(1e5,0,0)).toBe(0);
 });
 it('reproduces Frierson prescribed optical depth and its pressure boundary',()=>{
  expect(friersonOpticalDepth(1e5,0)).toBe(6);
  expect(friersonOpticalDepth(1e5,1)).toBe(1.5);
  expect(friersonOpticalDepth(0,0)).toBe(0);
  expect(friersonOpticalDepth(5e4,0)).toBeCloseTo(.6375,12);
 });
 it('preserves the published infrared window and multi-band energy balance',()=>{
  const depth=geenOpticalDepth(1e5,0,360);expect(depth.window).toBe(.215);expect(depth.nonWindow).toBe(.1);
  const doubled=geenOpticalDepth(1e5,0,720);expect(doubled.window-depth.window).toBeCloseTo(.0954*Math.log(2),12);
  const f=radiativeFluxes({temperature:[0],opticalDepth:[3],cloudTransportDepth:[0],longwaveBands:[{weight:.3732,opticalDepth:[0]},{weight:.6268,opticalDepth:[3]}],surfaceTemperature:20,surfaceAlbedo:0,solar:340});
  expect(f.olr).toBeCloseTo(.3732*sigma*293.15**4+.6268*(sigma*293.15**4*Math.exp(-3)+sigma*273.15**4*(1-Math.exp(-3))),9);
  expect(f.surfaceNet+f.heating[0]).toBeCloseTo(f.toaNet,9);
 });
 it('recovers dry adiabatic lifting and moist latent-heat reduction of cooling',()=>{
  const dry=parcelEquilibrium(1.004,1/.02897,0,1.004*30,80000,9.81);
  expect(dry.temperature).toBeCloseTo(30-9.81/1.004,8);
  const v=.018015/.02897*saturationPressure(30)/(100000-saturationPressure(30)),h=(1.004+v*2)*30+v*2475;
  const moist=parcelEquilibrium(1.004,1/.02897,v,h,88000,(1+v)*9.81);
  expect(moist.temperature).toBeGreaterThan(dry.temperature+3);
  expect(moist.temperature).toBeLessThan(30);expect(moist.liquid).toBeGreaterThan(0);
  expect(moist.energy).toBeCloseTo(h,6);
  expect(moist.vapor+moist.liquid+moist.ice).toBeCloseTo(v,12);
 });
 it('handles the mixed-phase enthalpy gap without manufacturing water or heat',()=>{
  const water=.01,moles=1/.02897,p=80000,v=.018015*moles*saturationPressure(0)/(p-saturationPressure(0)),ice=(water-v)*.5,h=v*2475-ice*334;
  const r=parcelEquilibrium(1.004,moles,water,h,p,0);
  expect(r.temperature).toBe(0);expect(r.ice).toBeCloseTo(ice,8);expect(r.liquid).toBeCloseTo(ice,8);expect(r.energy).toBe(h);
 });
});
