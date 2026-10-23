import {describe,it,expect} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,seedPlanet,totalMass,totalEnthalpy,type PhysicalState,type Environment} from '../src/sim/model';
import {WeatherClimate,validClimate} from '../src/sim/weatherClimate';
import {AIR_LAYERS,AIR_SPECIES,type LayeredAtmosphere} from '../src/sim/layeredAtmosphere';
import {radiativeFluxes} from '../src/sim/climatePhysics';
import {createMarsPlanet} from '../src/sim/planetCreation';
import {SPECIFIC_HEAT,MATERIAL_ENERGY} from '../src/sim/thermodynamics';
const grid=createSphere(0),environment:Environment={ambient:50,sunlight:0,sun:[1,0,0],gravity:1,rotationRate:0,climate:true};
type Internals={surfaceExchange(s:PhysicalState,i:number,dt:number):void;precipitation(s:PhysicalState,i:number,dt:number,p?:Float32Array):void;depositPrecipitation(s:PhysicalState,i:number,field:typeof F.water|typeof F.ice,mass:number,energy:number,momentum:number[],p?:Float32Array):void;radiation(s:PhysicalState,i:number,dt:number,e:Environment,energy:Float32Array):void;dynamics(dt:number,e:Environment):void;surfaceBoundaryStep(s:PhysicalState,i:number,dt:number,operation:(seconds:number)=>void):void};
const local=(air:LayeredAtmosphere)=>air as unknown as Internals;
function world(t=50){
 const s=new Float64Array(seedPlanet(grid,'sand',t));for(let i=0;i<grid.count;i++){s[i*STRIDE+F.sand]=100;s[i*STRIDE+F.water]=1;}
 const c=new WeatherClimate(grid);c.prepareSurface(s,environment);if(t<0)for(let i=0;i<grid.count;i++)c.air.equilibrateSurfaceWater(s,i);c.ocean.reconcile(s,new Float32Array(grid.count*4));return {s,c,air:c.air};
}
function momentum(c:WeatherClimate,i=0){return [0,1,2].map(v=>Array.from({length:AIR_LAYERS},(_,k)=>c.air.layerMass(i*AIR_LAYERS+k)*c.air.velocity[(i*AIR_LAYERS+k)*3+v]).reduce((a,b)=>a+b,0)+c.ocean.momentum[i*3+v]+c.ocean.boundaryImpulse[v]+c.air.boundaryImpulse[v]);}
const closeVector=(a:number[],b:number[],digits=11)=>a.forEach((v,k)=>expect(v).toBeCloseTo(b[k],digits));
describe('alpha18 finite atmospheric material exchange',()=>{
 it('dilutes 100 m/s air with stationary evaporated water over one physical second',()=>{
  const {s,c,air}=world();air.velocity.set([100,0,0],0);
  const before=momentum(c),mass=air.layerMass(0),h=air.surfaceEnergy(s,0)+air.columnEnergy(0),water=s[F.water];
  local(air).surfaceExchange(s,0,1);const moved=water-s[F.water];
  expect(moved).toBeGreaterThan(0);closeVector(momentum(c),before,12);
  expect(air.velocity[0]).toBeCloseTo(mass*100/(mass+moved),12);
  expect(air.surfaceEnergy(s,0)+air.columnEnergy(0)-h).toBeCloseTo(0,9);
 });
 it('carries current momentum from moving liquid into evaporating vapor without paying its kinetic energy twice',()=>{
  const {s,c,air}=world();air.velocity.set([100,0,0],0);c.ocean.momentum[0]=c.ocean.mass[0]*20;
  const before=momentum(c),mass=air.layerMass(0),h=c.energy(s),water=s[F.water],oldWaterMomentum=c.ocean.momentum[0];
  local(air).surfaceBoundaryStep(s,0,1,dt=>local(air).surfaceExchange(s,0,dt));const moved=water-s[F.water];
  expect(moved).toBeGreaterThan(0);expect(c.ocean.momentum[0]).toBeCloseTo(oldWaterMomentum-moved*20,12);
  expect(air.velocity[0]).toBeCloseTo((mass*100+moved*20)/(mass+moved),12);closeVector(momentum(c),before);
  expect(c.energy(s)-h).toBeCloseTo(0,8);
 });
 it('does not give stationary ice the liquid current velocity during sublimation',()=>{
  const {s,c,air}=world(-10);s[F.ice]+=s[F.water];s[F.water]=0;c.ocean.reconcile(s,new Float32Array(grid.count*4));air.temperature[0]=-30;air.velocity[0]=100;
  const before=momentum(c),old=s[F.ice];local(air).surfaceExchange(s,0,1);
  expect(s[F.ice]).toBeLessThan(old);closeVector(momentum(c),before,12);
 });
 it('carries cloud ice momentum into the lower layer over one physical second',()=>{
  const {s,c,air}=world(-10);air.mass.fill(0);air.temperature.fill(-10);air.velocity.fill(0);
  for(let q=0;q<air.temperature.length;q++)air.mass[q*AIR_SPECIES+1]=.03;
  const q=8;air.mass[q*AIR_SPECIES+5]=1e-7;air.velocity[q*3]=100;const before=momentum(c),h=air.surfaceEnergy(s,0)+air.columnEnergy(0),rain=new Float32Array(grid.count*2);
  local(air).precipitation(s,0,1,rain);
  expect(air.mass[(q-1)*AIR_SPECIES+5]).toBeGreaterThan(0);expect(air.velocity[(q-1)*3]).toBeGreaterThan(0);closeVector(momentum(c),before,12);
  expect(air.surfaceEnergy(s,0)+air.columnEnergy(0)-h).toBeCloseTo(0,9);
 });
 it.each([20,-20])('retains donor momentum while rain/snow evaporates into differently moving receiving air (%s °C)',t=>{
  const {s,c,air}=world(t);air.mass.fill(0);air.temperature.fill(t);air.velocity.fill(0);
  for(let q=0;q<air.temperature.length;q++){air.mass[q*AIR_SPECIES+1]=.03;air.velocity[q*3]=-30;}
  const q=8;air.mass[q*AIR_SPECIES+(t>0?4:5)]=.004;air.velocity[q*3]=100;
  const before=momentum(c),h=c.energy(s),vapor=air.mass[0],rain=new Float32Array(grid.count*2);
  local(air).surfaceBoundaryStep(s,0,1,dt=>local(air).precipitation(s,0,dt));
  expect(air.mass.slice(0,AIR_LAYERS*AIR_SPECIES).some((v,k)=>k%AIR_SPECIES===0&&v>vapor)).toBe(true);
  closeVector(momentum(c),before,10);expect(c.energy(s)-h).toBeCloseTo(0,8);
 });
 it('mixes a rain parcel into resolved moving water and converts relative kinetic energy to heat',()=>{
  const {s,c,air}=world(20),amount=.01,speed=100;c.ocean.momentum[0]=c.ocean.mass[0]*-20;
  const water=s[F.water],oldMomentum=c.ocean.momentum[0],oldH=c.energy(s),oldThermal=air.surfaceEnergy(s,0),oldK=c.ocean.kinetic(0);
  const carried=amount*(SPECIFIC_HEAT[F.water]*20+MATERIAL_ENERGY[F.water]+speed*speed/2000);
  local(air).depositPrecipitation(s,0,F.water,amount,carried,[amount*speed,0,0]);
  expect(s[F.water]).toBeCloseTo(water+amount,12);expect(c.ocean.momentum[0]).toBeCloseTo(oldMomentum+amount*speed,12);
  expect(c.energy(s)-oldH).toBeCloseTo(carried,9);const gainedK=c.ocean.kinetic(0)-oldK;
  expect(air.surfaceEnergy(s,0)-oldThermal).toBeCloseTo(carried-gainedK,9);
  expect(carried-gainedK-amount*SPECIFIC_HEAT[F.water]*20).toBeGreaterThan(0);
 });
 it('records stationary surface ice deposition impulse and retains its impact energy as heat',()=>{
  const {s,c,air}=world(-20);air.mass.fill(0);air.temperature.fill(-20);air.velocity.fill(0);air.mass[1]=.03;air.mass[5]=.001;air.velocity[0]=100;
  const h=c.energy(s),before=momentum(c),ice=s[F.ice],oldBoundary=c.ocean.boundaryImpulse[0];
  local(air).surfaceBoundaryStep(s,0,1,dt=>local(air).precipitation(s,0,dt));
  expect(s[F.ice]).toBeGreaterThan(ice);expect(c.ocean.boundaryImpulse[0]).toBeGreaterThan(oldBoundary);closeVector(momentum(c),before,12);expect(c.energy(s)-h).toBeCloseTo(0,9);
 });
 it('retains rejected sub-ULP precipitation energy and momentum in the boundary air',()=>{
  const {s,c,air}=world(20),projected=new Float32Array(s);projected[F.water]=1e8;air.mass[4]=0;
  const mass=air.layerMass(0),p=mass*air.velocity[0],h=air.surfaceEnergy(projected,0)+air.columnEnergy(0);const before=[...c.ocean.boundaryImpulse];
  local(air).depositPrecipitation(projected,0,F.water,1e-8,1e-6,[1e-6,0,0]);
  expect(projected[F.water]).toBe(1e8);expect(air.mass[4]).toBe(1e-8);expect(air.layerMass(0)*air.velocity[0]).toBeCloseTo(p+1e-6,13);expect([...c.ocean.boundaryImpulse]).toEqual(before);
  expect(air.surfaceEnergy(projected,0)+air.columnEnergy(0)-h).toBeCloseTo(1e-6,6);
 });
 it('keeps bound water and newly mobilized salt at rest during saline surface mass exchange',()=>{
  const {s,c}=world(20);s[F.water]=.05;s[F.soil]=1;s[F.dissolved]=.1;c.ocean.reconcile(s,new Float32Array(grid.count*4));
  const amount=.1,impulse=[10,0,0],oldBoundary=c.ocean.boundaryImpulse[0];s[F.water]+=amount;
  c.ocean.transferMass(s,0,F.water,amount,impulse);
  expect(c.ocean.momentum[0]).toBeCloseTo(3,12);expect(c.ocean.boundaryImpulse[0]-oldBoundary).toBeCloseTo(7,12);
  const before=c.ocean.momentum[0]+c.ocean.boundaryImpulse[0],parcel=c.ocean.massParcel(s,0,F.water,.02),oldK=c.ocean.kinetic(0);s[F.water]-=.02;
  const kinetic=c.ocean.transferMass(s,0,F.water,-.02,parcel.momentum.map(v=>-v));
  expect(c.ocean.momentum[0]+c.ocean.boundaryImpulse[0]+parcel.momentum[0]).toBeCloseTo(before,12);
  expect(kinetic).toBeCloseTo(c.ocean.kinetic(0)-oldK,12);
 });
 it('rolls parcel impulses and liquid mechanics back before a bounded boundary retry',()=>{
  const {s,c,air}=world(),before=c.ocean.checkpoint(),saved=air.checkpoint();let calls=0;
  local(air).surfaceBoundaryStep(s,0,1,dt=>{calls++;local(air).surfaceExchange(s,0,dt);if(dt>.25)air.temperature[0]=-300;});
  expect(calls).toBeGreaterThan(2);const after=momentum(c),expected=[0,1,2].map(v=>before.boundaryImpulse[v]+before.momentum[v]+saved.boundaryImpulse[v]+Array.from({length:AIR_LAYERS},(_,k)=>saved.mass.slice(k*AIR_SPECIES,(k+1)*AIR_SPECIES).reduce((a,b)=>a+b)*saved.velocity[k*3+v]).reduce((a,b)=>a+b,0));
  closeVector(after,expected);expect(air.temperature[0]).toBeGreaterThan(-273.15);
 });
 it('closes the full solver mass and energy ledgers and exactly resumes moving surface exchange',()=>{
  const {s,c}=world(30);c.air.attach(s);const solver=new CpuSolver(grid,new Float32Array(s));solver.climate.restore(c.snapshot());solver.climate.ocean.momentum[0]=solver.climate.ocean.mass[0]*10;
  const m=totalMass(solver.state,solver.climate),h=totalEnthalpy(solver.state,solver.climate),empty=new Float32Array(grid.count*COMMAND_STRIDE);let energy=0,escape=0;
  for(let n=0;n<12;n++){solver.advance(1/60,empty,environment);energy+=solver.energyChanges.reduce((a,b)=>a+b,0);escape+=solver.escapeCells.reduce((a,b)=>a+b,0);}
  expect(totalMass(solver.state,solver.climate)+escape-m).toBeCloseTo(0,6);expect(totalEnthalpy(solver.state,solver.climate)-h-energy).toBeCloseTo(0,6);
  const resumed=new CpuSolver(grid,solver.state.slice());resumed.climate.restore(JSON.parse(JSON.stringify(solver.climate.snapshot())));
  for(let n=0;n<3;n++){solver.advance(1/60,empty,environment);resumed.advance(1/60,empty,environment);}expect(resumed.state).toEqual(solver.state);expect(resumed.climate.snapshot()).toEqual(solver.climate.snapshot());
 });
});
describe('alpha18 gas radiation cache',()=>{
 function mars(){const p=createMarsPlanet(grid),s=new Float64Array(p.state),c=new WeatherClimate(grid);c.prepareSurface(s,p.environment);c.air.temperature.fill(-60);c.air.mass.fill(0);for(let q=0;q<c.air.temperature.length;q++)c.air.mass[q*AIR_SPECIES+1]=.0001;return {...p,s,c,air:c.air,energy:new Float32Array(grid.count*4)};}
 function checkFresh(w:ReturnType<typeof mars>){local(w.air).radiation(w.s,0,0,w.environment,w.energy);const f=radiativeFluxes(w.air.radiationColumn(w.s,0,w.environment,1));expect(w.air.checkpoint().radiationCache[1]).toBeCloseTo(f.down[0]-f.up[0],10);}
 it('invalidates equal-mass N₂ to CO₂ substitutions',()=>{const w=mars();local(w.air).radiation(w.s,0,0,w.environment,w.energy);for(let k=0;k<AIR_LAYERS;k++){w.air.mass[k*AIR_SPECIES+3]=w.air.mass[k*AIR_SPECIES+1];w.air.mass[k*AIR_SPECIES+1]=0;}checkFresh(w);});
 it('invalidates the first CO₂ arriving through production advection',()=>{
  const w=mars();for(let i=1;i<grid.count;i++)for(let k=0;k<AIR_LAYERS;k++){w.air.mass[(i*AIR_LAYERS+k)*AIR_SPECIES+1]=0;w.air.mass[(i*AIR_LAYERS+k)*AIR_SPECIES+3]=.0001;}
  for(let i=0;i<grid.count;i++){const x=grid.directions[i*3],z=grid.directions[i*3+2],length=Math.hypot(x,z);if(length>0)for(let k=0;k<AIR_LAYERS;k++)w.air.velocity.set([z/length*1000,0,-x/length*1000],(i*AIR_LAYERS+k)*3);}
  local(w.air).radiation(w.s,0,0,w.environment,w.energy);local(w.air).dynamics(1,w.environment);expect(w.air.mass[3]).toBeGreaterThan(0);checkFresh(w);
 });
 it('retains bounded 1% constituent caching and serializes all invalidation inputs',()=>{
  const w=mars();local(w.air).radiation(w.s,0,1,w.environment,w.energy);w.air.mass[1]*=1.001;local(w.air).radiation(w.s,0,1,w.environment,w.energy);
  expect(w.air.checkpoint().radiationCache[0]).toBe(2);const saved=w.c.snapshot(),resumed=new WeatherClimate(grid);expect(validClimate(saved,grid.count)).toBe(true);resumed.restore(JSON.parse(JSON.stringify(saved)));expect(resumed.snapshot()).toEqual(saved);
  const before=w.air.checkpoint();w.air.mass[1]*=2;checkFresh(w);w.air.restoreCheckpoint(before);expect(w.air.checkpoint()).toEqual(before);
 });
 it('reads legacy physical inventories while discarding coefficients without composition metadata',()=>{
  const w=mars();local(w.air).radiation(w.s,0,1,w.environment,w.energy);const saved=w.c.snapshot(),a=saved.atmosphere!;a.version=8;delete a.geometryScale;delete a.gasRadiationCache;delete a.boundaryImpulse;
  expect(validClimate(saved,grid.count)).toBe(true);const resumed=new WeatherClimate(grid);resumed.restore(saved);expect([...resumed.air.mass]).toEqual(a.mass);expect(resumed.air.checkpoint().radiationCache[0]).toBe(-1);
  local(resumed.air).radiation(w.s,0,0,w.environment,w.energy);const fresh=radiativeFluxes(resumed.air.radiationColumn(w.s,0,w.environment,1));expect(resumed.air.checkpoint().radiationCache[1]).toBeCloseTo(fresh.down[0]-fresh.up[0],10);
 });
});
