import {describe,it,expect,vi} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,totalMass,totalEnthalpy,totals,seedPlanet,type Environment,type Snapshot} from '../src/sim/model';
import {AIR_LAYERS,AIR_SPECIES,validLayered,surfaceCapacity} from '../src/sim/layeredAtmosphere';
import {WeatherClimate,validClimate} from '../src/sim/weatherClimate';
import {MIN_THERMODYNAMIC_TEMPERATURE,validThermodynamicTemperature} from '../src/sim/thermodynamics';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {ATOMIC_MASS,elementalMass,type Element} from '../src/sim/chemistry';
import {GASES} from '../src/sim/gases';
import {upgradeSnapshot,validSnapshot} from '../src/sim/storage';

const grid=createSphere(0),empty=new Float32Array(grid.count*COMMAND_STRIDE);
const environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true,body:sandboxDefinition('rock')};
function stateAt(temperature:number,nitrogen=.3){const state=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++){const p=i*STRIDE;state[p+F.rock]=8;state[p+F.nitrogen]=nitrogen;state[p+F.temperature]=temperature;}return state;}
function snapshot(s:CpuSolver):Snapshot{return {version:11,preset:'coast',time:0,state:[...s.state],environment,climate:s.climate.snapshot(),supplied:0,removed:0,discoveries:[]};}
function expectValid(s:CpuSolver){expect(s.state.every(Number.isFinite)).toBe(true);expect(s.climate.air.temperature.every(validThermodynamicTemperature)).toBe(true);for(let i=0;i<grid.count;i++)expect(validThermodynamicTemperature(s.climate.air.surfaceTemperature(s.state,i))).toBe(true);expect(validSnapshot(snapshot(s),grid.count)).toBe(true);}

