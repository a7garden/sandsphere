import {describe,it,expect} from 'vitest';
import {waterEquilibrium,waterStateAtTemperature,solveEnthalpy,type CondensateClosure} from '../src/sim/phaseEquilibrium';
import {statisticalCloud} from '../src/sim/climatePhysics';
import {SPECIFIC_HEAT,MATERIAL_ENERGY} from '../src/sim/thermodynamics';
import {saturationPressure,WATER_MOLAR_MASS} from '../src/sim/waterPhysics';

const closures:[string,CondensateClosure|undefined][]=[['homogeneous',undefined],['statistical',(water,sat)=>statisticalCloud(water,sat).condensate]];
function energy(r:ReturnType<typeof waterEquilibrium>,dryCapacity:number,potential:number){
 return dryCapacity*r.temperature+potential+[[9,r.vapor],[16,r.liquid],[17,r.ice]].reduce((sum,[f,mass])=>sum+mass*(SPECIFIC_HEAT[f]*r.temperature+MATERIAL_ENERGY[f]),0);
}

describe.each(closures)('%s water equilibrium',(_name,closure)=>{
 it('allocates the audited pure-steam latent interval without an energy source',()=>{
  const r=waterEquilibrium(0,0,.03,36,50000,0,undefined,undefined,closure);
  expect(r.temperature).toBeCloseTo(81.316,3);
  expect(saturationPressure(r.temperature)).toBeCloseTo(50000,7);
  expect(r.vapor).toBeGreaterThan(0);expect(r.liquid).toBeGreaterThan(0);expect(r.ice).toBe(0);
  expect(r.vapor+r.liquid+r.ice).toBeCloseTo(.03,15);
  expect(r.energy).toBeCloseTo(36,12);expect(energy(r,0,0)).toBeCloseTo(36,12);
 });

 it.each([-60,-10,20,80,150,365])('resolves finite pure-water coexistence at %s C',temperature=>{
  const water=.03,dryCapacity=.2,potential=7,pressure=saturationPressure(temperature,temperature<0?'ice':'water'),condensed=temperature<0?17:16,
   lower=dryCapacity*temperature+potential+water*(SPECIFIC_HEAT[condensed]*temperature+MATERIAL_ENERGY[condensed]),
   upper=dryCapacity*temperature+potential+water*(SPECIFIC_HEAT[9]*temperature+MATERIAL_ENERGY[9]);
  for(const fraction of [0,.01,.25,.75,.99,1]){
   const h=lower+fraction*(upper-lower),r=waterEquilibrium(dryCapacity,0,water,h,pressure,potential,undefined,undefined,closure);
   expect(r.temperature).toBeCloseTo(temperature,9);expect(r.vapor).toBeCloseTo(water*fraction,12);
   expect(r.liquid).toBeCloseTo(temperature<0?0:water*(1-fraction),12);expect(r.ice).toBeCloseTo(temperature<0?water*(1-fraction):0,12);
   expect(r.vapor+r.liquid+r.ice).toBeCloseTo(water,15);expect(energy(r,dryCapacity,potential)).toBeCloseTo(h,8);expect(r.energy).toBeCloseTo(h,8);
  }
 });

 it('preserves the ice-liquid melting plateau below the boiling pressure',()=>{
  const water=.03,h=-334*water*.4,r=waterEquilibrium(.2,0,water,h,50000,0,undefined,undefined,closure);
  expect(r.temperature).toBe(0);expect(r.vapor).toBe(0);expect(r.ice).toBeCloseTo(water*.4,14);expect(r.liquid).toBeCloseTo(water*.6,14);
  expect(energy(r,.2,0)).toBeCloseTo(h,12);
 });

 it('inverts continuous branches on either side of pure-water coexistence',()=>{
  for(const pressure of [100,50000])for(const temperature of [-100,-30,0,10,80,120,400]){
   const at=waterStateAtTemperature(.2,0,.03,pressure,3,temperature,undefined,closure),r=waterEquilibrium(.2,0,.03,at.energy,pressure,3,undefined,undefined,closure);
   expect(r.temperature).toBeCloseTo(temperature,7);expect(energy(r,.2,3)).toBeCloseTo(at.energy,8);
   expect(r.vapor).toBeCloseTo(at.vapor,12);expect(r.liquid).toBeCloseTo(at.liquid,12);expect(r.ice).toBeCloseTo(at.ice,12);
  }
 });

 it('preserves ordinary mixed-gas saturation and subgrid condensate inversions',()=>{
  for(const dryMoles of [1,10,40])for(const temperature of [-100,-20,0,15,70,120]){
   const at=waterStateAtTemperature(1,dryMoles,.03,50000,2,temperature,undefined,closure),r=waterEquilibrium(1,dryMoles,.03,at.energy,50000,2,undefined,undefined,closure);
   expect(r.temperature).toBeCloseTo(temperature,7);expect(energy(r,1,2)).toBeCloseTo(at.energy,8);
   expect(r.vapor).toBeCloseTo(at.vapor,10);expect(r.liquid).toBeCloseTo(at.liquid,10);expect(r.ice).toBeCloseTo(at.ice,10);
  }
 });

 it('inverts near-pure steam by finite saturated stock through both phase branches',()=>{
  for(const dryMoles of [0,1e-20,1e-17,1e-14,1e-11,1e-8,1e-5,1e-3])for(const pressure of [100,50000])for(const fraction of [.2,.95,1.1]){
   const water=.03,saturated=water*fraction,p=pressure*saturated/(saturated+WATER_MOLAR_MASS*dryMoles),frozen=pressure===100,
    dryCapacity=dryMoles*.028014*1.04,potential=2,cloud=closure?closure(water,saturated):Math.max(0,water-saturated);
   let lo=frozen?-150:0,hi=frozen?0:373.946;
   for(let n=0;n<64;n++){const mid=(lo+hi)/2;if(saturationPressure(mid,frozen?'ice':'water')<p)lo=mid;else hi=mid;}
   const t=(lo+hi)/2,expected={temperature:t,vapor:water-cloud,liquid:frozen?0:cloud,ice:frozen?cloud:0,energy:0},h=energy(expected,dryCapacity,potential),
    r=waterEquilibrium(dryCapacity,dryMoles,water,h,pressure,potential,undefined,undefined,closure);
   expect(Math.abs(energy(r,dryCapacity,potential)-h)).toBeLessThan(1e-8);
   expect(r.vapor+r.liquid+r.ice).toBeCloseTo(water,15);expect(r.vapor).toBeCloseTo(expected.vapor,10);
   expect(r.liquid).toBeCloseTo(expected.liquid,10);expect(r.ice).toBeCloseTo(expected.ice,10);
   expect(r.temperature).toBeCloseTo(t,7);
   expect(Math.abs(saturationPressure(r.temperature,frozen?'ice':'water')/p-1)).toBeLessThan(1e-8);
  }
 });

 it('resolves a small vapor stock without requiring sub-ULP condensed mass',()=>{
  const temperature=.01,water=10,vapor=.01;
  for(const dryMoles of [1e-25,1e-18,1e-12,1e-6]){
   const dryCapacity=dryMoles*.028014*1.04,pressure=saturationPressure(temperature)*(1+WATER_MOLAR_MASS*dryMoles/vapor),
    h=dryCapacity*temperature+vapor*(SPECIFIC_HEAT[9]*temperature+MATERIAL_ENERGY[9])+(water-vapor)*SPECIFIC_HEAT[16]*temperature,
    r=waterEquilibrium(dryCapacity,dryMoles,water,h,pressure,0,undefined,undefined,closure);
   expect(r.temperature).toBeCloseTo(temperature,9);expect(r.vapor).toBeCloseTo(vapor,12);expect(r.liquid).toBeCloseTo(water-vapor,12);expect(r.ice).toBe(0);
   expect(r.vapor+r.liquid+r.ice).toBe(water);expect(Math.abs(energy(r,dryCapacity,0)-h)).toBeLessThan(1e-10);
  }
 });

 it('resolves near-pure states across inventory and dry-gas scales',()=>{
  for(const temperature of [-.01,.0001,.01,20])for(const water of [.03,10,1000])for(const dryMoles of [1e-25,1e-12,1e-4])for(const fraction of [1e-5,.001,.2,.95]){
   const frozen=temperature<0,condensed=frozen?17:16,saturated=water*fraction,cloud=closure?closure(water,saturated):water-saturated,
    expectedVapor=water-cloud,dryCapacity=dryMoles*.028014*1.04,partial=saturationPressure(temperature,frozen?'ice':'water'),
    pressure=partial*(1+WATER_MOLAR_MASS*dryMoles/saturated),
    h=dryCapacity*temperature+expectedVapor*(SPECIFIC_HEAT[9]*temperature+MATERIAL_ENERGY[9])+cloud*(SPECIFIC_HEAT[condensed]*temperature+MATERIAL_ENERGY[condensed]),
    r=waterEquilibrium(dryCapacity,dryMoles,water,h,pressure,0,undefined,undefined,closure),context=`T=${temperature}, water=${water}, dry=${dryMoles}, fraction=${fraction}`,
    // The ordinary T branch retains its relative energy criterion. Stock
    // inversion also has an independently bounded total-water mass quantum.
    latent=MATERIAL_ENERGY[9]-MATERIAL_ENERGY[condensed],energyResolution=Math.max(1e-11*Math.max(1,Math.abs(h)),32*Number.EPSILON*water*latent),
    massResolution=2*energyResolution/latent;
   expect(Math.abs(r.vapor-expectedVapor),context).toBeLessThan(massResolution);
   expect(Math.abs((r.liquid+r.ice)-cloud),context).toBeLessThan(massResolution);
   expect(r.vapor+r.liquid+r.ice,context).toBeCloseTo(water,11);
   expect(frozen?r.liquid:r.ice,context).toBe(0);expect(r.temperature,context).toBeCloseTo(temperature,8);
   expect(Math.abs(saturationPressure(r.temperature,frozen?'ice':'water')/partial-1),context).toBeLessThan(1e-9);
   expect(Math.abs(energy(r,dryCapacity,0)-h),context).toBeLessThan(energyResolution);
  }
 });
});

