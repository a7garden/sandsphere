import {describe,it,expect,vi} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,totalMass,totalEnthalpy,type Snapshot} from '../src/sim/model';
import {createJupiterPlanet,createSaturnPlanet,createMarsPlanet,createDefinedPlanet} from '../src/sim/planetCreation';
import {JUPITER_DEFINITION,SATURN_DEFINITION,planetSupport,isDeepAtmosphere,planetOrbitPeriod} from '../src/sim/planetDefinition';
import {DEEP_LAYERS,DEEP_SPECIES,DEEP_FIELDS,validDeep,deepSnapshotEnergy} from '../src/sim/deepAtmosphere';
import {WeatherClimate} from '../src/sim/weatherClimate';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {BackgroundWorlds,advanceOrbit,prepareSystemSave} from '../src/sim/system';
import {snapshotSurface} from '../src/sim/session';
import {climateTransferBuffers} from '../src/sim/solverWorkerProtocol';
import {radiativeFluxes} from '../src/sim/climatePhysics';
const grid=createSphere(1),empty=new Float32Array(grid.count*COMMAND_STRIDE);
function world(saturn=false,dry=false){const definition=structuredClone(saturn?SATURN_DEFINITION:JUPITER_DEFINITION);if(dry){definition.atmosphere.composition=definition.atmosphere.composition.filter(c=>['hydrogen','helium'].includes(c.species));const sum=definition.atmosphere.composition.reduce((a,c)=>a+c.moleFraction,0);for(const c of definition.atmosphere.composition)c.moleFraction/=sum;}const p=createDefinedPlanet(grid,definition),solver=new CpuSolver(grid,p.state.slice());solver.climate.restore(p.climate);return {...p,solver};}
function snapshot(p:ReturnType<typeof world>):Snapshot{return {version:8,preset:'coast',environment:p.environment,spin:p.spin,state:[...p.solver.state],climate:p.solver.climate.snapshot(),time:0,supplied:0,removed:0,discoveries:[]};}
const stock={ice:0,ceramic:0,glass:0,plant:0,herbivore:0,carnivore:0,iron:0};
describe('finite hydrogen/helium giants',()=>{
 it.each([false,true])('creates a solid-free pressure column with the specified mixture and boundary (%s)',saturn=>{
  const p=world(saturn),g=p.solver.climate.giant,definition=saturn?SATURN_DEFINITION:JUPITER_DEFINITION;
  expect(planetSupport(definition).supported).toBe(true);expect(g.ready).toBe(true);expect(g.mass.length).toBe(grid.count*DEEP_LAYERS*DEEP_SPECIES);expect(g.bottomPressure(0)).toBeCloseTo(3e6,6);
  const hydrogen=g.mass.filter((_,k)=>k%DEEP_SPECIES===0).reduce((a,b)=>a+b,0)/.002016,helium=g.mass.filter((_,k)=>k%DEEP_SPECIES===1).reduce((a,b)=>a+b,0)/.004003;
  expect(hydrogen/(hydrogen+helium)).toBeCloseTo(definition.atmosphere.composition[0].moleFraction/(definition.atmosphere.composition[0].moleFraction+definition.atmosphere.composition[1].moleFraction),10);
  for(let i=0;i<grid.count;i++)for(let f=0;f<28;f++)if(f!==F.temperature&&!(DEEP_FIELDS as readonly number[]).includes(f))expect(p.state[i*STRIDE+f]).toBe(0);
  expect(g.temperature[DEEP_LAYERS-1]).toBeGreaterThan(g.temperature[0]);expect(validSnapshot(snapshot(p),grid.count)).toBe(true);
  expect(planetOrbitPeriod(definition.orbit.distanceAu,definition)).toBeCloseTo(definition.orbit.periodSeconds/60,6);
 });
 it('rejects unsupported deep mixtures and out-of-domain boundaries before creation',()=>{
  for(const mutate of [(d:typeof JUPITER_DEFINITION)=>{d.atmosphere.composition=[{species:'ammonia',moleFraction:1}];},(d:typeof JUPITER_DEFINITION)=>{d.kind='ice-giant';},(d:typeof JUPITER_DEFINITION)=>{d.atmosphere.radiation='earth-spectral';},(d:typeof JUPITER_DEFINITION)=>{d.lowerBoundary={kind:'deep-atmosphere',pressurePa:1e8,intrinsicFlux:1};}]){const d=structuredClone(JUPITER_DEFINITION);mutate(d);expect(planetSupport(d).supported).toBe(false);expect(()=>createDefinedPlanet(grid,d)).toThrow();}
 });
 it('initializes an aggregate without adding a substrate or energy reservoir',()=>{
  const p=world(),s=p.state.slice(),before=totalEnthalpy(s),c=new WeatherClimate(grid);c.prepareSurface(s,p.environment);
  expect(c.giant.totalEnergy()).toBeCloseTo(before,7);expect(c.giant.totalMass()).toBeCloseTo(totalMass(p.state),8);
 });
 it('uses a prescribed net internal flux and closes the top/bottom radiative budget',()=>{
  const p=world(),g=p.solver.climate.giant,before=g.totalEnergy(),m=g.totalMass(),energy=new Float32Array(grid.count*4),e={...p.environment,sunlight:0};g.radiation(10,e,energy);
  const intrinsic=energy.filter((_,k)=>k%4===1).reduce((a,b)=>a+b,0),external=energy.reduce((a,b)=>a+b,0);
  expect(intrinsic).toBeCloseTo(grid.count*10*5.4/(101325/(9.81*.3)*1000),10);expect(g.totalEnergy()-before-external).toBeCloseTo(0,7);expect(g.totalMass()).toBe(m);
  const column=g.radiationColumn(0,e),down=radiativeFluxes(column).down[0];column.longwaveBands![0].surfaceSource=down+g.intrinsicFlux;const flux=radiativeFluxes(column);expect(flux.up[0]-flux.down[0]).toBeCloseTo(g.intrinsicFlux,10);
 });
 it('changes collision-induced grey opacity with pressure and H₂ concentration',()=>{
  const p=world(false,true),g=p.solver.climate.giant,e=p.environment,col=g.radiationColumn(0,e),tau=Array.from(col.opticalDepth).reduce((a,b)=>a+b,0);
  for(let k=0;k<DEEP_LAYERS;k++){g.mass[k*DEEP_SPECIES]*=2;g.mass[k*DEEP_SPECIES+1]*=2;}
  expect(Array.from(g.radiationColumn(0,e).opticalDepth).reduce((a,b)=>a+b,0)).toBeCloseTo(4*tau,7);
  for(let k=0;k<DEEP_LAYERS;k++){g.mass[k*DEEP_SPECIES+1]+=g.mass[k*DEEP_SPECIES];g.mass[k*DEEP_SPECIES]=0;}
  expect(Array.from(g.radiationColumn(0,e).opticalDepth).every(v=>v===0)).toBe(true);
 });
 it('transports each species, heat and momentum and returns dissipated kinetic energy to heat',()=>{
  const p=world(),g=p.solver.climate.giant,mass=g.totalMass(),h=g.totalEnergy(),species=[0,1].map(f=>g.mass.filter((_,k)=>k%DEEP_SPECIES===f).reduce((a,b)=>a+b,0)),before=g.mass.slice();
  g.dynamics(300,p.environment);expect(g.mass).not.toEqual(before);expect(g.totalMass()).toBeCloseTo(mass,10);expect(g.totalEnergy()).toBeCloseTo(h,8);
  for(let f=0;f<2;f++)expect(g.mass.filter((_,k)=>k%DEEP_SPECIES===f).reduce((a,b)=>a+b,0)).toBeCloseTo(species[f],10);expect(g.mass.every(v=>v>=0)).toBe(true);
 });
 it.each([false,true])('conserves mass and the full energy ledger for one hour and resumes exactly (%s)',saturn=>{
  const p=world(saturn,true),s=p.solver,m=totalMass(s.state,s.climate),h=totalEnthalpy(s.state,s.climate);let q=0;
  for(let n=0;n<120;n++){s.advance(.5,empty,p.environment);q+=s.energyChanges.reduce((a,b)=>a+b,0);}
  const residual=totalEnthalpy(s.state,s.climate)-h-q;console.log('giant one-hour budget',{saturn,massResidual:totalMass(s.state,s.climate)-m,energyResidual:residual});expect(totalMass(s.state,s.climate)-m).toBeCloseTo(0,9);expect(Math.abs(residual)).toBeLessThan(1e-5);
  const saved=snapshot(p),copy=JSON.parse(JSON.stringify(saved)) as Snapshot;expect(validSnapshot(copy,grid.count)).toBe(true);expect(deepSnapshotEnergy(copy.climate!.giant!)).toBeCloseTo(totalEnthalpy(s.state,s.climate),8);
  const resumed=new CpuSolver(grid,new Float32Array(copy.state));resumed.climate.restore(copy.climate);for(let n=0;n<5;n++){s.advance(1/30,empty,p.environment);resumed.advance(1/30,empty,copy.environment);}expect(resumed.state).toEqual(s.state);expect(resumed.climate.snapshot()).toEqual(s.climate.snapshot());
 });
 it('applies paused heat to a gas layer and rejects solid tools without mutation, including rollback',()=>{
  const p=world(),s=p.solver,before=s.climate.giant.totalEnergy(),mass=s.climate.giant.totalMass(),cmd=empty.slice();cmd[4]=10;s.advance(0,cmd,p.environment);expect(s.climate.giant.totalEnergy()-before).toBeCloseTo(10,8);expect(s.climate.giant.totalMass()).toBeCloseTo(mass,12);
  const stored=snapshotSurface(s.state,cmd,[],null,s.climate,p.environment),copy=new CpuSolver(grid,s.state.slice());copy.climate.restore(s.climate.snapshot());copy.advance(0,cmd,p.environment);expect(stored.state).toEqual(copy.state);expect(stored.climate).toEqual(copy.climate.snapshot());
  const initial=snapshot(p);cmd[0]=1;expect(()=>s.advance(.1,cmd,p.environment)).toThrow('온도 조정');expect(snapshot(p)).toEqual(initial);
  expect(()=>s.advance(.1,empty,{...p.environment,body:structuredClone(SATURN_DEFINITION)})).toThrow('대기 상태');expect(snapshot(p)).toEqual(initial);
  cmd.fill(0);const real=s.climate.giant.dynamics.bind(s.climate.giant),mock=vi.spyOn(s.climate.giant,'dynamics').mockImplementation((dt,e)=>{real(dt,e);throw new Error('rollback');});expect(()=>s.advance(.1,cmd,p.environment)).toThrow('rollback');mock.mockRestore();expect(snapshot(p)).toEqual(initial);
 });
 it('rejects corrupted deep arrays, metadata, solid stock and inconsistent aggregate mirrors',()=>{
  const p=world(),s=snapshot(p);for(const mutate of [(s:Snapshot)=>{s.climate!.giant!.mass[0]=-1;},(s:Snapshot)=>{s.climate!.giant!.radiusMeters=1e6;},(s:Snapshot)=>{s.climate!.giant!.intrinsicFlux=0;},(s:Snapshot)=>{s.state[F.water]=1;},(s:Snapshot)=>{s.state[F.hydrogen]=0;},(s:Snapshot)=>{s.state[F.temperature]+=1;},(s:Snapshot)=>{s.planet={primary:'rock'};},(s:Snapshot)=>{delete s.climate;},(s:Snapshot)=>{s.environment.climate=false;}]){const bad=structuredClone(s);mutate(bad);expect(validSnapshot(bad,grid.count)).toBe(false);}
  expect(validDeep(s.climate!.giant,grid.count)).toBe(true);expect(validDeep({...s.climate!.giant!,height:[]},grid.count)).toBe(false);
 });
 it('migrates the prior 28-field Mars save without changing any inventories, heat, dust carries or clocks',()=>{
  const p=createMarsPlanet(grid),cpu=new CpuSolver(grid,p.state);cpu.advance(.1,empty,p.environment);const old:Snapshot={version:6,preset:'coast',planet:{primary:p.primary},time:1,state:Array.from({length:grid.count},(_,i)=>[...cpu.state.slice(i*STRIDE,i*STRIDE+28)]).flat(),climate:cpu.climate.snapshot(),environment:p.environment,discoveries:[],supplied:0,removed:0};
  const prior=structuredClone(old);expect(validSnapshot(old,grid.count)).toBe(true);const upgraded=upgradeSnapshot(old,grid.count);expect(old).toEqual(prior);expect(upgraded.version).toBe(11);expect(upgraded.climate).toEqual(old.climate);
  for(let i=0;i<grid.count;i++){expect(upgraded.state.slice(i*STRIDE,i*STRIDE+28)).toEqual(old.state.slice(i*28,(i+1)*28));expect(upgraded.state.slice(i*STRIDE+28,(i+1)*STRIDE)).toEqual(Array(STRIDE-28).fill(0));}
  expect(totalEnthalpy(new Float32Array(upgraded.state),upgraded.climate)).toBeCloseTo(totalEnthalpy(cpu.state,cpu.climate),8);
 });
 it('transfers every deep checkpoint buffer and matches active and background stepping in a mixed system',()=>{
  const p=world(),s=snapshot(p),record={id:'planet-jupiter',name:'Jupiter',snapshot:structuredClone(s)},background=new BackgroundWorlds(grid),cp=p.solver.climate.checkpoint(),buffers=climateTransferBuffers(cp);
  for(const a of [cp.giant!.mass,cp.giant!.temperature,cp.giant!.velocity,cp.giant!.height])expect(buffers).toContain(a.buffer);
  for(let n=0;n<4;n++){advanceOrbit(s,1/30);p.solver.advance(1/30,empty,s.environment);background.step([record],'other',1/30);}expect(record.snapshot.state).toEqual([...p.solver.state]);expect(record.snapshot.climate).toEqual(p.solver.climate.snapshot());
  const saved=prepareSystemSave({version:3,mode:'sandbox',activeId:record.id,planets:[record],stock,savedAt:1},grid.count);expect(isDeepAtmosphere(saved.planets[0].snapshot.environment.body)).toBe(true);
 });
});
