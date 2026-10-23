import {describe,it,expect} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {CpuSolver,F,STRIDE,MASS_FIELDS,COMMAND_STRIDE,SURFACE_ERASE,totalMass,totalEnthalpy,totals,type Snapshot} from '../src/sim/model';
import {createMarsPlanet} from '../src/sim/planetCreation';
import {WeatherClimate} from '../src/sim/weatherClimate';
import {AIR_LAYERS,AIR_SPECIES,COLUMN_KG,climateSurfaceAlbedo,validLayered} from '../src/sim/layeredAtmosphere';
import {carbonDioxideSaturationPressure,carbonDioxideFrostPoint,CO2_TRIPLE_PRESSURE,CO2_TRIPLE_TEMPERATURE,CO2_SUBLIMATION_HEAT,roundedSurfaceStock} from '../src/sim/co2Ice';
import {dustLiftFlux,dustSettlingSpeed,dustOpticalDepth} from '../src/sim/dustPhysics';
import {radiativeFluxes} from '../src/sim/climatePhysics';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {snapshotSurface} from '../src/sim/session';
import {BackgroundWorlds,advanceOrbit,prepareSystemSave} from '../src/sim/system';

const grid=createSphere(1),empty=new Float32Array(grid.count*COMMAND_STRIDE);
function detached(temperature=-140){
 const p=createMarsPlanet(grid),c=new WeatherClimate(grid);
 for(let i=0;i<grid.count;i++){p.state[i*STRIDE+F.temperature]=temperature;p.state[i*STRIDE+F.ice]=0;}
 c.prepareSurface(p.state,p.environment);return {...p,c};
}
function budget(s:Float32Array,c:WeatherClimate){
 let mass=totalMass(s);for(let q=0;q<c.air.temperature.length;q++)mass+=c.air.layerMass(q);
 return {mass,energy:totalEnthalpy(s)+c.air.totalEnergy()+c.air.surfaceHeatCarry.reduce((a,b)=>a+b,0),roundoff:c.air.checkpoint().roundoff.reduce((a,b)=>a+b,0)};
}
function conserved(before:ReturnType<typeof budget>,s:Float32Array,c:WeatherClimate){
 const after=budget(s,c);expect(after.mass-before.mass).toBeCloseTo(0,10);
 expect(after.energy-before.energy-(after.roundoff-before.roundoff)).toBeCloseTo(0,8);
}
function wind(c:WeatherClimate,speed=100){
 for(let i=0;i<grid.count;i++){const [x,y]=grid.directions.subarray(i*3,i*3+2),length=Math.hypot(x,y);const v=length>1e-5?[-y/length*speed,x/length*speed,0]:[speed,0,0];for(let k=0;k<AIR_LAYERS;k++)c.air.velocity.set(v,(i*AIR_LAYERS+k)*3);}
}
function saved(s:Float32Array,c:WeatherClimate,e:ReturnType<typeof createMarsPlanet>['environment']):Snapshot{
 return {version:6,preset:'coast',planet:{primary:'sand'},state:[...s],climate:c.snapshot(),environment:e,time:0,discoveries:[],supplied:0,removed:0};
}
describe('Martian solid CO₂ exchange',()=>{
 it('anchors the sublimation curve to NIST and uses partial pressure',()=>{
  expect(carbonDioxideSaturationPressure(CO2_TRIPLE_TEMPERATURE-273.15)).toBeCloseTo(CO2_TRIPLE_PRESSURE,5);
  expect(CO2_SUBLIMATION_HEAT).toBeCloseTo(597.591456,5);
  expect(carbonDioxideFrostPoint(636)).toBeLessThan(-120);
  for(const t of [-170,-140,-120,-80])expect(carbonDioxideFrostPoint(carbonDioxideSaturationPressure(t))).toBeCloseTo(t,10);
 });
 it('deposits finite gas on a cold surface, warms it with latent heat and lowers pressure',()=>{
  const {state,c}=detached(),before=budget(state,c),gas=c.air.mass[3],pressure=c.air.pressure(0,0),t=state[F.temperature];
  c.air.co2SurfaceExchange(state,0,30);
  expect(state[F.carbonDioxideIce]).toBeGreaterThan(0);expect(c.air.mass[3]).toBeLessThan(gas);expect(c.air.pressure(0,0)).toBeLessThan(pressure);expect(state[F.temperature]).toBeGreaterThan(t);
  expect(gas-c.air.mass[3]).toBeCloseTo(state[F.carbonDioxideIce],12);conserved(before,state,c);
 });
 it('sublimates its existing frost on warming and pays latent heat without adding CO₂',()=>{
  const {state,c}=detached();c.air.co2SurfaceExchange(state,0,30);state[F.temperature]=-70;
  const ice=state[F.carbonDioxideIce],gas=c.air.mass[3],before=budget(state,c);c.air.co2SurfaceExchange(state,0,30);
  expect(state[F.carbonDioxideIce]).toBeLessThan(ice);expect(state[F.temperature]).toBeLessThan(-70);
  expect(c.air.mass[3]-gas).toBeCloseTo(ice-state[F.carbonDioxideIce],12);conserved(before,state,c);
 });
 it('does not transfer in zero time, without a donor, above the liquid domain or in Earth mode',()=>{
  const {state,c}=detached(),before=state.slice();c.air.co2SurfaceExchange(state,0,0);expect(state).toEqual(before);
  c.air.mass.fill(0);c.air.co2SurfaceExchange(state,0,100);expect(state).toEqual(before);
  c.air.mass[3]=10;c.air.co2SurfaceExchange(state,0,100);expect(state).toEqual(before);
  const earth=new WeatherClimate(grid),e={ambient:-100,sunlight:0,sun:[1,0,0],gravity:1,climate:true};earth.prepareSurface(state,e);earth.air.co2SurfaceExchange(state,0,100);expect(state[F.carbonDioxideIce]).toBe(0);
 });
 it('bounds repeated exchange at phase equilibrium and never produces negative stocks',()=>{
  const {state,c}=detached(-125),before=budget(state,c);
  for(let n=0;n<100;n++)c.air.co2SurfaceExchange(state,0,600);
  expect(state[F.temperature]).toBeLessThan(-120);expect(state[F.carbonDioxideIce]).toBeGreaterThan(0);expect(c.air.mass[3]).toBeGreaterThanOrEqual(0);conserved(before,state,c);
 });
});
describe('finite transported mineral dust',()=>{
 it('requires wind stress and soil; frost suppresses lifting, settling responds to pressure',()=>{
  expect(dustLiftFlux(0,.02,0)).toBe(0);expect(dustLiftFlux(100,0,0)).toBe(0);
  expect(dustLiftFlux(100,.02,10)).toBeLessThan(dustLiftFlux(100,.02,0)/1000);
  expect(dustSettlingSpeed(10,-60,3.71)).toBeGreaterThan(dustSettlingSpeed(600,-60,3.71));
  const {state,c}=detached(-60),old=state.slice();c.air.liftDust(state,0,100);expect(state).toEqual(old);
  wind(c);state[F.sand]=state[F.surfaceDust]=0;c.air.liftDust(state,0,100);expect(c.air.dustMass[0]).toBe(0);
  state[F.sand]=1;c.air.mass.fill(0);c.air.liftDust(state,0,100);expect(c.air.dustMass[0]).toBe(0);
 });
 it('lifts ground dust then sand, conserves mass, heat and mixed-layer momentum',()=>{
  const {state,c}=detached(-60);wind(c);const ground=state[F.surfaceDust],first=budget(state,c);c.air.liftDust(state,0,100);
  expect(state[F.surfaceDust]).toBeLessThan(ground);conserved(first,state,c);state[F.surfaceDust]=0;
  const before=budget(state,c),sand=state[F.sand],mass=c.air.layerMass(0),momentum=Array.from(c.air.velocity.subarray(0,3),v=>v*mass);
  const oldDust=c.air.dustMass[0];c.air.liftDust(state,0,10000);
  expect(state[F.sand]).toBeLessThan(sand);expect(c.air.dustMass[0]).toBeGreaterThan(oldDust);expect(sand-state[F.sand]).toBeCloseTo(c.air.dustMass[0]-oldDust,12);
  Array.from(c.air.velocity.subarray(0,3)).forEach((v,k)=>expect(v*c.air.layerMass(0)).toBeCloseTo(momentum[k],12));conserved(before,state,c);
 });
 it('retains sub-Float32 lifting demand and does not lose a rounded deposit',()=>{
  const {state,c}=detached(-60);wind(c);state[F.surfaceDust]=0;
  const before=budget(state,c);for(let n=0;n<1000;n++)c.air.liftDust(state,0,10);
  expect(c.air.dustMass[0]).toBeGreaterThan(0);expect(c.air.snapshot()!.dustLiftCarry![0]).toBeGreaterThanOrEqual(0);conserved(before,state,c);
  state[F.surfaceDust]=1e4;c.air.dustMass[0]=1e-8;const tiny=budget(state,c);c.air.settleDust(state,0,100);expect(c.air.dustMass[0]).toBe(1e-8);conserved(tiny,state,c);
  expect(roundedSurfaceStock(Math.fround(.003),1e-12,false)).toBe(Math.fround(.003));
 });
 it('settles through layers into the surface and returns potential and kinetic heat',()=>{
  const {state,c}=detached(-60);wind(c);c.air.dustMass[1]=.00001;
  const before=budget(state,c);c.air.settleDust(state,0,10000);
  expect(c.air.dustMass[1]).toBeLessThan(.00001);expect(c.air.dustMass[0]).toBeGreaterThan(0);conserved(before,state,c);
  const next=budget(state,c),stock=state[F.surfaceDust];c.air.settleDust(state,0,10000);expect(state[F.surfaceDust]).toBeGreaterThan(stock);conserved(next,state,c);
 });
 it('uses transported dust to shade the surface and heat the atmosphere; frost reflects light',()=>{
  const {state,c,environment}=detached(-60),i=Array.from({length:grid.count},(_,i)=>i).find(i=>grid.directions[i*3]>.5)!;
  const clear=radiativeFluxes(c.air.radiationColumn(state,i,environment,500));c.air.dustMass[i*AIR_LAYERS+2]=.003/COLUMN_KG;
  const column=c.air.radiationColumn(state,i,environment,500),dusty=radiativeFluxes(column);
  expect(dustOpticalDepth(.003)).toBe(1.8);expect(dusty.surfaceSolar).toBeLessThan(clear.surfaceSolar);
  expect(500-dusty.reflectedSolar-dusty.surfaceSolar).toBeGreaterThan(500-clear.reflectedSolar-clear.surfaceSolar);
  const old=climateSurfaceAlbedo(state,i);state[i*STRIDE+F.carbonDioxideIce]=1/COLUMN_KG;expect(climateSurfaceAlbedo(state,i)).toBeGreaterThan(old);
 });
});
describe('Mars storage and coupled accounting',()=>{
 it('zero-extends v5 / 24-field cells and reads dust-free layered v2 without adding inventory or heat',()=>{
  const {state,c,environment}=detached(-60);c.air.attach(state);const old=saved(state,c,environment);old.version=5;old.climate!.version=2;delete old.climate!.surfaceMassCarry;delete old.climate!.ocean;
  old.state=Array.from({length:grid.count},(_,i)=>[...state.slice(i*STRIDE,i*STRIDE+24)]).flat();
  const air=old.climate!.atmosphere!;air.mass=Array.from({length:air.temperature.length},(_,q)=>air.mass.slice(q*AIR_SPECIES,q*AIR_SPECIES+6)).flat();air.version=2;delete air.geometryScale;delete air.boundaryImpulse;delete air.gasRadiationCache;delete air.surfaceHeatCarry;delete air.dustMass;delete air.dustRadiationCache;delete air.dustLiftCarry;
  const original=structuredClone(old);expect(validSnapshot(old,grid.count)).toBe(true);const upgraded=upgradeSnapshot(old,grid.count);
  expect(old).toEqual(original);expect(upgraded.version).toBe(11);expect(validSnapshot(upgraded,grid.count)).toBe(true);
  for(let i=0;i<grid.count;i++){expect(upgraded.state.slice(i*STRIDE,i*STRIDE+24)).toEqual(old.state.slice(i*24,(i+1)*24));expect(upgraded.state.slice(i*STRIDE+24,(i+1)*STRIDE)).toEqual(Array(STRIDE-24).fill(0));}
  const legacy=new WeatherClimate(grid);legacy.restore(upgraded.climate);expect(legacy.air.dustMass.every(v=>v===0)).toBe(true);
  const reconstructed=new Float32Array(upgraded.state);expect(totalMass(reconstructed)).toBeCloseTo(old.state.reduce((sum,v,i)=>sum+(MASS_FIELDS.includes(i%24)?v:0),0),5);
  expect(totalEnthalpy(reconstructed,legacy)).toBeCloseTo(totalEnthalpy(reconstructed,upgraded.climate),8);
 });
 it('rejects malformed/negative aerosols, mismatched mirrors, and a nonzero reserved slot',()=>{
  const {state,c,environment}=detached(-60);c.air.attach(state);const s=saved(state,c,environment);expect(validSnapshot(s,grid.count)).toBe(true);
  for(const mutate of [(s:Snapshot)=>{s.state[F.surfaceDust]=-1e-9;},(s:Snapshot)=>{s.state[27]=1;},(s:Snapshot)=>{s.state[F.airborneDust]=1e-4;},(s:Snapshot)=>{s.climate!.atmosphere!.dustMass![0]=-1e-9;},(s:Snapshot)=>{s.climate!.atmosphere!.dustLiftCarry=[];}]){const bad=structuredClone(s);mutate(bad);expect(validSnapshot(bad,grid.count)).toBe(false);}
  expect(validLayered({...s.climate!.atmosphere!,version:2},grid.count)).toBe(false);
 });
 it('conserves the coupled mass/energy budget and resumes every hidden dust state exactly',()=>{
  const p=createMarsPlanet(grid);for(let i=0;i<grid.count;i++){p.state[i*STRIDE+F.temperature]=i%2?-60:-140;p.state[i*STRIDE+F.ice]=0;}
  const solver=new CpuSolver(grid,p.state),mass=totalMass(p.state),heat=totalEnthalpy(p.state);solver.climate.prepareSurface(solver.state,p.environment);wind(solver.climate);solver.climate.air.attach(solver.state);
  // Wind initialization is an explicit test energy input.
  const startingHeat=totalEnthalpy(solver.state,solver.climate),openingRoundoff=solver.climate.air.checkpoint().roundoff.reduce((a,b)=>a+b,0);let external=startingHeat-heat-openingRoundoff,escaped=0;
  for(let n=0;n<120;n++){solver.advance(.5,empty,p.environment);external+=solver.energyChanges.reduce((a,b)=>a+b,0);escaped+=solver.escapeCells.reduce((a,b)=>a+b,0);}
  const massResidual=totalMass(solver.state)+escaped-mass,energyResidual=totalEnthalpy(solver.state,solver.climate)-heat-external;
  console.log('Mars coupled budgets',{massResidual,energyResidual,co2Ice:totals(solver.state)[F.carbonDioxideIce],airDust:totals(solver.state)[F.airborneDust]});
  expect(Math.abs(massResidual)).toBeLessThan(5e-5);expect(Math.abs(energyResidual)).toBeLessThan(.005);expect(totals(solver.state)[F.carbonDioxideIce]).toBeGreaterThan(0);expect(totals(solver.state)[F.airborneDust]).toBeGreaterThan(0);
  const snapshot=saved(solver.state,solver.climate,p.environment);expect(validSnapshot(snapshot,grid.count)).toBe(true);
  const restored=JSON.parse(JSON.stringify(snapshot)) as Snapshot,resumed=new CpuSolver(grid,new Float32Array(restored.state));resumed.climate.restore(restored.climate);
  for(let n=0;n<5;n++){solver.advance(.1,empty,p.environment);resumed.advance(.1,empty,p.environment);}expect(resumed.state).toEqual(solver.state);expect(resumed.climate.snapshot()).toEqual(solver.climate.snapshot());
 });
 it('transports lifted dust to other columns using the same conservative air fluxes',()=>{
  const {state,c,environment}=detached(-60);wind(c,150);for(let i=0;i<grid.count;i++){state[i*STRIDE+F.sand]=0;state[i*STRIDE+F.surfaceDust]=0;}c.air.dustMass[0]=.00001;c.air.attach(state);
  const solver=new CpuSolver(grid,state);solver.climate.restore(c.snapshot());for(let n=0;n<30;n++)solver.advance(.1,empty,environment);
  expect(solver.state.some((v,i)=>i%STRIDE===F.airborneDust&&i>STRIDE&&v>0)).toBe(true);
 });
 it('keeps save-time whole-cell erasure, surface-only erasure and paused edits in balance',()=>{
  const {state,c,environment}=detached(-60);c.air.dustMass[0]=.0001;state[F.carbonDioxideIce]=.0001;c.air.attach(state);
  const initialMass=totalMass(state),commands=empty.slice();commands[5]=.25;
  const stored=snapshotSurface(state,commands,[],null,c,environment),solver=new CpuSolver(grid,state.slice());solver.climate.restore(c.snapshot());solver.advance(0,commands,environment);
  expect(stored.state).toEqual(solver.state);expect(stored.climate).toEqual(solver.climate.snapshot());expect(totalMass(stored.state)+stored.pendingRemoved).toBeCloseTo(initialMass,5);
  const surface=empty.slice();surface[5]=.25;surface[SURFACE_ERASE]=1;const shadow=snapshotSurface(state,surface,[],null,c,environment);expect(shadow.climate!.atmosphere!.dustMass).toEqual(c.snapshot().atmosphere!.dustMass);expect(shadow.state[F.carbonDioxideIce]).toBeCloseTo(.000075,10);
 });
 it('restores dust inventories and carries after rollback, and matches active/background execution',()=>{
  const {state,c,environment}=detached(-60);wind(c);c.air.liftDust(state,0,1);const checkpoint=c.checkpoint(),before=c.snapshot();c.air.liftDust(state,0,100);c.restoreCheckpoint(checkpoint);expect(c.snapshot()).toEqual(before);c.air.attach(state);
  const s=saved(state,c,environment),record={id:'planet-mars',name:'Mars',snapshot:structuredClone(s)},active=new CpuSolver(grid,state.slice());active.climate.restore(s.climate);const background=new BackgroundWorlds(grid);
  for(let n=0;n<3;n++){advanceOrbit(s,1/30);active.advance(1/30,empty,s.environment);background.step([record],'other',1/30);}expect(record.snapshot.state).toEqual([...active.state]);expect(record.snapshot.climate).toEqual(active.climate.snapshot());
  const system=prepareSystemSave({version:3,mode:'sandbox',activeId:'planet-mars',planets:[record],stock:{ice:0,ceramic:0,glass:0,plant:0,herbivore:0,carnivore:0,iron:0},savedAt:1},grid.count);expect(validSnapshot(system.planets[0].snapshot,grid.count)).toBe(true);
 });
});
