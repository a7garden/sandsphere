import {AIR_SPECIES} from '../src/sim/layeredAtmosphere';
import {describe,it,expect,vi} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,seedPlanet,totalMass,totalEnthalpy} from '../src/sim/model';
import {WeatherClimate,validClimate} from '../src/sim/weatherClimate';
import {AIR_LAYERS,liftedTemperature,saturatedVapor} from '../src/sim/layeredAtmosphere';
import {saturationPressure} from '../src/sim/waterPhysics';
import {heatForTarget} from '../src/sim/toolHeat';
import {impactMeteor} from '../src/sim/meteor';
import {validSnapshot} from '../src/sim/storage';
import {snapshotSurface} from '../src/sim/session';
import {createCommandBatch} from '../src/sim/supply';
import {CloudEnvelopeField,cloudComponents} from '../src/render/cloudEnvelope';
import {COLUMN_KG,CLOUD_VISIBLE_MASS,cloudTransmission} from '../src/sim/layeredAtmosphere';

const g=createSphere(1),env={ambient:22,sunlight:1,sun:[1,0,0],gravity:1,rotationRate:0,climate:true};
const empty=new Float32Array(g.count*COMMAND_STRIDE);
const world=()=>{const s=seedPlanet(g,'sand',22);for(let i=0;i<g.count;i++){s[i*STRIDE+F.sand]=8;s[i*STRIDE+F.vapor]=.006;}return s;};
describe('layered moist atmosphere',()=>{
 it('matches the ideal molar partial-pressure saturation relation in SI units',()=>{
  const nitrogen=.3,n=nitrogen/.028014,p=101325,v=saturatedVapor(nitrogen,n,20,p),partial=p*(v/.018015)/(v/.018015+n);expect(partial).toBeCloseTo(saturationPressure(20),8);
  expect(saturatedVapor(nitrogen,n,20,100)).toBe(Infinity);
  const s=seedPlanet(g,'sand',22),c=new WeatherClimate(g);c.prepareSurface(s,env);c.air.attach(s);c.air.temperature[0]=20;c.air.mass[0]=.005;const air=c.conditions(s,0,env),nv=.005/.018015,nd=c.air.mass[1]/.028014;
  expect(air.humidity).toBeCloseTo(air.pressure*nv/(nv+nd)/saturationPressure(20),10);
 });
 it('lifts a dry parcel by g/cp, conserves moist static enthalpy and reverses on descent',()=>{
  const t=liftedTemperature(30,1000),back=liftedTemperature(t,-1000);
  expect(t).toBeCloseTo(20.2290836653,8);expect(back).toBeCloseTo(30,12);expect(1004*t+9.81*1000).toBeCloseTo(1004*30,8);
 });
 it('opens the legacy shared reservoir into independent layers without creating mass or energy',()=>{
  const s=world(),h=totalEnthalpy(s),mass=totalMass(s),c=new WeatherClimate(g);
  c.prepareSurface(s,env);c.air.attach(s);
  expect(c.air.temperature.length).toBe(g.count*AIR_LAYERS);expect(c.air.temperature[0]).not.toBe(s[F.temperature]);expect(c.air.temperature[4]).toBeLessThan(c.air.temperature[0]);
  expect(totalMass(s)).toBeCloseTo(mass,5);expect(totalEnthalpy(s,c)).toBeCloseTo(h,3);
 });
 it('keeps layer water, total mass and actual surface+air+potential+kinetic energy accounts closed',()=>{
  const s=world(),solver=new CpuSolver(g,s),h=totalEnthalpy(s),mass=totalMass(s);let q=0,escape=0;
  for(let n=0;n<120;n++){solver.advance(1/30,empty,env);q+=solver.energyChanges.reduce((a,b)=>a+b,0);escape+=solver.escapeCells.reduce((a,b)=>a+b,0);}
  const residual=totalEnthalpy(solver.state,solver.climate)-h-q;
  console.log('layered conservation',{massResidual:totalMass(solver.state)+escape-mass,energyResidual:residual,cloud:solver.state.filter((_,i)=>i%STRIDE===F.cloud||i%STRIDE===F.cloudIce).reduce((a,b)=>a+b,0)});
  expect(totalMass(solver.state)+escape-mass).toBeCloseTo(0,3);expect(residual).toBeCloseTo(0,2);
 });
 it('uses independently stored layer temperature and pressure for saturation and resume diagnostics',()=>{
  const s=world(),c=new WeatherClimate(g);c.prepareSurface(s,env);c.air.attach(s);c.air.temperature[0]=4;c.air.mass[4]=.001;
  const air=c.conditions(s,0,env),a=c.snapshot(),resumed=new WeatherClimate(g);resumed.restore(a);
  expect(air.temperature).toBe(4);expect(air.height).toBe(500);expect(air.pressure).toBeGreaterThan(c.air.pressure(0,4));expect(resumed.conditions(s,0,env)).toEqual(air);
  expect(validClimate(a,g.count)).toBe(true);expect(validClimate({...a,atmosphere:{...a.atmosphere!,temperature:[NaN]}},g.count)).toBe(false);
 });
 it('advects momentum with air mass into neighboring cells, including heat from kinetic mixing',()=>{
  const s=world(),c=new WeatherClimate(g);c.prepareSurface(s,env);c.air.attach(s);
  const n=g.neighbors[0],normal=Array.from(g.directions.slice(0,3)),to=Array.from(g.directions.slice(n*3,n*3+3)),dot=to.reduce((a,b,k)=>a+b*normal[k],0),v=to.map((x,k)=>x-dot*normal[k]),length=Math.hypot(...v);
  c.air.velocity.set(v.map(x=>100*x/length),0);const h=totalEnthalpy(s,c),q=new Float32Array(g.count*4);
  c.step(s,1/30,{...env,sunlight:0},q);
  expect(Math.hypot(...c.air.velocity.slice(n*AIR_LAYERS*3,n*AIR_LAYERS*3+3))).toBeGreaterThan(.001);
  expect(totalEnthalpy(s,c)-h-q.reduce((a,b)=>a+b,0)).toBeCloseTo(0,2);
 });
 it('accelerates buoyant updrafts and suppresses convection in an inversion',()=>{
  const a=world(),b=world(),ca=new WeatherClimate(g),cb=new WeatherClimate(g);ca.prepareSurface(a,env);cb.prepareSurface(b,env);
  ca.air.temperature[0]=35;ca.air.temperature[1]=5;cb.air.temperature[0]=5;cb.air.temperature[1]=35;
  ca.step(a,1/30,{...env,sunlight:0},new Float32Array(g.count*4));cb.step(b,1/30,{...env,sunlight:0},new Float32Array(g.count*4));
  expect(ca.air.updraft[0]).toBeGreaterThan(0);expect(cb.air.updraft[0]).toBe(0);expect(ca.air.temperature[0]).toBeLessThan(35);
 });
 it('triggers saturated moist instability that would be stable under a dry-parcel test',()=>{
  const s=world(),c=new WeatherClimate(g);c.prepareSurface(s,env);c.air.attach(s);
  for(let q=0;q<c.air.temperature.length;q++){c.air.mass[q*AIR_SPECIES]=0;c.air.mass[q*AIR_SPECIES+4]=0;c.air.mass[q*AIR_SPECIES+5]=0;}
  for(let i=0;i<g.count;i++){
   const q=i*AIR_LAYERS;c.air.temperature[q]=25;c.air.temperature[q+1]=20;
   const moles=c.air.mass[q*AIR_SPECIES+1]/.028014;c.air.mass[q*AIR_SPECIES]=saturatedVapor(c.air.mass[q*AIR_SPECIES+1],moles,25,c.air.pressure(i,0));
  }
  c.air.attach(s);expect(liftedTemperature(25,1000,9.81,1040)).toBeLessThan(20);
  c.air.advance(s,1/60,{...env,sunlight:0},new Float32Array(g.count*4));
  expect(c.air.updraft[0]).toBeGreaterThan(0);
 });
 it('records prescribed-SST boundary heat as external energy and retains the column budget',()=>{
  const s=world(),c=new WeatherClimate(g);c.prepareSurface(s,env);c.air.attach(s);c.step(s,0,env,new Float32Array(g.count*4));
  const h=totalEnthalpy(s,c),energy=new Float32Array(g.count*4);
  c.air.advance(s,1/30,env,energy,undefined,undefined,undefined,{temperature:26.85,albedo:.07});
  expect(s[F.temperature]).toBeCloseTo(26.85,5);expect(energy.some((v,i)=>i%4===1&&Math.abs(v)>1)).toBe(true);
  expect(totalEnthalpy(s,c)-h-energy.reduce((a,b)=>a+b,0)).toBeCloseTo(0,2);
 });
 it('forms clouds over both land and water and on both day and night sides without geographic masks',()=>{
  const s=world();for(let i=0;i<g.count;i++)if(g.directions[i*3+2]>0)s[i*STRIDE+F.water]=3;
  const solver=new CpuSolver(g,s);solver.advance(1/30,empty,env);const groups={land:0,water:0,day:0,night:0};
  for(let i=0;i<g.count;i++){const p=i*STRIDE,cloud=solver.state[p+F.cloud]+solver.state[p+F.cloudIce];if(cloud>1e-8){groups[g.directions[i*3+2]>0?'water':'land']++;groups[g.directions[i*3]>0?'day':'night']++;}}
  console.log('cloud geography',groups);expect(Object.values(groups).every(n=>n>0)).toBe(true);
 });
 it('has no cloud source on a dry planet and preserves layers exactly across save/resume',()=>{
  const dry=new CpuSolver(g,seedPlanet(g,'sand',22));dry.advance(1,empty,env);expect(dry.state.every((v,i)=>i%STRIDE!==F.cloud&&i%STRIDE!==F.cloudIce||v===0)).toBe(true);
  const a=new CpuSolver(g,world());a.advance(.5,empty,env);const snapshot={version:4 as const,preset:'coast' as const,time:.5,state:[...a.state],climate:a.climate.snapshot(),environment:env,supplied:0,removed:0,discoveries:[]};
  expect(validSnapshot(snapshot,g.count)).toBe(true);const b=new CpuSolver(g,new Float32Array(snapshot.state));b.climate.restore(JSON.parse(JSON.stringify(snapshot.climate)));
  for(let n=0;n<30;n++){a.advance(1/30,empty,env);b.advance(1/30,empty,env);}expect(a.state).toEqual(b.state);expect(a.climate.snapshot()).toEqual(b.climate.snapshot());
 });
 it('drives horizontal circulation from a temperature contrast at equal initial column mass',()=>{
  const solver=new CpuSolver(g,seedPlanet(g,'sand',22));solver.climate.prepareSurface(solver.state,env);solver.climate.air.attach(solver.state);
  for(let i=0;i<g.count;i++)for(let k=0;k<AIR_LAYERS;k++)solver.climate.air.temperature[i*AIR_LAYERS+k]+=10*g.directions[i*3];
  solver.advance(1/30,empty,{...env,sunlight:0});expect(Math.max(...solver.climate.air.velocity.map(Math.abs))).toBeGreaterThan(.001);
 });
 it('evaporates in a vacuum with finite flux and conserved latent/thermal energy',()=>{
  const s=seedPlanet(g,'sand',22);for(let i=0;i<g.count;i++){s[i*STRIDE+F.nitrogen]=0;s[i*STRIDE+F.water]=1;}
  const solver=new CpuSolver(g,s),h=totalEnthalpy(s),mass=totalMass(s);solver.advance(1/30,empty,{...env,sunlight:0});
  expect(solver.state[F.vapor]).toBeGreaterThan(0);expect(solver.state[F.temperature]).toBeLessThan(22);expect(solver.state.every(Number.isFinite)).toBe(true);
  expect(totalEnthalpy(solver.state,solver.climate)-h-solver.energyChanges.reduce((a,b)=>a+b,0)).toBeCloseTo(0,3);expect(totalMass(solver.state)+solver.escapeCells.reduce((a,b)=>a+b,0)).toBeCloseTo(mass,4);
 });
 it('saves queued supply/erasure with layer mirrors consistent and rejects mismatched inventories',()=>{
  const a=new CpuSolver(g,world());a.advance(1/30,empty,env);const live=a.state.slice(),old=a.climate.snapshot(),commands=createCommandBatch(g.count);commands[8]=.1;commands[5]=.25;
  const saved=snapshotSurface(a.state,commands,[{index:1,material:'water',amount:.1}],null,a.climate,env),record={version:4 as const,preset:'coast' as const,time:1,state:[...saved.state],climate:saved.climate,environment:env,supplied:0,removed:0,discoveries:[]};
  expect(validSnapshot(record,g.count)).toBe(true);expect(a.state).toEqual(live);expect(a.climate.snapshot()).toEqual(old);
  const corrupt=structuredClone(record);corrupt.climate!.atmosphere!.mass[1]+=.1;expect(validSnapshot(corrupt,g.count)).toBe(false);
  a.advance(0,commands,env);const landing=createCommandBatch(g.count);landing[COMMAND_STRIDE]=.1;a.advance(0,landing,env);expect(a.state).toEqual(saved.state);expect(a.climate.snapshot()).toEqual(saved.climate);
 });
 it('leaves an unopened paused atmosphere exactly inert',()=>{
  const solver=new CpuSolver(g,world()),before=solver.state.slice(),air=solver.climate.snapshot();solver.advance(0,empty,env);expect(solver.state).toEqual(before);expect(solver.climate.snapshot()).toEqual(air);
 });
 it('restores the last committed surface and atmosphere if a climate step fails',()=>{
  const a=new CpuSolver(g,world());a.advance(1/30,empty,env);const before=a.state.slice(),air=a.climate.snapshot();
  vi.spyOn(a.climate,'step').mockImplementationOnce(()=>{a.climate.air.mass[0]+=.1;throw new Error('integration failure');});
  expect(()=>a.advance(1/30,empty,env)).toThrow('integration failure');expect(a.state).toEqual(before);expect(a.climate.snapshot()).toEqual(air);expect(a.energyChanges.every(v=>v===0)).toBe(true);
 });
 it('targets surface heat and accounts for impacts without instantly heating the air mirrors',()=>{
  const a=new CpuSolver(g,world());a.advance(1/30,empty,env);const commands=empty.slice(),air=a.climate.air.temperature.slice();commands[8]=10;commands[4]=heatForTarget(a.state,0,100,'heat',commands,null,true);
  a.advance(0,commands,env);expect(a.state[F.temperature]).toBeCloseTo(100,4);expect(a.climate.air.temperature[4]).toBe(air[4]);
  const budget=new Float64Array(4),h=totalEnthalpy(a.state,a.climate),temperatures=a.climate.air.temperature.slice(),impacted=impactMeteor(a.state,g,[...g.directions.slice(0,3)],36,budget,a.climate);
  expect(a.climate.air.temperature).toEqual(temperatures);expect(totalEnthalpy(impacted,a.climate)-h-budget.reduce((x,y)=>x+y,0)).toBeCloseTo(0,6);
 });
 it('migrates legacy tangent winds into layer momentum with a closed energy budget',()=>{
  const s=world(),h=totalEnthalpy(s),c=new WeatherClimate(g);c.wind[2]=.003;const old=c.snapshot();old.version=1;delete old.surfaceMassCarry;delete old.atmosphere;delete old.ocean;delete old.surfaceHeatCarry;c.restore(old);
  c.prepareSurface(s,env);c.air.attach(s);expect(c.air.velocity[2]).toBeCloseTo(50,5);expect(c.air.velocity[14]).toBeCloseTo(50,5);expect(totalEnthalpy(s,c)).toBeCloseTo(h,3);
 });
 it('renders a physical 0.1 kg/m² cloud over any surface and attenuates sunlight with that inventory',()=>{
  const s=seedPlanet(g,'sand',22),m=.1/COLUMN_KG;for(let i=0;i<g.count;i++)s[i*STRIDE+F.cloud]=m;
  const field=new CloudEnvelopeField(g).sample(s,new Float32Array(g.count).fill(2),true);
  expect(m).toBeGreaterThan(CLOUD_VISIBLE_MASS);expect(cloudComponents(g,field).cells).toBe(g.count);expect(cloudTransmission(m)).toBeCloseTo(1/(1+.075*15),8);
 });
 it('converges as the integration interval is halved',()=>{
  const run=(dt:number)=>{const a=new CpuSolver(g,seedPlanet(g,'sand',22));a.climate.prepareSurface(a.state,env);a.climate.air.attach(a.state);for(let i=0;i<g.count;i++){a.climate.air.temperature[i*AIR_LAYERS]=35+5*g.directions[i*3];a.climate.air.temperature[i*AIR_LAYERS+1]=0;}for(let t=0;t<2-1e-9;t+=dt)a.advance(dt,empty,env);return a;};
  const coarse=run(1/60),medium=run(1/120),fine=run(1/240),error=(a:CpuSolver,b:CpuSolver)=>Math.sqrt(a.climate.air.temperature.reduce((sum,t,i)=>sum+(t-b.climate.air.temperature[i])**2,0)/a.climate.air.temperature.length),ec=error(coarse,medium),ef=error(medium,fine);
  console.log('layered time convergence',{coarse:ec,fine:ef});expect(ef).toBeLessThan(ec*.75);expect(ef).toBeLessThan(.02);
 });
});
