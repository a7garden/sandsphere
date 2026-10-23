import {describe,it,expect} from 'vitest';
import {admitLocalChange} from '../src/sim/mechanicalBoundary';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,capacity,enthalpy,equilibrateWater,react,type Environment} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {OceanDynamics} from '../src/sim/oceanDynamics';
import {MIN_THERMODYNAMIC_TEMPERATURE,validThermodynamicTemperature,writeFloat32ThermalEnergy} from '../src/sim/thermodynamics';
import {bathHeat} from '../src/sim/climate';
import {BIO_REACTIONS} from '../src/sim/ecology';
import {photoreaction} from '../src/sim/materialReaction';

describe('local changes spend finite thermal and mechanical energy',()=>{
 it('admits the largest affordable local conversion and accepts its coordinate once',()=>{
  const state=new Float32Array([MIN_THERMODYNAMIC_TEMPERATURE+10,0,42,7]),outside=state.slice(2);
  let carry=0,accepts=0;
  const energy=()=>state[0]+carry,potential=()=>state[1]*100,total=energy()+potential();
  const accepted=admitLocalChange(state,0,2,fraction=>{state[1]=fraction;},{
   energy,potential,capacity:()=>1,phase:()=>0,
   setEnergy:(s,_i,h)=>{carry=writeFloat32ThermalEnergy(s,0,h,1,0);},
   accept:()=>{accepts++;},
  });
  expect(accepted).toBeGreaterThan(.09999);expect(accepted).toBeLessThan(.10001);
  expect(state[1]).toBeGreaterThan(0);expect(state[0]).toBeGreaterThanOrEqual(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE));
  expect(energy()+potential()).toBeCloseTo(total,11);
  expect(accepts).toBe(1);expect(state.slice(2)).toEqual(outside);
 });

 it('does not mint work when a reservoir has no remaining thermal budget',()=>{
  const state=new Float32Array([0,0]),minimum=Math.fround(MIN_THERMODYNAMIC_TEMPERATURE);let heat=minimum,accepts=0;
  const accepted=admitLocalChange(state,0,2,fraction=>{state[1]=fraction;},{
   energy:()=>heat,potential:s=>s[1],capacity:()=>1,phase:()=>0,
   setEnergy:(_s,_i,h)=>{heat=h;},accept:()=>{accepts++;},
  });
  expect(accepted).toBe(0);expect(state[1]).toBe(0);expect(heat).toBe(minimum);expect(accepts).toBe(1);
 });

 it('keeps unchanged potential from erasing thermal low bits at the Kelvin boundary',()=>{
  const state=new Float64Array([0]),minimum=Math.fround(MIN_THERMODYNAMIC_TEMPERATURE);let heat=minimum;
  const accepted=admitLocalChange(state,0,1,()=>{}, {
   energy:()=>heat,potential:()=>1e18,capacity:()=>1,phase:()=>0,setEnergy:(_s,_i,h)=>{heat=h;},accept:()=>{},
  });
  expect(accepted).toBe(1);expect(heat).toBe(minimum);
 });

 it('replays a shorter actual conversion when its nested candidate is unaffordable',()=>{
  const state=new Float64Array([0]),minimum=Math.fround(MIN_THERMODYNAMIC_TEMPERATURE);let heat=minimum+1,calls=0;
  const initial=heat;
  const accepted=admitLocalChange(state,0,1,fraction=>{
   calls++;state[0]=fraction;
   admitLocalChange(state,0,1,()=>{}, {
    energy:()=>minimum+.25-state[0],potential:()=>0,capacity:()=>1,phase:()=>0,setEnergy:()=>{},accept:()=>{},
   });
  },{energy:()=>heat,potential:s=>s[0]*.5,capacity:()=>1,phase:()=>0,setEnergy:(_s,_i,h)=>{heat=h;},accept:()=>{}});
  expect(calls).toBeGreaterThan(2);expect(accepted).toBeGreaterThan(.24999);expect(accepted).toBeLessThanOrEqual(.25);
  expect(state[0]).toBe(accepted);expect(heat+state[0]*.5).toBe(initial);expect(heat).toBeGreaterThan(minimum);
 });

 it('propagates unrelated conversion errors instead of treating them as an energy limit',()=>{
  const state=new Float64Array([0]),error=new Error('unrelated conversion failure');let calls=0;
  expect(()=>admitLocalChange(state,0,1,()=>{calls++;throw error;},{
   energy:()=>0,potential:()=>0,capacity:()=>1,phase:()=>0,setEnergy:()=>{},accept:()=>{},
  })).toThrow(error);expect(calls).toBe(1);
 });

 it('rejects an already overdrawn reservoir without accepting a new coordinate',()=>{
  const state=new Float32Array([3,0]),before=state.slice();let accepts=0;
  expect(()=>admitLocalChange(state,0,2,fraction=>{state[1]=fraction;},{
   energy:()=>MIN_THERMODYNAMIC_TEMPERATURE-1,potential:s=>s[1],capacity:()=>1,phase:()=>0,
   setEnergy:()=>{throw new Error('invalid state must not be committed');},accept:()=>{accepts++;},
  })).toThrow('초기 에너지');
  expect(state).toEqual(before);expect(accepts).toBe(0);
 });

 it('preserves an inert column at the explicitly valid Float32 Kelvin boundary',()=>{
  const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE),temperature=Math.fround(MIN_THERMODYNAMIC_TEMPERATURE);
  state[F.temperature]=temperature;state[F.rock]=1;
  const before=state.slice(),solver=new CpuSolver(grid,state),environment:Environment={ambient:temperature,sunlight:0,sun:[1,0,0],gravity:1,climate:false};
  const energyBefore=solver.climate.air.surfaceEnergy(state,0);
  expect(()=>react(state,0,1/30,environment,grid,undefined,undefined,undefined,solver.energyChanges,undefined,
   {potential:()=>0,accept:()=>{}},solver.climate.air)).not.toThrow();
  expect(state).toEqual(before);expect(solver.climate.air.surfaceEnergy(state,0)).toBe(energyBefore);expect(solver.climate.air.surfaceHeatCarry[0]).toBe(0);expect(solver.energyChanges.every(v=>v===0)).toBe(true);
 });

 it.each([{temperature:-10,water:10,ice:0,salt:.2},{temperature:5,water:0,ice:10,salt:.2}])(
  'pays water/ice and salt geometry once at $temperature C',({temperature,water,ice,salt})=>{
   const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE),ocean=new OceanDynamics(grid,[]),ledger=new Float32Array(grid.count*4);
   state[F.temperature]=temperature;state[F.rock]=8;state[F.water]=water;state[F.ice]=ice;state[F.salt]=salt;
   ocean.setThermal(undefined,false);ocean.configure(state,9.81);ocean.reconcile(state,ledger);ledger.fill(0);
   const energy=()=>enthalpy(state,0)+ocean.energy(),before=energy(),initialPhase=state[F.water];let accepts=0;
   equilibrateWater(state,0,{potential:(s,i)=>ocean.columnPotential(s,i),accept:(s,i)=>{accepts++;ocean.acceptPotential(s,i);}});
   const after=energy(),temperatureAfter=state[F.temperature];
   expect(state[F.water]).not.toBe(initialPhase);expect(Math.abs(after-before)).toBeLessThan(.002);
   ocean.reconcile(state,ledger);
   expect(state[F.temperature]).toBe(temperatureAfter);expect(energy()).toBe(after);expect(accepts).toBe(1);
  },
 );

 it('keeps nested reaction equilibrium and the subsequent mechanical reconciliation from charging twice',()=>{
  const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE),environment:Environment={ambient:-10,sunlight:0,sun:[1,0,0],gravity:1,climate:true};
  state[F.temperature]=-10;state[F.rock]=8;state[F.water]=10;state[F.salt]=.2;
  const solver=new CpuSolver(grid,state),ocean=solver.climate.ocean,thermal=solver.climate.air,ledger=solver.energyChanges;
  ocean.setThermal(thermal,false);ocean.configure(state,9.81);ocean.reconcile(state,ledger);ledger.fill(0);
  const energy=()=>thermal.surfaceEnergy(state,0)+ocean.energy(),before=energy();
  react(state,0,1/30,environment,grid,solver.escapeCells,solver.condensedCells,solver.precipitatedCells,ledger,solver.feedingCells,
   {potential:(s,i)=>ocean.columnPotential(s,i),accept:(s,i)=>ocean.acceptPotential(s,i)},thermal);
  expect(state[F.ice]).toBeGreaterThan(0);expect(Math.abs(energy()-before)).toBeLessThan(1e-9);
  const after=energy(),temperatureAfter=state[F.temperature],carryAfter=thermal.surfaceHeatCarry[0];
  ocean.reconcile(state,ledger);
  expect(energy()).toBe(after);expect(state[F.temperature]).toBe(temperatureAfter);expect(thermal.surfaceHeatCarry[0]).toBe(carryAfter);
 });

 it('keeps the full external heat input when mechanical work limits the internal conversion',()=>{
  const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE),dt=1/30;
  state[F.temperature]=-10;state[F.water]=10;
  const solver=new CpuSolver(grid,state),thermal=solver.climate.air,ledger=solver.energyChanges;
  const environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:false};
  const before=thermal.surfaceEnergy(state,0),expected=bathHeat(capacity(state,0),-10,20,dt);let accepts=0;
  react(state,0,dt,environment,grid,solver.escapeCells,solver.condensedCells,solver.precipitatedCells,ledger,solver.feedingCells,
   {potential:s=>s[F.ice]*1e8,accept:()=>{accepts++;}},thermal);
  expect(expected).toBeGreaterThan(0);expect(state[F.ice]).toBeGreaterThan(0);expect(state[F.ice]).toBeLessThan(1);
  expect(ledger[0]).toBe(Math.fround(expected));expect(thermal.surfaceEnergy(state,0)+state[F.ice]*1e8-before).toBeCloseTo(expected,9);expect(accepts).toBe(1);
  expect(validThermodynamicTemperature(thermal.surfaceTemperature(state,0))).toBe(true);
  expect(solver.precipitatedCells.every(v=>v===0)).toBe(true);
  expect(solver.condensedCells[0]).toBeCloseTo(state[F.cloud]+state[F.cloudIce],15);
 });

 it('limits a surface photoreaction by the actual cold air reservoir as well as total energy',()=>{
  const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE),environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true};
  state[F.temperature]=20;state[F.rock]=8;state[F.plant]=10;state[F.water]=.1;state[F.carbonDioxide]=.3;state[F.photonEnergy]=100000;
  const solver=new CpuSolver(grid,state),air=solver.climate.air;
  solver.climate.prepareSurface(state,environment);air.mass.fill(0);air.mass[3]=.3;air.temperature.fill(-273.13);air.velocity.fill(0);air.attach(state);
  const before=solver.climate.energy(state);
  air.surfaceReaction(state,0,fraction=>{const spent=photoreaction(state,0,BIO_REACTIONS.uptake,.2*fraction,state[F.photonEnergy]);state[F.photonEnergy]-=spent;});
  expect(validThermodynamicTemperature(air.temperature[0])).toBe(true);
  expect(validThermodynamicTemperature(air.surfaceTemperature(state,0))).toBe(true);
  expect(air.mass[3]).toBeGreaterThan(.1);expect(air.mass[3]).toBeLessThan(.3);
  expect(solver.climate.energy(state)).toBeCloseTo(before,9);
 });

 it('does not force unaffordable cold-liquid equilibrium below the Kelvin boundary',()=>{
  const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE),environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true};
  state[F.temperature]=20;state[F.water]=1;state[F.rock]=8;
  const solver=new CpuSolver(grid,state),air=solver.climate.air;
  solver.climate.prepareSurface(state,environment);
  air.setSurfaceEnergy(state,0,air.surfaceCapacity(state,0)*Math.fround(MIN_THERMODYNAMIC_TEMPERATURE));
  const before=state.slice(),energy=solver.climate.energy(state),carry=air.surfaceHeatCarry[0];
  // An admissible partial/deferred conversion or an atomic refusal is allowed;
  // neither may publish an invalid temperature or invent compensating heat.
  try{air.equilibrateSurfaceWater(state,0);}catch(error){expect(error).toBeInstanceOf(Error);}
  expect(validThermodynamicTemperature(air.surfaceTemperature(state,0))).toBe(true);
  expect(state).toEqual(before);expect(air.surfaceHeatCarry[0]).toBe(carry);expect(solver.climate.energy(state)).toBe(energy);
 });

 it.each([false,true])('rolls back earlier column heat and mechanical coordinates after a later invalid command (layered=%s)',layered=>{
  const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE),environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:layered};
  for(let i=0;i<grid.count;i++){state[i*STRIDE+F.temperature]=20;state[i*STRIDE+F.rock]=8;state[i*STRIDE+F.nitrogen]=.3;}
  const solver=new CpuSolver(grid,state),air=solver.climate.air;
  if(layered){solver.climate.prepareSurface(state,environment);air.attach(state);}
  air.addSurfaceHeat(state,0,.00001);
  const before=state.slice(),checkpoint=solver.climate.checkpoint(),commands=new Float32Array(grid.count*COMMAND_STRIDE);
  commands[4]=.00001;commands[COMMAND_STRIDE+4]=-1e9;
  expect(()=>solver.advance(0,commands,environment)).toThrow();
  expect(solver.state).toEqual(before);expect(solver.climate.checkpoint()).toEqual(checkpoint);expect(solver.energyChanges.every(v=>v===0)).toBe(true);
 });
});
