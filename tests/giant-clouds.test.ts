import {describe,it,expect} from 'vitest';
import {AMMONIA_MELTING,DEEP_CP,DEEP_PHASE,DEEP_SPECIES,DEEP_MOLAR,equilibrateCloudParcel,parcelThermalEnergy,saturationPressure} from '../src/sim/giantCloudPhysics';
import {createSphere} from '../src/sim/sphere';
import {createDefinedPlanet,createJupiterPlanet,createSaturnPlanet} from '../src/sim/planetCreation';
import {JUPITER_DEFINITION} from '../src/sim/planetDefinition';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,totalMass,totalEnthalpy,type Snapshot} from '../src/sim/model';
import {DEEP_LAYERS,deepSnapshotEnergy} from '../src/sim/deepAtmosphere';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {SPECIFIC_HEAT,PHASE_ENERGY} from '../src/sim/thermodynamics';
import {DEEP_FIELDS} from '../src/sim/giantCloudPhysics';
import {giantCloudColor} from '../src/render/giantCloudColor';
import {radiativeFluxes} from '../src/sim/climatePhysics';
import {measurePlanet} from '../src/sim/telemetry';
import {snapshotSurface} from '../src/sim/session';
import {saturationPressure as waterSaturationPressure} from '../src/sim/waterPhysics';

