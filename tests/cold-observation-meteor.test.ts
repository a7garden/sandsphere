import {describe,it,expect} from 'vitest';
import {atmosphereState} from '../src/sim/atmosphere';
import {bindingParameter,thermalEscapeFraction,GAS_CONSTANT,EARTH_GRAVITY,ESCAPE_GAME_RATE,GASES} from '../src/sim/gases';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,seedPlanet,totalMass,totalEnthalpy,totals,type Environment} from '../src/sim/model';
import {impactMeteor} from '../src/sim/meteor';
import {createSphere} from '../src/sim/sphere';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {WeatherClimate} from '../src/sim/weatherClimate';
import {AIR_SPECIES,AIR_GAS_INDICES,AIR_FIELDS} from '../src/sim/layeredAtmosphere';
import {MIN_THERMODYNAMIC_TEMPERATURE,SPECIFIC_HEAT,MATERIAL_ENERGY} from '../src/sim/thermodynamics';

const environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:.01,climate:true,body:sandboxDefinition('rock',.01)};

describe('subkelvin gas laws and observations',()=>{
 it('uses the actual positive Kelvin binding and escape rate below 1 K',()=>{
  for(const temperature of [Math.fround(MIN_THERMODYNAMIC_TEMPERATURE),-273.05,-272.65,20]){
   const expected=.01*EARTH_GRAVITY*1000*.028014/(GAS_CONSTANT*(temperature+273.15));
   expect(bindingParameter(temperature,.01,.028014,1000)).toBeCloseTo(expected,12);
   const fraction=thermalEscapeFraction(temperature,.01,.028014,1/30,1000);
   const expectedFraction=-Math.expm1(-1/30*ESCAPE_GAME_RATE*(1+expected)*Math.exp(-expected));
   expect(Math.abs(fraction-expectedFraction)).toBeLessThanOrEqual(expectedFraction*Number.EPSILON*4);expect(fraction).toBeGreaterThanOrEqual(0);expect(fraction).toBeLessThanOrEqual(1);
  }
  expect(thermalEscapeFraction(-273.14,.01,.028014,1/30,1000)).toBeLessThan(1e-14);
  expect(thermalEscapeFraction(-273.05,.01,.028014,1/30,1000)).toBeGreaterThan(thermalEscapeFraction(-273.14,.01,.028014,1/30,1000));
 });
 it('rejects absolute zero and nonfinite temperatures instead of substituting a floor',()=>{
  for(const temperature of [-273.15,-274,NaN,Infinity])expect(()=>bindingParameter(temperature,1,.028014)).toThrow(RangeError);
 });
 it('reads the actual mole mean and scale height of aggregate subkelvin gas',()=>{
  const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE);
  state[F.temperature]=-273.139;state[F.nitrogen]=.028014;
  state[STRIDE+F.temperature]=-272.8;state[STRIDE+F.methane]=.032086;
  const n=state[F.nitrogen]/.028014,m=state[STRIDE+F.methane]/.016043;
  const kelvin=(n*(state[F.temperature]+273.15)+m*(state[STRIDE+F.temperature]+273.15))/(n+m);
  const before=state.slice(),info=atmosphereState(state,environment);
  expect(info.temperature+273.15).toBeCloseTo(kelvin,12);
  expect(info.scaleHeightKm).toBeCloseTo(GAS_CONSTANT*kelvin/(info.molarMass*EARTH_GRAVITY*.01)/1000,12);
  expect(state).toEqual(before);
 });
 it('reads canonical layer temperatures identically from live and saved climates',()=>{
  const grid=createSphere(0),state=new Float64Array(seedPlanet(grid,'rock',20)),climate=new WeatherClimate(grid);
  climate.prepareSurface(state,environment);climate.air.attach(state);
  const air=climate.air;air.mass.fill(0);air.dustMass.fill(0);
  air.mass[1]=.03;air.temperature[0]=-273.139;
  air.mass[AIR_SPECIES+2]=.016;air.temperature[1]=-272.8;
  const n=.03/.028014,m=.016/.016043,kelvin=(n*(air.temperature[0]+273.15)+m*(air.temperature[1]+273.15))/(n+m);
  const published=climate.publishSurface(state),before=climate.checkpoint(),info=atmosphereState(published,environment,climate);
  expect(info.temperature+273.15).toBeCloseTo(kelvin,12);
  expect(info.scaleHeightKm).toBeCloseTo(GAS_CONSTANT*kelvin/(info.molarMass*EARTH_GRAVITY*.01)/1000,12);
  expect(atmosphereState(published,environment,climate.snapshot())).toEqual(info);
  expect(climate.checkpoint()).toEqual(before);
 });
 it('advances the original low-binding nitrogen fixture at the positive Kelvin boundary',()=>{
  const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE),temperature=Math.fround(MIN_THERMODYNAMIC_TEMPERATURE);
  const e={...environment,body:{...sandboxDefinition('rock',.01),radiusMeters:1000}};
  for(let i=0;i<grid.count;i++){state[i*STRIDE+F.rock]=8;state[i*STRIDE+F.temperature]=temperature+1e-3;state[i*STRIDE+F.nitrogen]=.3;}
  const solver=new CpuSolver(grid,state);solver.climate.prepareSurface(solver.state,e);solver.climate.air.temperature.fill(temperature);
  for(let i=0;i<grid.count;i++){solver.state[i*STRIDE+F.temperature]=temperature;solver.climate.air.surfaceHeatCarry[i]=0;}
  solver.climate.air.attach(solver.state);
  const mass=totalMass(solver.state,solver.climate),energy=totalEnthalpy(solver.state,solver.climate);
  expect(()=>solver.advance(1/30,new Float32Array(grid.count*COMMAND_STRIDE),e)).not.toThrow();
  expect(Math.min(...solver.climate.air.temperature)).toBeGreaterThanOrEqual(temperature);
  expect(totalMass(solver.state,solver.climate)+solver.escapeCells.reduce((a,b)=>a+b,0)).toBeCloseTo(mass,10);
  expect(totalEnthalpy(solver.state,solver.climate)-energy-solver.energyChanges.reduce((a,b)=>a+b,0)).toBeCloseTo(0,9);
 });
 it.each([Math.fround(MIN_THERMODYNAMIC_TEMPERATURE),20,1000])('exports actual mixed-species stock with unchanged temperature and velocity at %s C',temperature=>{
  const grid=createSphere(0),state=new Float64Array(seedPlanet(grid,'rock',20)),climate=new WeatherClimate(grid);
  climate.prepareSurface(state,environment);const air=climate.air;
  air.mass.fill(0);air.dustMass.fill(0);air.velocity.fill(0);air.temperature.fill(temperature);air.radiusMeters=1000;
  for(const f of AIR_GAS_INDICES)air.mass[AIR_SPECIES+f]=.03+f*.001;
  for(const f of [4,5,8])air.mass[AIR_SPECIES+f]=.002;
  air.dustMass[1]=.001;air.velocity.set([3,-4,2],3);
  const before=air.mass.slice(),temperatures=air.temperature.slice(),velocity=air.velocity.slice(),energy=air.totalEnergy(),ledger=new Float32Array(grid.count*4),escaped=new Float32Array(grid.count*GASES.length);
  const internal=air as unknown as {escape(dt:number,e:Environment,ledger:Float32Array,escaped:Float32Array):void};
  internal.escape(1/30,environment,ledger,escaped);
  let exported=0,removed=0;
  for(const f of AIR_GAS_INDICES){
   const amount=before[AIR_SPECIES+f]-air.mass[AIR_SPECIES+f],field=AIR_FIELDS[f],gas=GASES.findIndex(g=>g.field===field);
   removed+=amount;exported+=amount*(SPECIFIC_HEAT[field]*temperature+MATERIAL_ENERGY[field]+(9.81*.01*air.height(1)+29/2)/1000);
   expect(escaped[gas]).toBe(Math.fround(amount));
  }
  expect(removed).toBeGreaterThan(0);expect(air.temperature).toEqual(temperatures);expect(air.velocity).toEqual(velocity);
  for(const f of [4,5,8])expect(air.mass[AIR_SPECIES+f]).toBe(before[AIR_SPECIES+f]);expect(air.dustMass[1]).toBe(.001);
  expect(Math.abs(ledger[2]+exported)).toBeLessThan(Math.max(1e-12,Math.abs(exported)*2e-7));
  const numerical=air.checkpoint().roundoff.reduce((a,b)=>a+b,0);
  expect(Math.abs(air.totalEnergy()-energy+exported-numerical)).toBeLessThan(1e-11);
  expect(Math.abs(numerical)).toBeLessThan(1e-11);
  // A requested escape below storage resolution exports no physical stock.
  ledger.fill(0);escaped.fill(0);const unchanged=air.mass.slice();internal.escape(1e-20,environment,ledger,escaped);
  expect(air.mass).toEqual(unchanged);expect(ledger.every(v=>v===0)).toBe(true);expect(escaped.every(v=>v===0)).toBe(true);
 });
});