describe('finite-energy aggregate atmosphere initialization',()=>{
 it.each([-272,-273.139])('opens an accepted %s°C old aggregate save without heat or invalid intermediate temperatures',temperature=>{
  const solver=new CpuSolver(grid,stateAt(temperature)),old=snapshot(solver),encoded=JSON.stringify(old),loaded=upgradeSnapshot(old,grid.count);
  expect(validSnapshot(old,grid.count)).toBe(true);expect(JSON.stringify(old)).toBe(encoded);solver.climate.restore(loaded.climate);
  const mass=totalMass(solver.state),energy=totalEnthalpy(solver.state),atoms=elementalMass(totals(solver.state));
  solver.climate.prepareSurface(solver.state,environment,new Float32Array(grid.count*4));solver.climate.air.attach(solver.state);
  expect(solver.climate.air.geometryScale).toBeGreaterThan(0);expect(solver.climate.air.geometryScale).toBeLessThan(1);expectValid(solver);
  expect(totalMass(solver.state,solver.climate)).toBeCloseTo(mass,10);expect(totalEnthalpy(solver.state,solver.climate)-energy).toBeCloseTo(0,8);
  expect(totalEnthalpy(solver.state,solver.climate.snapshot())-energy).toBeCloseTo(0,8);
  const after=elementalMass(totals(solver.state,solver.climate));for(const e of Object.keys(ATOMIC_MASS) as Element[])expect(after[e]).toBeCloseTo(atoms[e],10);
  expect(solver.energyChanges.every(v=>v===0)).toBe(true);
 });
 it.each([0,100000])('keeps a cold column with %s nitrogen finite through evolution and exact save/resume',nitrogen=>{
  const solver=new CpuSolver(grid,stateAt(-273.139,nitrogen)),energy=totalEnthalpy(solver.state),mass=totalMass(solver.state);let boundary=0,escape=0;
  for(let n=0;n<3;n++){solver.advance(1/30,empty,environment);boundary+=solver.energyChanges.reduce((a,b)=>a+b);escape+=solver.escapeCells.reduce((a,b)=>a+b);}
  expectValid(solver);const saved=JSON.parse(JSON.stringify(snapshot(solver))),resumed=new CpuSolver(grid,new Float32Array(saved.state));resumed.climate.restore(saved.climate);
  expect(totalEnthalpy(solver.state,saved.climate)).toBeCloseTo(totalEnthalpy(solver.state,solver.climate),5);
  for(let n=0;n<3;n++){solver.advance(1/30,empty,environment);resumed.advance(1/30,empty,environment);boundary+=solver.energyChanges.reduce((a,b)=>a+b);escape+=solver.escapeCells.reduce((a,b)=>a+b);}
  expect(resumed.state).toEqual(solver.state);expect(resumed.climate.snapshot()).toEqual(solver.climate.snapshot());expectValid(solver);
  expect(Math.abs(totalMass(solver.state,solver.climate)+escape-mass)).toBeLessThan(1e-8*Math.max(1,mass));
  expect(Math.abs(totalEnthalpy(solver.state,solver.climate)-energy-boundary)).toBeLessThan(1e-8*Math.max(1,Math.abs(energy)));
 });
 it('preserves the standard warm sounding and reads old fixed-geometry layer saves',()=>{
  const s=stateAt(20),c=new WeatherClimate(grid),energy=totalEnthalpy(s);c.prepareSurface(s,environment);c.air.attach(s);
  expect(c.air.geometryScale).toBe(1);expect(c.air.height(0)).toBe(500);expect(c.air.thickness(0)).toBe(1000);expect(c.air.temperature[0]).toBe(16.75);expect(c.air.temperature[4]).toBe(-35.25);
  expect(totalEnthalpy(s,c)-energy).toBeCloseTo(0,8);const old=c.air.snapshot()!;old.version=8;delete old.geometryScale;delete old.gasRadiationCache;delete old.boundaryImpulse;expect(validLayered(old,grid.count)).toBe(true);
  const resumed=new WeatherClimate(grid);resumed.restore({...c.snapshot(),atmosphere:old});expect(resumed.air.geometryScale).toBe(1);expect(resumed.air.height(10)).toBe(38000);expect(resumed.air.mass).toEqual(c.air.mass);
 });
 it('restores initial mesh and all stocks exactly when the first integration fails',()=>{
  const solver=new CpuSolver(grid,stateAt(-272)),before=solver.state.slice(),climate=solver.climate.snapshot(),checkpoint=solver.climate.checkpoint();
  const spy=vi.spyOn(solver.climate,'step').mockImplementation(()=>{throw new Error('forced integration failure');});
  expect(()=>solver.advance(1/30,empty,environment)).toThrow('forced integration failure');spy.mockRestore();
  expect(solver.state).toEqual(before);expect(solver.climate.snapshot()).toEqual(climate);expect(solver.climate.checkpoint()).toEqual(checkpoint);expect(solver.energyChanges.every(v=>v===0)).toBe(true);
  solver.advance(1/30,empty,environment);expectValid(solver);expect(solver.climate.air.geometryScale).toBeLessThan(1);
 });
 it('records the actual mesh in schema validation and typed rollback',()=>{
  const s=stateAt(-272),c=new WeatherClimate(grid);c.prepareSurface(s,environment);c.air.attach(s);const saved=c.snapshot(),checkpoint=c.checkpoint(),scale=c.air.geometryScale;
  expect(saved.atmosphere!.version).toBe(9);expect(validClimate(saved,grid.count)).toBe(true);
  for(const geometryScale of [0,-1,NaN,Infinity,1.1])expect(validLayered({...saved.atmosphere,geometryScale},grid.count)).toBe(false);
  c.air.geometryScale=1;c.restoreCheckpoint(checkpoint);expect(c.air.geometryScale).toBe(scale);expect(c.air.snapshot()).toEqual(saved.atmosphere);
 });
 it('does not change boundary heat when a large unchanged mechanical datum cancels',()=>{
  const s=new Float64Array(stateAt(20)),c=new WeatherClimate(grid);c.prepareSurface(s,environment);
  c.air.setSurfaceEnergy(s,0,c.air.surfacePhaseEnergy(s,0)+c.air.surfaceCapacity(s,0)*Math.fround(MIN_THERMODYNAMIC_TEMPERATURE)+.001);
  c.air.setMechanics({potential:()=>1e18,accept:()=>{}});
  const before=c.air.surfaceEnergy(s,0),air=c.air.columnEnergy(0),internal=c.air as unknown as {surfaceBoundaryStep(s:Float64Array,i:number,dt:number,operation:()=>void):void};
  internal.surfaceBoundaryStep(s,0,1,()=>{});expect(c.air.surfaceEnergy(s,0)).toBe(before);expect(c.air.columnEnergy(0)).toBe(air);
 });
 it('keeps air bit-identical when a surface reaction has no actual gas exchange',()=>{
  const s=new Float64Array(stateAt(-272));for(let i=0;i<grid.count;i++){s[i*STRIDE+F.methane]=.01;s[i*STRIDE+F.oxygen]=.1;}
  const c=new WeatherClimate(grid);c.prepareSurface(s,environment);
  for(const temperature of [Math.fround(MIN_THERMODYNAMIC_TEMPERATURE),-273.139,-200.123456,22.123456]){
   c.air.temperature.fill(temperature);c.air.velocity[0]=12.3456789;const before=c.air.temperature.slice(),velocity=c.air.velocity.slice(),mass=c.air.mass.slice();
   c.air.surfaceReaction(s,0,()=>{});expect(c.air.temperature).toEqual(before);expect(c.air.velocity).toEqual(velocity);expect(c.air.mass).toEqual(mass);
  }
 });
 it('advects a cold mixed parcel without cooling the retained donor below its original temperature',()=>{
  const s=new Float64Array(stateAt(20)),c=new WeatherClimate(grid);c.prepareSurface(s,environment);const air=c.air,d=11,r=0;
  air.mass.fill(0);air.dustMass.fill(0);air.temperature.fill(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE));air.velocity.fill(0);
  air.mass[d*AIR_SPECIES+1]=.08749222876670334;air.mass[d*AIR_SPECIES+2]=.0029164074444823582;air.mass[d*AIR_SPECIES+6]=.02916407553127012;air.mass[r*AIR_SPECIES+1]=.03;
  air.velocity.set([-4.640883677640187e-6,2.868223782909137e-6,-2.02257365581882e-7],d*3);
  const before=air.totalEnergy(),mass=air.mass.reduce((a,b)=>a+b),temperature=air.temperature[d],internal=air as unknown as {clearFlux():void;queue(d:number,r:number,fraction:number):void;commit():void};
  for(let n=0;n<50;n++){internal.clearFlux();internal.queue(d,r,4.2719513084712213e-7);internal.commit();expect(air.temperature[d]).toBe(temperature);expect(air.temperature[r]).toBeGreaterThanOrEqual(temperature);}
  const numerical=air.checkpoint().roundoff.reduce((a,b)=>a+b);expect(air.mass.reduce((a,b)=>a+b)).toBeCloseTo(mass,14);expect(air.totalEnergy()-before-numerical).toBeCloseTo(0,11);
 });
 it('uses the authoritative surface capacity during hydraulic transport beside a huge aggregate air mirror',()=>{
  const s=new Float64Array(stateAt(20));for(let i=0;i<grid.count;i++)s[i*STRIDE+F.water]=i===0?2:.1;
  const c=new WeatherClimate(grid);c.prepareSurface(s,environment);c.air.mass[1]=1e16;c.air.attach(s);const ledger=new Float32Array(grid.count*4);c.ocean.reconcile(s,ledger);ledger.fill(0);
  expect(surfaceCapacity(s,0)).not.toBe(c.air.surfaceCapacity(s,0));
  const energy=()=>Array.from({length:grid.count},(_,i)=>c.air.surfaceEnergy(s,i)).reduce((a,b)=>a+b)+c.ocean.energy(),before=energy();let numerical=0;
  for(let n=0;n<10;n++){ledger.fill(0);c.ocean.transport(s,.1,1000,ledger);numerical+=ledger.reduce((a,b,k)=>a+(k%4===3?b:0),0);}
  expect(energy()-before-numerical).toBeCloseTo(0,8);for(let i=0;i<grid.count;i++)expect(validThermodynamicTemperature(c.air.surfaceTemperature(s,i))).toBe(true);
 });
 it.each([{speed:1000,fraction:.3},{speed:5000,fraction:1e-7}])('preserves a cold $speed m/s donor through proportional outflow',({speed,fraction})=>{
  const s=new Float64Array(stateAt(20)),c=new WeatherClimate(grid);c.prepareSurface(s,environment);const air=c.air,d=0,r=11;
  air.mass.fill(0);air.dustMass.fill(0);air.temperature.fill(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE));air.velocity.fill(0);air.mass[d*AIR_SPECIES+1]=.03;air.mass[r*AIR_SPECIES+1]=.03;air.velocity[d*3+2]=speed;
  const temperature=air.temperature[d],velocity=air.velocity.slice(d*3,d*3+3),before=air.totalEnergy(),internal=air as unknown as {clearFlux():void;queue(d:number,r:number,fraction:number):void;commit():void};
  internal.clearFlux();internal.queue(d,r,fraction);internal.commit();
  expect(air.temperature[d]).toBe(temperature);expect(air.velocity.slice(d*3,d*3+3)).toEqual(velocity);expect(air.temperature[r]).toBeGreaterThanOrEqual(temperature);
  const numerical=air.checkpoint().roundoff.reduce((a,b)=>a+b);expect(air.totalEnergy()-before-numerical).toBeCloseTo(0,10);
 });
 it('keeps a cold mixed layer exact under zero momentum, heat and time inputs',()=>{
  const s=new Float64Array(stateAt(20)),c=new WeatherClimate(grid);c.prepareSurface(s,environment);const air=c.air;
  air.mass.fill(0);air.dustMass.fill(0);air.velocity.fill(0);air.temperature.fill(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE));air.mass[1]=.1;air.mass[2]=.001;
  const before=air.temperature.slice(),energy=air.totalEnergy();air.exchangeMomentum(0,[0,0,0],0);expect(air.temperature).toEqual(before);
  const internal=air as unknown as {dynamics(dt:number,e:Environment):void;surfaceExchange(s:Float64Array,i:number,dt:number):void;radiation(s:Float64Array,i:number,dt:number,e:Environment,energy:Float32Array):void};internal.dynamics(0,environment);expect(air.temperature[0]).toBe(before[0]);
  const afterDynamics=air.temperature.slice();internal.surfaceExchange(s,0,0);internal.radiation(s,0,0,environment,new Float32Array(grid.count*4));expect(air.temperature).toEqual(afterDynamics);expect(air.totalEnergy()).toBe(energy);
 });
 it('admits no pressure acceleration when a cold stationary layer has no sensible work budget',()=>{
  const s=new Float64Array(stateAt(20)),c=new WeatherClimate(grid);c.prepareSurface(s,environment);const air=c.air;
  air.mass.fill(0);air.dustMass.fill(0);air.velocity.fill(0);air.temperature.fill(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE));for(let q=0;q<air.temperature.length;q++)air.mass[q*AIR_SPECIES+1]=q<AIR_LAYERS?.06:.03;
  const before=air.totalEnergy(),temperature=air.temperature.slice(),internal=air as unknown as {dynamics(dt:number,e:Environment):void};internal.dynamics(1,environment);
  expect(air.velocity.every(v=>v===0)).toBe(true);expect(air.temperature).toEqual(temperature);expect(air.totalEnergy()).toBe(before);
 });
 it('admits unchanged cloud ice at the same Float32 Kelvin boundary as stored layers',()=>{
  const s=new Float64Array(stateAt(20)),c=new WeatherClimate(grid);c.prepareSurface(s,environment);const air=c.air;
  air.mass.fill(0);air.dustMass.fill(0);air.velocity.fill(0);air.temperature.fill(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE));air.mass[1]=.1;air.mass[2]=.001;air.mass[5]=.001;
  const before=air.temperature.slice(),mass=air.mass.slice(),internal=air as unknown as {phase(q:number,i:number,k:number):void};internal.phase(0,0,0);
  expect(air.temperature).toEqual(before);expect(air.mass).toEqual(mass);
 });
 it('keeps an underflowed zero-mass air parcel inert',()=>{
  const s=new Float64Array(stateAt(20)),c=new WeatherClimate(grid);c.prepareSurface(s,environment);const air=c.air,d=0,r=11;
  air.mass.fill(0);air.dustMass.fill(0);air.velocity.fill(0);air.temperature.fill(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE));air.mass[d*AIR_SPECIES+1]=.03;air.mass[r*AIR_SPECIES+1]=.03;
  const before=air.mass.slice(),temperature=air.temperature[d],energy=air.totalEnergy(),internal=air as unknown as {clearFlux():void;queue(d:number,r:number,fraction:number):void;commit():void};
  expect(.03*Number.MIN_VALUE).toBe(0);internal.clearFlux();internal.queue(d,r,Number.MIN_VALUE);internal.commit();
  expect(air.mass).toEqual(before);expect(air.temperature[d]).toBe(temperature);expect(air.temperature[r]).toBe(temperature);expect(air.totalEnergy()).toBe(energy);
 });
 it('rejects only an energy-empty migration atomically instead of supplying placement heat',()=>{
  const solver=new CpuSolver(grid,stateAt(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE))),before=solver.state.slice(),climate=solver.climate.snapshot();
  expect(validSnapshot(snapshot(solver),grid.count)).toBe(true);expect(()=>solver.advance(1/30,empty,environment)).toThrow('열에너지');
  expect(solver.state).toEqual(before);expect(solver.climate.snapshot()).toEqual(climate);expect(solver.energyChanges.every(v=>v===0)).toBe(true);
  const direct=new WeatherClimate(grid),checkpoint=direct.air.checkpoint();expect(()=>direct.air.initialize(before,environment)).toThrow('열에너지');expect(direct.air.checkpoint()).toEqual(checkpoint);expect(before).toEqual(solver.state);
 });
 it('advances the cold 42-cell mesh with local heat inputs and closes the element and energy ledgers',()=>{
  const g=createSphere(1),s=seedPlanet(g,'rock',-272),commands=new Float32Array(g.count*COMMAND_STRIDE);for(let i=0;i<g.count;i++)s[i*STRIDE+F.nitrogen]=.3;
  const solver=new CpuSolver(g,s),energy=totalEnthalpy(s),before=elementalMass(totals(s)),escaped=new Float64Array(STRIDE);let boundary=0;
  commands[4]=2;solver.advance(0,commands,environment);boundary+=solver.energyChanges.reduce((a,b)=>a+b);commands.fill(0);
  for(let n=0;n<60;n++){
   if(n===15)commands[4]=2;solver.advance(1/30,commands,environment);commands.fill(0);boundary+=solver.energyChanges.reduce((a,b)=>a+b);
   for(let i=0;i<g.count;i++)for(let k=0;k<GASES.length;k++)escaped[GASES[k].field]+=solver.escapeCells[i*GASES.length+k];
  }
  const stock=totals(solver.state,solver.climate);for(let f=0;f<STRIDE;f++)stock[f]+=escaped[f];const after=elementalMass(stock);
  for(const e of Object.keys(ATOMIC_MASS) as Element[])expect(after[e]-before[e]).toBeCloseTo(0,8);
  expect(Math.abs(totalEnthalpy(solver.state,solver.climate)-energy-boundary)).toBeLessThan(1e-6);expect(solver.climate.air.mass.every(v=>v>=0&&Number.isFinite(v))).toBe(true);
  expect(solver.climate.air.temperature).toHaveLength(g.count*AIR_LAYERS);expect(solver.climate.air.mass).toHaveLength(g.count*AIR_LAYERS*AIR_SPECIES);
 });
});
