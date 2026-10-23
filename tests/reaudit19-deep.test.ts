import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createSphere} from '../src/sim/sphere';
import {CpuSolver,COMMAND_STRIDE,STRIDE,F,totals,totalMass,totalEnthalpy,type Snapshot} from '../src/sim/model';
import {createDefinedPlanet} from '../src/sim/planetCreation';
import {JUPITER_DEFINITION,MARS_DEFINITION,planetSupport,type PlanetDefinition} from '../src/sim/planetDefinition';
import {DEEP_LAYERS,validDeep} from '../src/sim/deepAtmosphere';
import {equilibrateCloudParcel,parcelThermalEnergy} from '../src/sim/giantCloudPhysics';
import {validSnapshot} from '../src/sim/storage';
import {elementalMass} from '../src/sim/chemistry';
import {advanceOrbit} from '../src/sim/system';
import {localSun} from '../src/sim/orbit';
import type {DeepInitialConditions} from '../src/sim/deepAtmosphereProfile';
import {WeatherClimate} from '../src/sim/weatherClimate';
import {orbitalEnvironment} from '../src/sim/orbit';

// Audit-only probes. No production fixes or older tolerances are changed.
const grid=createSphere(0),commands=new Float32Array(grid.count*COMMAND_STRIDE);
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const files=['package.json','src/sim/deepAtmosphere.ts','src/sim/deepAtmosphereProfile.ts','src/sim/giantCloudPhysics.ts','src/sim/planetDefinition.ts','src/sim/planetCreation.ts','src/sim/climatePhysics.ts','src/sim/orbit.ts','src/sim/system.ts','src/sim/storage.ts','src/sim/conservativeTransport.ts','src/sim/thermodynamics.ts','src/sim/model.ts','tests/reaudit19-deep.test.ts'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
const sourceSha256=hashes();
function receipt(name:string,value:object){const dir=`artifacts/reaudit19/deep/${runId}`;mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/${name}.json`,JSON.stringify({runId,sourceSha256,sourceEndSha256:hashes(),...value},null,2));}
const custom=(base=JUPITER_DEFINITION)=>({...structuredClone(base),preset:'custom' as const});
function world(d:PlanetDefinition=custom(),initial?:DeepInitialConditions){const p=createDefinedPlanet(grid,d,initial),solver=new CpuSolver(grid,p.state.slice());solver.climate.restore(p.climate);return {...p,solver};}
function save(p:ReturnType<typeof world>,time=0):Snapshot{return {version:11,preset:'coast',time,state:[...p.solver.state],climate:p.solver.climate.snapshot(),environment:structuredClone(p.environment),spin:{...p.spin},supplied:0,removed:0,discoveries:[],...(p.solver.climate.giant.ready?{}:{planet:{primary:p.primary}})};}
function stats(p:ReturnType<typeof world>){const g=p.solver.climate.giant;return {mass:totalMass(p.solver.state,p.solver.climate),energy:totalEnthalpy(p.solver.state,p.solver.climate),stock:[...totals(p.solver.state,p.solver.climate)],elements:elementalMass(totals(p.solver.state,p.solver.climate)),minT:Math.min(...g.temperature),maxT:Math.max(...g.temperature),maxSpeed:Math.max(...Array.from({length:g.temperature.length},(_,q)=>Math.hypot(...g.velocity.subarray(q*3,q*3+3)))),validDeep:validDeep(g.snapshot(),grid.count),validSave:validSnapshot(save(p),grid.count)};}

describe.skipIf(process.env.REAUDIT19_DEEP!=='1')('reaudit19 deep atmosphere and planet domain',()=>{
 it('requires every admitted created planet to be immediately persistable',()=>{
  const cases:[string,PlanetDefinition,DeepInitialConditions?][]=[];
  const close=custom();close.orbit.distanceAu=.5;cases.push(['deep-half-AU',close]);
  const fast=custom();fast.rotation.periodSeconds=1000;cases.push(['deep-fast-spin',fast]);
  const slow=custom();slow.rotation.periodSeconds=200000;cases.push(['deep-slow-spin',slow]);
  cases.push(['deep-hot-initial',custom(),{referenceTemperatureKelvin:500,minimumTemperatureKelvin:110,jetSpeed:0,temperaturePerturbation:0,cloudBands:false}]);
  const remote=custom(MARS_DEFINITION);remote.orbit.distanceAu=100;cases.push(['rocky-100-AU',remote]);
  const rows=cases.map(([name,d,initial])=>{const support=planetSupport(d,initial?{initial}:undefined),p=world(d,initial),snapshot=save(p);return {name,support,definition:d,initial,ambient:p.environment.ambient,sunlight:p.environment.sunlight,rotationRate:p.environment.rotationRate,periodMinutes:p.spin.period,validSave:validSnapshot(snapshot,grid.count),snapshot};});
  receipt('creation-save-domain',{status:rows.every(r=>r.validSave)?'passed':'failed',expected:'Every admitted created planet is persistable without clipping or rewriting its inputs',rows});
  for(const row of rows){expect(row.support.supported,row.name).toBe(true);expect(row.validSave,row.name).toBe(true);}
 });

 it('measures admitted deep extremes through bounded evolution and repeated exact JSON resumes',()=>{
  const moist=custom();moist.surfaceGravity=29.43;moist.atmosphere.composition=[{species:'hydrogen',moleFraction:.9},{species:'vapor',moleFraction:.1}];
  const helium=custom();helium.surfaceGravity=29.43;helium.radiusMeters=2e8;helium.atmosphere.composition=[{species:'helium',moleFraction:1}];
  const tiny=custom();tiny.radiusMeters=1000;
  const cases:[string,PlanetDefinition,DeepInitialConditions?][]=[['water-ten-percent',moist,{referenceTemperatureKelvin:165,minimumTemperatureKelvin:110,jetSpeed:100,temperaturePerturbation:1,cloudBands:false}],['hot-pure-helium',helium,{referenceTemperatureKelvin:350,minimumTemperatureKelvin:350,jetSpeed:500,temperaturePerturbation:0,cloudBands:false}],['tiny-radius',tiny]];
  const rows=[];
  for(const [name,d,initial] of cases){let p=world(d,initial),n=0,restarts=0,error:string|undefined;const start=stats(p),channels=[0,0,0,0],samples=[];let exactRestart=true;
   try{for(n=1;n<=1500;n++){
    p.solver.advance(1/30,commands,p.environment);for(let j=0;j<p.solver.energyChanges.length;j++)channels[j%4]+=p.solver.energyChanges[j];
    if(n%300===0){samples.push({step:n,...stats(p)});const raw=JSON.parse(JSON.stringify(save(p,n/30))) as Snapshot;if(!validSnapshot(raw,grid.count))throw new Error('evolved snapshot is invalid');
     const copy=new CpuSolver(grid,new Float32Array(raw.state));copy.climate.restore(raw.climate);
     // Compare one same step without adding it to the physical run.
     const probe=new CpuSolver(grid,p.solver.state.slice());probe.climate.restore(p.solver.climate.snapshot());probe.advance(1/60,commands,p.environment);copy.advance(1/60,commands,raw.environment);
     exactRestart&&=JSON.stringify(copy.climate.snapshot())===JSON.stringify(probe.climate.snapshot())&&JSON.stringify([...copy.state])===JSON.stringify([...probe.state]);restarts++;
     const resumed=new CpuSolver(grid,new Float32Array(raw.state));resumed.climate.restore(raw.climate);p={...p,solver:resumed};
    }
   }}catch(e){error=String(e);}
   const final=stats(p),energyResidual=final.energy-start.energy-channels.reduce((a,b)=>a+b),massResidual=final.mass-start.mass,elementResidual=Math.max(...Object.keys(start.elements).map(k=>Math.abs(final.elements[k as keyof typeof final.elements]-start.elements[k as keyof typeof start.elements])/Math.max(1,start.elements[k as keyof typeof start.elements])));
   // An explicit temperature-domain exit is a model limit, not by itself a
   // conservation defect. Keep its failed evolution receipt and rollback state.
   rows.push({name,definition:d,initial,status:error?'model-domain-exit':'passed',stepsCompleted:error?n-1:1500,error,start,final,channels,energyResidual,massResidual,elementResidual,restarts,exactRestart,samples,...(error?{snapshot:save(p,(n-1)/30)}:{})});
  }
  receipt('extreme-evolution',{status:rows.every(r=>r.status==='passed')?'passed':'failed',limits:{massRelative:2e-5,elementRelative:2e-5,energyRelative:2e-7},rows});
  for(const row of rows){if(row.name==='tiny-radius'){expect(row.error).toContain('계산');expect(row.final.minT).toBeGreaterThanOrEqual(-250);}else expect(row.error,row.name).toBeUndefined();expect(row.final.validDeep,row.name).toBe(true);expect(row.final.validSave,row.name).toBe(true);expect(row.exactRestart,row.name).toBe(true);expect(Math.abs(row.massResidual)/Math.max(1,row.start.mass)).toBeLessThan(2e-5);expect(row.elementResidual).toBeLessThan(2e-5);expect(Math.abs(row.energyResidual)/Math.max(1,Math.abs(row.start.energy))).toBeLessThan(2e-7);}
 },120000);

 it('can initialize the admitted volatile composition with the default creation pattern',()=>{
  const rows=[];
  for(const species of ['vapor','ammonia'] as const)for(const fraction of [.01,.05,.1]){
   const d=custom();d.surfaceGravity=29.43;d.atmosphere.composition=[{species:'hydrogen',moleFraction:1-fraction},{species,moleFraction:fraction}];
   const initial={referenceTemperatureKelvin:165,minimumTemperatureKelvin:110,jetSpeed:100,temperaturePerturbation:1,cloudBands:true},support=planetSupport(d,{initial}),climate=new WeatherClimate(grid),state=new Float32Array(grid.count*STRIDE),environment={...orbitalEnvironment(d.orbit.distanceAu,d.surfaceGravity/9.81),body:d,climate:true,ambient:165-273.15};let error:string|undefined;
   try{climate.giant.initialize(state,environment,initial);}catch(e){error=String(e);}
   let directCreationError:string|undefined;try{createDefinedPlanet(grid,d);}catch(e){directCreationError=String(e);}
   const negative=Array.from(climate.giant.mass,(mass,index)=>({mass,index,species:index%8})).filter(x=>x.mass<0);
   rows.push({species,fraction,support,error,directCreationError,minT:Math.min(...climate.giant.temperature),maxT:Math.max(...climate.giant.temperature),minimumMass:Math.min(...climate.giant.mass),negative,definition:d,initial,deep:climate.giant.snapshot()});
  }
  receipt('volatile-creation',{status:rows.every(r=>!r.error)?'passed':'failed',rows});for(const row of rows){expect(row.support.supported).toBe(true);expect(row.error,`${row.species} ${row.fraction}`).toBeUndefined();}
 });

 it('carries condensate momentum and full parcel energy through sealed-layer sedimentation',()=>{
  const p=world(),g=p.solver.climate.giant;
  for(let i=0;i<grid.count;i++)for(let k=0;k<DEEP_LAYERS;k++){const q=i*DEEP_LAYERS+k,x=grid.directions[i*3],z=grid.directions[i*3+2],n=Math.hypot(x,z);if(n)g.velocity.set([z/n*(k+1)*10,0,-x/n*(k+1)*10],q*3);}
  const momentum=()=>Array.from({length:grid.count*3},(_,j)=>{const i=Math.floor(j/3),v=j%3;let sum=0;for(let k=0;k<DEEP_LAYERS;k++){const q=i*DEEP_LAYERS+k;sum+=g.layerMass(q)*g.velocity[q*3+v];}return sum;});
  const before=momentum(),mass=g.totalMass(),energy=g.totalEnergy();g.sedimentation(60);const after=momentum(),momentumResidual=Math.max(...after.map((v,i)=>Math.abs(v-before[i]))),energyResidual=g.totalEnergy()-energy,massResidual=g.totalMass()-mass;
  receipt('sedimentation-momentum',{status:'measured',momentumResidual,energyResidual,massResidual,scope:'same-column internal sedimentation, not global angular momentum or pressure-force accounting'});
  expect(momentumResidual).toBeLessThan(1e-10);expect(Math.abs(energyResidual)).toBeLessThan(1e-8);expect(Math.abs(massResidual)).toBeLessThan(1e-10);
 });

 it('uses preset-independent evolution and converges under real timestep refinement',()=>{
  const initial={referenceTemperatureKelvin:165,minimumTemperatureKelvin:110,jetSpeed:0,temperaturePerturbation:0,cloudBands:false},base=world(custom(),initial),snapshot=save(base),scales=[1,2,4,8];
  const runs=scales.map(scale=>{const p=world(custom(),initial);for(let n=0;n<60*scale;n++)p.solver.advance(1/(30*scale),commands,p.environment);return p;});
  const reference=runs[3],errors=runs.slice(0,3).map(p=>({massL1:p.solver.climate.giant.mass.reduce((v,m,q)=>v+Math.abs(m-reference.solver.climate.giant.mass[q]),0)/stats(base).mass,temperatureMAE:p.solver.climate.giant.temperature.reduce((v,t,q)=>v+Math.abs(t-reference.solver.climate.giant.temperature[q]),0)/p.solver.climate.giant.temperature.length}));
  const names=['jupiter','saturn','mars','sandbox','custom'] as const;const renamed=names.map(name=>{const p=world(custom(),initial);p.environment.body!.preset=name;for(let n=0;n<30;n++)p.solver.advance(1/30,commands,p.environment);return JSON.stringify(p.solver.climate.snapshot());});
  const independent=renamed.every(s=>s===renamed[0]);receipt('timestep-and-name',{status:'measured',durationGameSeconds:2,scales,errors,independent,initialSnapshot:snapshot});
  expect(independent).toBe(true);expect(errors[0].temperatureMAE).toBeLessThan(.1);expect(errors[0].massL1).toBeLessThan(.005);if(errors[0].temperatureMAE>1e-4)expect(errors[2].temperatureMAE).toBeLessThan(errors[0].temperatureMAE);if(errors[0].massL1>2e-6)expect(errors[2].massL1).toBeLessThan(errors[0].massL1);
 });

 it('preserves parcel component totals and enthalpy over mixed temperatures and inventory scales',()=>{
  const rows=[];for(const scale of [1e-12,1,1e12])for(const temperature of [-249.9,-145,-77.7,-.1,0,.1,500,2499])for(const pressure of [50,1e3,1e7]){
   const mass=Float64Array.from(temperature>2000?[.9,.05,.03,0,0,.02,0,0]:[.9,.05,.01,.01,.01,.005,.005,.01],x=>x*scale),before=mass.slice(),h=parcelThermalEnergy(mass,0,temperature);let error:string|undefined,t=temperature;
   try{t=equilibrateCloudParcel(mass,0,temperature,pressure);}catch(e){error=String(e);}
   const total=(a:Float64Array,start:number,end:number)=>a.slice(start,end).reduce((v,m)=>v+m,0),residual=(parcelThermalEnergy(mass,0,t)-h)/Math.max(1,Math.abs(h)),speciesResidual=Math.max(Math.abs(total(mass,2,5)-total(before,2,5)),Math.abs(total(mass,5,8)-total(before,5,8)))/scale;
   rows.push({scale,temperature,pressure,t,error,residual,speciesResidual,minimum:Math.min(...mass),dryUnchanged:mass[0]===before[0]&&mass[1]===before[1]});
  }
  receipt('parcel-domain',{status:rows.every(r=>!r.error&&Math.abs(r.residual)<1e-10&&r.speciesResidual<1e-12&&r.minimum>=0&&r.dryUnchanged)?'passed':'failed',rows});
  for(const row of rows){expect(row.error,JSON.stringify(row)).toBeUndefined();expect(Math.abs(row.residual)).toBeLessThan(1e-10);expect(row.speciesResidual).toBeLessThan(1e-12);expect(row.minimum).toBeGreaterThanOrEqual(0);expect(row.dryUnchanged).toBe(true);}
 });

 it('keeps orbital illumination finite, normalized and exactly replayable at supported angular extremes',()=>{
  const rows=[];for(const tilt of [0,90,180])for(const phase of [0,Math.PI,2*Math.PI-1e-12]){const s=save(world());s.environment.orbitAngle=phase;s.spin!.tilt=tilt;s.spin!.angle=phase;const clone=JSON.parse(JSON.stringify(s));for(let n=0;n<1000;n++){advanceOrbit(s,1/30);advanceOrbit(clone,1/30);}const norm=Math.hypot(...s.environment.sun);rows.push({tilt,phase,norm,exact:JSON.stringify(s)===JSON.stringify(clone),angle:s.environment.orbitAngle,spin:s.spin!.angle});}
  receipt('orbit-extremes',{status:'measured',rows});for(const row of rows){expect(row.norm).toBeCloseTo(1,14);expect(row.exact).toBe(true);expect(row.angle).toBeGreaterThanOrEqual(0);expect(row.angle).toBeLessThan(2*Math.PI);}
  expect(localSun(0,0,0)).toEqual([1,0,0]);
 });
});