describe('meteor material and thermal boundary',()=>{
 it.each([0,1,2])('deposits the full sub-cell footprint at sphere level %s',level=>{
  const grid=createSphere(level),state=seedPlanet(grid,'sand',20),before=totalMass(state),energy=totalEnthalpy(state),ledger=new Float64Array(4);
  const result=impactMeteor(state,grid,[1,0,0],36,ledger);
  expect(totalMass(result)-before).toBeCloseTo(36,3);expect(totals(result)[F.iron]).toBeCloseTo(36,5);
  expect(ledger[1]).toBe(64800);expect(Math.abs(ledger[3])).toBeLessThan(.02);
  expect(totalEnthalpy(result)-energy-ledger[1]-ledger[3]).toBeCloseTo(0,8);
  if(level===0){
   let nearest=0;for(let i=1;i<grid.count;i++)if(grid.directions[i*3]>grid.directions[nearest*3])nearest=i;
   expect(result[nearest*STRIDE+F.iron]).toBe(36);
  }
 });
 it.each([.3,1e16])('keeps surface heat independent of aggregate atmospheric stock %s',atmosphericStock=>{
  const grid=createSphere(1),state=new Float64Array(seedPlanet(grid,'sand',20)),climate=new WeatherClimate(grid);
  const e={...environment,gravity:1,body:sandboxDefinition('rock')};
  for(let i=0;i<grid.count;i++){state[i*STRIDE+F.nitrogen]=.3;state[i*STRIDE+F.temperature]=i===0?300:20;}
  climate.prepareSurface(state,e);climate.air.mass[1]=atmosphericStock;climate.air.attach(state);
  const published=climate.publishSurface(state);
  const surfaceEnergy=(s:Float32Array)=>{const actual=climate.physicalSurface(s);let sum=0;for(let i=0;i<grid.count;i++)sum+=climate.air.surfaceEnergy(actual,i);return sum;};
  const initialHeat=surfaceEnergy(published),initialPotential=climate.ocean.energy(),ledger=new Float64Array(4);
  const result=impactMeteor(published,grid,[...grid.directions.subarray(0,3)],36,ledger,climate);
  // External terrain work uses a Float32 ledger; its existing roundoff is
  // about 2.4e-6 here for either atmospheric inventory.
  expect(Math.abs(surfaceEnergy(result)-initialHeat+climate.ocean.energy()-initialPotential-ledger[1])).toBeLessThan(1e-5);
  expect(totals(result,climate)[F.iron]).toBeCloseTo(36,10);
 });
});
