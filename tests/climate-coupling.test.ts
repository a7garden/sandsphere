import {describe,it,expect} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,seedPlanet,totalMass,totalEnthalpy,cellHabitat} from '../src/sim/model';
import {WeatherClimate,cloudConditions,relativeHumidity,climateColor,climateOpticalDepth,radiativeHeat,currentMobility} from '../src/sim/weatherClimate';
import {saturationMass} from '../src/sim/waterPhysics';
import {albedo,transmittedLight} from '../src/sim/materialPhysics';
import {WeatherReadings,formatFlowSpeed} from '../src/ui/weatherReadings';
const grid=createSphere(1),env={ambient:18,sunlight:1,sun:[1,0,0],gravity:1,rotationRate:.06,climate:true},empty=new Float32Array(grid.count*COMMAND_STRIDE);
const blank=()=>seedPlanet(grid,'sand',22);
describe('climate connections and observations',()=>{
 it('distinguishes a weak measured flow from exactly motionless water in the inspector',()=>{
  expect(formatFlowSpeed(0)).toBe('0.00');expect(formatFlowSpeed(.00042)).toBe('0.0004');expect(formatFlowSpeed(.0000004)).toBe('<0.0001');expect(formatFlowSpeed(.25)).toBe('0.25');
 });
 it('thin-liquid current mobility fades continuously across the old ice/water threshold',()=>{
  const a=blank(),b=a.slice(),ca=new WeatherClimate(grid),cb=new WeatherClimate(grid);
  for(let i=0;i<grid.count;i++){a[i*STRIDE+F.water]=.1999;b[i*STRIDE+F.water]=.2001;ca.currents[i*3]=cb.currents[i*3]=.02;}
  ca.step(a,1/30,{...env,sunlight:0},new Float32Array(grid.count*4));cb.step(b,1/30,{...env,sunlight:0},new Float32Array(grid.count*4));
  expect(ca.currents.every(v=>v===0)).toBe(true);expect(Math.max(...cb.currents.map(Math.abs))).toBeLessThan(1e-6);
  expect(currentMobility(b,0)).toBeGreaterThan(0);b[F.water]=.5;expect(currentMobility(b,0)).toBeCloseTo(1);b[F.water]=.8;b[F.soil]=8;expect(currentMobility(b,0)).toBe(0);
 });
 it('reads prognostic layer temperature and humidity on resume without advancing',()=>{
  const s=blank(),c=new WeatherClimate(grid);for(let i=0;i<grid.count;i++)s[i*STRIDE+F.vapor]=.0018;c.prepareSurface(s,env);c.air.attach(s);
  const before=s.slice(),saved=c.snapshot(),air=c.conditions(s,0,env),resumed=new WeatherClimate(grid);resumed.restore(saved);
  expect(air.temperature).not.toBe(s[F.temperature]);expect(air.pressure).toBeGreaterThan(0);expect(relativeHumidity(s,0,env,c)).toBe(air.humidity);expect(resumed.conditions(s,0,env)).toEqual(air);
  expect(climateColor('humidity',s,0,env,resumed)).toEqual(climateColor('humidity',s,0,env,c));expect(s).toEqual(before);expect(c.snapshot()).toEqual(saved);
 });
 it('restores a complete committed climate state after a failed physics step',()=>{
  const solver=new CpuSolver(grid,blank());solver.advance(1/30,empty,env);
  const state=solver.state.slice(),climate=solver.climate.snapshot(),original=solver.climate.step.bind(solver.climate);
  solver.climate.step=()=>{solver.climate.air.mass[0]+=1;solver.climate.seeds[0]=.7;throw new Error('injected climate failure');};
  expect(()=>solver.advance(1/30,empty,env)).toThrow('injected climate failure');
  expect(solver.state).toEqual(state);expect(solver.climate.snapshot()).toEqual(climate);
  solver.climate.step=original;
  const reference=new CpuSolver(grid,state.slice());reference.climate.restore(climate);
  solver.advance(1/30,empty,env);reference.advance(1/30,empty,env);
  expect(solver.state).toEqual(reference.state);expect(solver.climate.snapshot()).toEqual(reference.climate.snapshot());
 });
 it('diagnoses ice cloud saturation against ice rather than a liquid-only humidity',()=>{
  const s=blank();s[F.temperature]=-25;s[F.cloudIce]=.3;s[F.vapor]=.00004;const air=cloudConditions(s,0,env);
  expect(air.saturation).toBeCloseTo(saturationMass(-25,'ice',s[F.nitrogen],s[F.methane],s[F.carbonDioxide],1),12);
  expect(air.saturation).toBeLessThan(saturationMass(-25,'water',s[F.nitrogen],s[F.methane],s[F.carbonDioxide],1));
 });
 it('creates clouds from vapor and delivers precipitation with closed water/mass/heat accounts',()=>{
  const s=blank();for(let i=0;i<grid.count;i++){const p=i*STRIDE;s[p+F.water]=30;s[p+F.vapor]=.6;s[p+F.temperature]=15;}
  const solver=new CpuSolver(grid,s),mass=totalMass(s),heat=totalEnthalpy(s);let formed=0,rain=0,escaped=0,q=0;
  for(let k=0;k<180;k++){solver.advance(1/30,empty,{...env,sunlight:0});formed+=solver.condensedCells.reduce((a,b)=>a+b,0);rain+=solver.precipitatedCells.reduce((a,b)=>a+b,0);escaped+=solver.escapeCells.reduce((a,b)=>a+b,0);q+=solver.energyChanges.reduce((a,b)=>a+b,0);}
  expect(formed).toBeGreaterThan(1);expect(rain).toBeGreaterThan(.01);expect(totalMass(solver.state)+escaped-mass).toBeCloseTo(0,3);expect(totalEnthalpy(solver.state,solver.climate)-heat-q).toBeCloseTo(0,1);
 });
 it('has no source of cloud water on a dry planet; unsaturated existing clouds evaporate',()=>{
  const dry=new CpuSolver(grid,blank());for(let k=0;k<90;k++)dry.advance(1/30,empty,env);expect(dry.state.every((v,i)=>!([F.water,F.ice,F.vapor,F.cloud,F.cloudIce] as number[]).includes(i%STRIDE)||v===0)).toBe(true);
  const s=blank(),c=new WeatherClimate(grid);s[F.cloud]=.01;const before=totalMass(s);c.step(s,.03,env,new Float32Array(grid.count*4));expect(s[F.cloud]).toBeLessThan(.01);expect(s[F.vapor]).toBeGreaterThan(0);expect(totalMass(s)).toBeCloseTo(before,4);
 });
 it('cloud shading reduces absorbed heating and plant light, while greenhouse gas reduces longwave cooling',()=>{
  const s=blank(),p=0,c=22,capacity=30,clear=transmittedLight(1,1,0,0),cloudy=transmittedLight(1,1,.5,.2);
  expect(cloudy).toBeLessThan(clear);const a=radiativeHeat(capacity,c,1361*clear*(1-albedo(s,p)),0,.1),b=radiativeHeat(capacity,c,1361*cloudy*(1-albedo(s,p)),0,.1);expect(b).toBeLessThan(a);
  const depth=climateOpticalDepth(s,p);s[F.carbonDioxide]=.02;expect(radiativeHeat(capacity,c,0,climateOpticalDepth(s,p),.1)).toBeGreaterThan(radiativeHeat(capacity,c,0,depth,.1));
 });
 it('mineral root conditions agree with biomass dispersal and hostile bare-rock survival',()=>{
  const s=blank();for(let i=0;i<grid.count;i++){const p=i*STRIDE;s[p+F.sand]=0;s[p+F.water]=.15;s[p+F.plant]=.2;}
  expect(cellHabitat(s,0,env,F.plant,grid)).toBe(0);const solver=new CpuSolver(grid,s);solver.advance(1/30,empty,env);expect(solver.state[F.plant]).toBeLessThan(.2);
  s[F.sand]=1;expect(cellHabitat(s,0,{...env,sun:[...grid.directions.slice(0,3)]},F.plant,grid)).toBeGreaterThan(0);
 });
 it('cloud amount map includes liquid and ice stock even below decorative-bank threshold',()=>{
  const s=blank(),c=new WeatherClimate(grid),dry=climateColor('clouds',s,0,env,c);s[F.cloudIce]=.003;expect(climateColor('clouds',s,0,env,c)).not.toEqual(dry);s[F.cloud]=.003;s[F.cloudIce]=0;const liquid=climateColor('clouds',s,0,env,c);s[F.cloud]=0;s[F.cloudIce]=.003;expect(climateColor('clouds',s,0,env,c)).toEqual(liquid);
 });
 it('freezing removes the surface current in the same committed step',()=>{
  const s=blank(),c=new WeatherClimate(grid);for(let i=0;i<grid.count;i++){s[i*STRIDE+F.water]=.5;s[i*STRIDE+F.temperature]=-30;c.currents[i*3]=.02;}
  c.step(s,1/30,{...env,sunlight:0},new Float32Array(grid.count*4));expect(s[F.ice]).toBeGreaterThan(.4);expect(s[F.water]).toBe(0);expect(c.currents.every(v=>v===0)).toBe(true);
 });
 it('weather rate observations retain the last completed step during pause/edit and reset on switching',()=>{
  const readings=new WeatherReadings();readings.record(.1,new Float32Array([.2,.1]),new Float32Array([.02,0,0,.03]));expect(readings.pulse).toMatchObject({rainCells:1,snowCells:1});expect(readings.pulse!.condensation).toBeCloseTo(3);const before=readings.pulse;readings.record(0,new Float32Array(2),new Float32Array(4));expect(readings.pulse).toBe(before);readings.reset();expect(readings.pulse).toBeNull();
 });
});