describe('phase inversion numerical limits',()=>{
 it('preserves enthalpy with arbitrarily dilute dry gas',()=>{
  for(const dryMass of [1e-20,1e-16,1e-12,1e-8,1e-4]){
   const r=waterEquilibrium(1.04*dryMass,dryMass/.028014,.03,36,5e4,0);
   expect(Math.abs(energy(r,1.04*dryMass,0)-36),`dry mass ${dryMass}`).toBeLessThan(1e-8);
  }
 });
 it('resolves pure-water energies across the former 0 C fit gap',()=>{
  for(const pressure of [611.14,611.15,611.16,611.18,611.20,611.21,611.22])for(const h of [-10.02,-8,-4,-1,0]){
   const r=waterEquilibrium(0,0,.03,h,pressure,0);
   expect(Math.abs(energy(r,0,0)-h),`p=${pressure}, h=${h}`).toBeLessThan(1e-8);
   if(r.ice>0)expect(r.temperature).toBeLessThanOrEqual(0);
  }
 });
 it.each([
  [.03196439450387624,1.0971298177791682,.00028963165649717454,1.2995416741364154,70834.80057268322,.913054754120979],
  [.02478751431578879,.8506975905325084,.00017017427395761987,1.1015169134740286,58840.130064484394,.7065277022885222],
 ])('resolves the coupled parcel melting-boundary regression %#',(dryCapacity,dryMoles,water,h,pressure,potential)=>{
  const r=waterEquilibrium(dryCapacity,dryMoles,water,h,pressure,potential),partial=pressure*r.vapor/(r.vapor+WATER_MOLAR_MASS*dryMoles);
  expect(r.temperature).toBe(0);expect(r.liquid).toBeGreaterThan(0);expect(r.ice).toBeGreaterThan(0);
  expect(r.vapor+r.liquid+r.ice).toBeCloseTo(water,15);expect(energy(r,dryCapacity,potential)).toBeCloseTo(h,13);
  expect(partial).toBeCloseTo(saturationPressure(0,'ice'),10);expect(partial).toBeCloseTo(saturationPressure(0,'water'),10);
 });
 it('rejects an unconverged discontinuous energy function',()=>{
  expect(()=>solveEnthalpy(t=>({energy:t<1?0:10}),5,0,2,.5)).toThrow('수렴');
 });
 it('rejects nonfinite pressure instead of returning a plausible water state',()=>{
  for(const pressure of [NaN,Infinity,-Infinity])expect(()=>waterEquilibrium(0,0,.03,36,pressure,0)).toThrow('압력');
 });
 it('does not use inventory roundoff to admit energy beyond a temperature boundary',()=>{
  for(const water of [10,1000])for(const dryMoles of [1e-25,1e-6]){
   const dryCapacity=dryMoles*.028014*1.04,pressure=saturationPressure(.02),upper=waterStateAtTemperature(dryCapacity,dryMoles,water,pressure,0,.01),
    lower=waterStateAtTemperature(dryCapacity,dryMoles,water,pressure,0,-10);
   expect(()=>waterEquilibrium(dryCapacity,dryMoles,water,upper.energy+water*1e-8,pressure,0,undefined,.01)).toThrow('범위');
   expect(()=>waterEquilibrium(dryCapacity,dryMoles,water,lower.energy-water*1e-8,pressure,0,-10)).toThrow('범위');
  }
 });
});