const grid=createSphere(1),commands=new Float32Array(grid.count*COMMAND_STRIDE);
const speciesTotals=(mass:Float64Array)=>[0,1,2,5].map(f=>{let total=0;for(let q=0;q<mass.length;q+=DEEP_SPECIES)for(let k=0;k<(f>=2?3:1);k++)total+=mass[q+f+k];return total;});
function world(saturn=false){const p=saturn?createSaturnPlanet(grid):createJupiterPlanet(grid),solver=new CpuSolver(grid,p.state.slice());solver.climate.restore(p.climate);return {...p,solver};}
function saved(p:ReturnType<typeof world>):Snapshot{return {version:8,preset:'coast',time:0,state:[...p.solver.state],climate:p.solver.climate.snapshot(),environment:p.environment,spin:p.spin,supplied:0,removed:0,discoveries:[]};}
describe('giant volatile clouds and zonal jets',()=>{
 it('captures an unedited paused cloud atmosphere without re-equilibrating or changing the running state',()=>{
  const p=world(),s=p.solver,original=s.climate.snapshot(),state=s.state.slice();
  const stored=snapshotSurface(s.state,commands,[],null,s.climate,p.environment);expect(stored.state).toEqual(state);expect(stored.climate).toEqual(original);expect(s.state).toEqual(state);expect(s.climate.snapshot()).toEqual(original);
 });
 it('uses the same species heat and phase constants in common and deep diagnostics',()=>{
  DEEP_FIELDS.forEach((f,k)=>{expect(SPECIFIC_HEAT[f]).toBe(DEEP_CP[k]);expect(PHASE_ENERGY[f]).toBe(DEEP_PHASE[k]);});
  expect(saturationPressure('ammonia',AMMONIA_MELTING)).toBeCloseTo(6060,8);expect(saturationPressure('water',0)).toBe(waterSaturationPressure(0));
  expect(saturationPressure('ammonia',-150)).toBeLessThan(saturationPressure('ammonia',-130));
 });
 it.each(['ammonia','water'] as const)('condenses and re-evaporates %s with latent heat and finite species inventory',species=>{
  const f=species==='ammonia'?2:5,mass=new Float64Array([1,.1,0,0,0,0,0,0]);mass[f]=.02;
  const initial=-145,h=parcelThermalEnergy(mass,0,initial),t=equilibrateCloudParcel(mass,0,initial,1e5),cold=mass.slice();
  expect(t).toBeGreaterThan(initial);expect(mass[f+2]).toBeGreaterThan(0);expect(mass[f]+mass[f+1]+mass[f+2]).toBeCloseTo(.02,14);expect(parcelThermalEnergy(mass,0,t)).toBeCloseTo(h,10);
  const hot=equilibrateCloudParcel(mass,0,180,1e5);expect(mass[f]).toBeCloseTo(.02,14);expect(mass[f+1]+mass[f+2]).toBe(0);
  const cp=mass.reduce((a,m,k)=>a+m*DEEP_CP[k],0),phase=mass.reduce((a,m,k)=>a+m*DEEP_PHASE[k],0),back=equilibrateCloudParcel(mass,0,(h-phase)/cp,1e5);
  expect(back).toBeCloseTo(t,8);for(let k=0;k<8;k++)expect(mass[k]).toBeCloseTo(cold[k],10);expect(hot).toBeLessThan(180);
 });
 it.each(['ammonia','water'] as const)('resolves the %s melting plateau without inventing heat or mass',species=>{
  const f=species==='ammonia'?2:5,t=species==='ammonia'?AMMONIA_MELTING:0,p=1e6,mass=new Float64Array([1,.1,0,0,0,0,0,0]),dry=1/DEEP_MOLAR[0]+.1/DEEP_MOLAR[1],fraction=saturationPressure(species,t)/p;
  mass[f]=dry*fraction/(1-fraction)*DEEP_MOLAR[f];mass[f+1]=.05;mass[f+2]=.05;const h=parcelThermalEnergy(mass,0,t),before=mass.slice(),out=equilibrateCloudParcel(mass,0,t,p);
  expect(out).toBeCloseTo(t,10);expect(parcelThermalEnergy(mass,0,out)).toBeCloseTo(h,10);for(let k=0;k<8;k++)expect(mass[k]).toBeCloseTo(before[k],12);
 });
 it('solves both partial pressures together and responds to total pressure',()=>{
  const original=new Float64Array([1,.1,.01,0,0,.02,0,0]),low=original.slice(),high=original.slice();
  const tl=equilibrateCloudParcel(low,0,-130,1e4),th=equilibrateCloudParcel(high,0,-130,1e6);
  expect(high[2]).toBeLessThan(low[2]);for(const [mass,t,p] of [[low,tl,1e4],[high,th,1e6]] as const){const n=[0,1,2,5].reduce((a,f)=>a+mass[f]/DEEP_MOLAR[f],0);for(const [f,name] of [[2,'ammonia'],[5,'water']] as const)expect(mass[f]/DEEP_MOLAR[f]/n*p/saturationPressure(name,t)).toBeCloseTo(1,7);expect(speciesTotals(mass)).toEqual(speciesTotals(original));}
 });
 it.each([false,true])('creates clouds and layer-dependent opposing jets in both presets (%s)',saturn=>{
  const p=world(saturn),g=p.solver.climate.giant;expect(validSnapshot(saved(p),grid.count)).toBe(true);
  const clouds=Array.from({length:grid.count},(_,i)=>g.cloudOptics(i));expect(clouds.every(c=>c.ammonia>0&&c.water>0&&c.opticalDepth>0)).toBe(true);
  const wind=Array.from({length:grid.count},(_,i)=>g.zonalWind(i));expect(Math.max(...wind)).toBeGreaterThan(10);expect(Math.min(...wind)).toBeLessThan(-10);
  expect(Math.max(...clouds.map(c=>c.opticalDepth))-Math.min(...clouds.map(c=>c.opticalDepth))).toBeGreaterThan(.01);
  expect(g.zonalWind(0,0)).not.toBe(g.zonalWind(0,8));expect(g.bands().reduce((a,b)=>a+b.count,0)).toBe(grid.count);
 });
 it('sediments each condensate within sealed boundaries and converts lost potential energy to heat',()=>{
  const p=world(),g=p.solver.climate.giant,m=speciesTotals(g.mass),h=g.totalEnergy(),before=g.mass.slice();g.sedimentation(3600);
  expect(g.mass).not.toEqual(before);for(let f=0;f<4;f++)expect(speciesTotals(g.mass)[f]).toBeCloseTo(m[f],10);expect(g.totalEnergy()).toBeCloseTo(h,8);
  const dropped=g.mass.slice();g.equilibrateClouds();expect(g.mass).not.toEqual(dropped);expect(g.totalEnergy()).toBeCloseTo(h,8);expect(g.mass.every(v=>v>=0)).toBe(true);
 });
 it('seeds finite tracer bands without changing any species, layer energy or column weight',()=>{
  const g=world().solver.climate.giant,m=speciesTotals(g.mass),h=Array.from(g.temperature,(_,q)=>g.layerEnergy(q)),pressure=Array.from({length:grid.count},(_,i)=>g.bottomPressure(i));
  g.seedCloudBands();g.equilibrateClouds();for(let f=0;f<4;f++)expect(speciesTotals(g.mass)[f]).toBeCloseTo(m[f],11);h.forEach((v,q)=>expect(g.layerEnergy(q)).toBeCloseTo(v,9));pressure.forEach((v,i)=>expect(g.bottomPressure(i)).toBeCloseTo(v,7));
 });
 it('couples actual cloud mass to shortwave reflection and longwave opacity',()=>{
  const p=world(),g=p.solver.climate.giant,col=g.radiationColumn(0,p.environment);expect(Array.from(col.cloudTransportDepth).some(t=>t>0)).toBe(true);
  const cloudOpacity=Array.from(col.opticalDepth).reduce((a,b)=>a+b,0);for(let q=0;q<g.temperature.length;q++)for(const f of [3,4,6,7])g.mass[q*8+f]=0;
  const clear=g.radiationColumn(0,p.environment);expect(Array.from(clear.cloudTransportDepth).every(t=>t===0)).toBe(true);expect(Array.from(clear.opticalDepth).reduce((a,b)=>a+b,0)).toBeLessThan(cloudOpacity);
  col.solar=500;clear.solar=500;expect(radiativeFluxes(col).reflectedSolar).toBeGreaterThan(radiativeFluxes(clear).reflectedSolar);
 });
 it('draws cloud contrast from actual opacity and measures the signed zonal velocity',()=>{
  const p=world(),g=p.solver.climate.giant,colors=Array.from({length:grid.count},(_,i)=>giantCloudColor(g.cloudOptics(i)));
  expect(Math.max(...colors.map(c=>c[0]))-Math.min(...colors.map(c=>c[0]))).toBeGreaterThan(.05);
  expect(giantCloudColor(g.cloudOptics(0),false)).toEqual(giantCloudColor(g.cloudOptics(1),false));
  const point=measurePlanet({time:0,state:p.state,climate:p.solver.climate.snapshot(),environment:p.environment,directions:grid.directions,supplied:0,removed:0,escaped:0,transferredIn:0,transferredOut:0});
  const wind=Array.from({length:grid.count},(_,i)=>g.zonalWind(i));expect(point.values.jetEast).toBeCloseTo(Math.max(...wind),4);expect(point.values.jetWest).toBeCloseTo(Math.min(...wind),4);expect(point.values.ammoniaTotal).toBeCloseTo(speciesTotals(g.mass)[2],10);
 });
 it.each([false,true])('preserves every species, full energy and exact restart through a moist hour (%s)',saturn=>{
  const p=world(saturn),s=p.solver,g=s.climate.giant,m=speciesTotals(g.mass),h=totalEnthalpy(s.state,s.climate);let external=0;
  for(let n=0;n<120;n++){s.advance(.5,commands,p.environment);external+=s.energyChanges.reduce((a,b)=>a+b,0);}
  const residual=totalEnthalpy(s.state,s.climate)-h-external,massResidual=speciesTotals(g.mass).map((v,f)=>v-m[f]);console.log('moist giant one-hour budget',{saturn,massResidual,energyResidual:residual});
  massResidual.forEach(v=>expect(Math.abs(v)).toBeLessThan(1e-9));expect(Math.abs(residual)).toBeLessThan(1e-5);
  const snapshot=JSON.parse(JSON.stringify(saved(p))) as Snapshot;expect(validSnapshot(snapshot,grid.count)).toBe(true);const copy=new CpuSolver(grid,new Float32Array(snapshot.state));copy.climate.restore(snapshot.climate);
  for(let n=0;n<3;n++){copy.advance(.1,commands,snapshot.environment);s.advance(.1,commands,p.environment);}expect(copy.state).toEqual(s.state);expect(copy.climate.snapshot()).toEqual(s.climate.snapshot());
 },60000);
 it('upgrades the 32-field H₂/He-only save without adding volatiles, changing jets or rewriting its source',()=>{
  const d=structuredClone(JUPITER_DEFINITION);d.atmosphere.composition=d.atmosphere.composition.slice(0,2);const sum=d.atmosphere.composition.reduce((a,c)=>a+c.moleFraction,0);d.atmosphere.composition.forEach(c=>c.moleFraction/=sum);
  const p=createDefinedPlanet(grid,d),climate=structuredClone(p.climate)!,giant=climate.giant!,legacyMass=giant.mass.filter((_,k)=>k%8<2);giant.mass=legacyMass;giant.version=1;
  const legacy:Snapshot={version:7,preset:'coast',state:Array.from({length:grid.count},(_,i)=>[...p.state.slice(i*STRIDE,i*STRIDE+32)]).flat(),climate,environment:p.environment,time:17,supplied:0,removed:0,discoveries:[],spin:p.spin},before=structuredClone(legacy),energy=deepSnapshotEnergy(giant);
  expect(validSnapshot(legacy,grid.count)).toBe(true);const upgraded=upgradeSnapshot(legacy,grid.count);expect(legacy).toEqual(before);expect(upgraded.version).toBe(11);expect(upgraded.climate!.giant!.version).toBe(2);expect(validSnapshot(upgraded,grid.count)).toBe(true);
  const copy=new CpuSolver(grid,new Float32Array(upgraded.state));copy.climate.restore(upgraded.climate);expect(speciesTotals(copy.climate.giant.mass).slice(2)).toEqual([0,0]);expect(copy.climate.giant.velocity).toEqual(new Float64Array(giant.velocity));expect(totalEnthalpy(copy.state,copy.climate)).toBeCloseTo(energy,9);expect(totalMass(copy.state,copy.climate)).toBeCloseTo(legacyMass.reduce((a,b)=>a+b,0),10);
  copy.advance(.2,commands,upgraded.environment);expect(speciesTotals(copy.climate.giant.mass).slice(2)).toEqual([0,0]);
 });
 it('rejects broken condensate arrays and reserved fields in new saves',()=>{
  const p=world();for(const mutate of [(s:Snapshot)=>{s.climate!.giant!.mass[4]=-1;},(s:Snapshot)=>{s.state[F.ammoniaIce]+=1;},(s:Snapshot)=>{s.state[33]=1;},(s:Snapshot)=>{s.climate!.giant!.version=1;}]){const s=saved(p);mutate(s);expect(validSnapshot(s,grid.count)).toBe(false);}
 });
});
