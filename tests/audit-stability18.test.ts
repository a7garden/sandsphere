import {describe,it,expect} from 'vitest';
import {mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CpuSolver,F,STRIDE,MASS_FIELDS,COMMAND_STRIDE,totals,totalMass,totalEnthalpy,type Environment,type Snapshot} from '../src/sim/model';
import {createSphere,type SphereGrid} from '../src/sim/sphere';
import {ATOMIC_MASS,elementalMass,type Element} from '../src/sim/chemistry';
import {MIN_THERMODYNAMIC_TEMPERATURE} from '../src/sim/thermodynamics';
import {GASES} from '../src/sim/gases';
import {createDefinedPlanet} from '../src/sim/planetCreation';
import {JUPITER_DEFINITION,SATURN_DEFINITION,sandboxDefinition} from '../src/sim/planetDefinition';
import {DEEP_LAYERS} from '../src/sim/deepAtmosphere';
import {AIR_FIELDS,AIR_SPECIES,AIR_LAYERS} from '../src/sim/layeredAtmosphere';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';

// Bounded audit additions, with the matrix's existing limits fixed before the
// runs. These are production API probes, not observational climate validation.
const limits={mass:2e-5,elements:2e-5,ledger:2e-7,numerical:5e-4};
const elements=Object.keys(ATOMIC_MASS) as Element[];
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const sourceSha256=Object.fromEntries([
 ...readdirSync('src/sim').filter(p=>/\.(ts|wgsl)$/.test(p)).sort().map(p=>`src/sim/${p}`),
 'tests/audit-stability18.test.ts',
].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
function receipt(name:string,value:unknown){const root=`artifacts/stabilization-alpha18/stability/${runId}`;mkdirSync(root,{recursive:true});writeFileSync(`${root}/${name}.json`,JSON.stringify({runId,sourceSha256,limits,...value as object},null,2));}
type Input={state:Float32Array;environment:Environment;climate?:Snapshot['climate']};
function save(s:CpuSolver,e:Environment,time:number):Snapshot{return {version:11,preset:'coast',time,state:[...s.state],climate:s.climate.snapshot(),environment:structuredClone(e),...(!s.climate.giant.ready?{planet:{primary:'rock' as const}}:{}),supplied:0,removed:0,discoveries:[]};}
function load(grid:SphereGrid,p:Input){const s=new CpuSolver(grid,p.state.slice());s.climate.restore(p.climate);return s;}
function inventory(s:CpuSolver){const stock=totals(s.state,s.climate);for(let f=0;f<STRIDE;f++)if(!MASS_FIELDS.includes(f))stock[f]=0;return stock;}
function finite(s:CpuSolver){
 expect(s.state.every(Number.isFinite)).toBe(true);
 const actual=s.climate.physicalSurface(s.state);
 for(let p=0;p<actual.length;p+=STRIDE){expect(actual[p+F.temperature]).toBeGreaterThanOrEqual(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE));for(const f of MASS_FIELDS)expect(actual[p+f]).toBeGreaterThanOrEqual(0);}
 const cp=s.climate.checkpoint();
 function walk(v:unknown){if(typeof v==='number')expect(Number.isFinite(v)).toBe(true);else if(ArrayBuffer.isView(v))for(const n of v as unknown as Iterable<number>)expect(Number.isFinite(n)).toBe(true);else if(v&&typeof v==='object')for(const n of Object.values(v))walk(n);}
 walk(cp);
 if(s.climate.giant.ready){expect(s.climate.giant.mass.every(m=>m>=0)).toBe(true);expect(s.climate.giant.temperature.every(t=>t>=-250&&t<=2500)).toBe(true);}
 if(s.climate.air.ready)expect(s.climate.air.mass.every(m=>m>=0)).toBe(true);
}
function experiment(grid:SphereGrid,p:Input){
 let s=load(grid,p),steps=0,time=0,restarts=0;
 const initial=inventory(s),initialMass=totalMass(s.state,s.climate),initialH=totalEnthalpy(s.state,s.climate),initialElements=elementalMass(initial),lost=new Float64Array(STRIDE),channels=[0,0,0,0],empty=new Float32Array(grid.count*COMMAND_STRIDE);
 let numericalAbs=0,physicalAbs=0,minT=Infinity,maxT=-Infinity,maxWind=0;
 function row(){const current=inventory(s),withLost=current.map((m,f)=>m+lost[f]),em=elementalMass(withLost),h=totalEnthalpy(s.state,s.climate);return {steps,time,restarts,initialMass,initialH,finalH:h,channels:[...channels],numericalAbs,physicalAbs,numericalToPhysical:numericalAbs/Math.max(1e-30,physicalAbs),minT,maxT,maxWind,initial:[...initial],stocks:[...current],lost:[...lost],mass:Math.abs(withLost.reduce((a,b)=>a+b)-initialMass)/Math.max(1,initialMass),elements:Math.max(...elements.map(e=>Math.abs(em[e]-initialElements[e])/Math.max(1,initialElements[e]))),ledger:Math.abs(h-initialH-channels.reduce((a,b)=>a+b))/Math.max(1,Math.abs(initialH)),numerical:numericalAbs/Math.max(1,Math.abs(initialH))};}
 function step(dt:number,e=p.environment){s.advance(dt,empty,e);steps++;time+=dt;for(let k=0;k<s.energyChanges.length;k++){const c=k%4,q=s.energyChanges[k];channels[c]+=q;if(c===3)numericalAbs+=Math.abs(q);else physicalAbs+=Math.abs(q);}for(let i=0;i<grid.count;i++){for(let f=0;f<GASES.length;f++)lost[GASES[f].field]+=s.escapeCells[i*GASES.length+f];const t=s.state[i*STRIDE+F.temperature];minT=Math.min(minT,t);maxT=Math.max(maxT,t);}const a=s.climate.giant.ready?s.climate.giant:s.climate.air;if(a.ready){for(const t of a.temperature){minT=Math.min(minT,t);maxT=Math.max(maxT,t);}for(let q=0;q<a.velocity.length;q+=3)maxWind=Math.max(maxWind,Math.hypot(...a.velocity.subarray(q,q+3)));}}
 function restart(e=p.environment){const snap=JSON.parse(JSON.stringify(save(s,e,time)));expect(validSnapshot(snap,grid.count)).toBe(true);const upgraded=upgradeSnapshot(snap,grid.count),copy=new CpuSolver(grid,new Float32Array(upgraded.state));copy.climate.restore(upgraded.climate);s.advance(1/30,empty,e);copy.advance(1/30,empty,e);expect(copy.state).toEqual(s.state);expect(copy.climate.snapshot()).toEqual(s.climate.snapshot());expect(copy.energyChanges).toEqual(s.energyChanges);expect(copy.escapeCells).toEqual(s.escapeCells);s=copy;restarts++; // Count the comparison step through the same diagnostic path below.
  steps++;time+=1/30;for(let k=0;k<s.energyChanges.length;k++){const c=k%4,q=s.energyChanges[k];channels[c]+=q;if(c===3)numericalAbs+=Math.abs(q);else physicalAbs+=Math.abs(q);}for(let i=0;i<grid.count;i++)for(let f=0;f<GASES.length;f++)lost[GASES[f].field]+=s.escapeCells[i*GASES.length+f];}
 return {get s(){return s;},initial,row,step,restart};
}
function budgets(r:ReturnType<ReturnType<typeof experiment>['row']>){expect(r.mass).toBeLessThan(limits.mass);expect(r.elements).toBeLessThan(limits.elements);expect(r.ledger).toBeLessThan(limits.ledger);expect(r.numerical).toBeLessThan(limits.numerical);}

describe.skipIf(process.env.AUDIT_STABILITY18!=='1')('alpha18 regression: bounded cases outside the original stabilization matrix',()=>{
 it.each([4000,10000].flatMap(temperature=>(['cloud','soot','carbonDioxide'] as const).map(kind=>({temperature,kind}))))('advances a valid $temperature C thin ordinary-air snapshot without a radiative overdraft ($kind)',({temperature,kind})=>{
  const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE),environment:Environment={ambient:22,sunlight:0,sun:[1,0,0],gravity:1,climate:true,body:sandboxDefinition('rock')};
  for(let i=0;i<grid.count;i++){state[i*STRIDE+F.rock]=8;state[i*STRIDE+F.temperature]=22;state[i*STRIDE+F.nitrogen]=.00001;}
  const base=load(grid,{state,environment});base.climate.prepareSurface(base.state,environment);const air=base.climate.air;air.mass.fill(0);air.velocity.fill(0);air.temperature.fill(temperature);
  for(let q=0;q<grid.count*AIR_LAYERS;q++){air.mass[q*AIR_SPECIES+AIR_FIELDS.indexOf(F.nitrogen)]=1e-7;air.mass[q*AIR_SPECIES+AIR_FIELDS.indexOf(F[kind])]=1e-7;}air.attach(base.state);
  const initialSnapshot=save(base,environment,0),validInput=validSnapshot(JSON.parse(JSON.stringify(initialSnapshot)),grid.count);expect(validInput).toBe(true);
  const w=experiment(grid,{state:base.state.slice(),environment,climate:base.climate.snapshot()}),samples=[];
  try{for(let n=0;n<60;n++){w.step(1/30);finite(w.s);const r=w.row();samples.push(r);budgets(r);}const last=w.row();expect(last.channels[0]).toBeLessThanOrEqual(0);expect(last.finalH).toBeLessThan(last.initialH);receipt(`thin-hot-air-${temperature}-${kind}`,{status:'passed',validInput,temperature,kind,samples,last});}
  catch(error){receipt(`thin-hot-air-${temperature}-${kind}`,{status:'failed',validInput,temperature,kind,error:String(error),samples,last:w.row(),initialSnapshot,snapshot:save(w.s,environment,w.row().time)});throw error;}
 });

 it.each([false,true])('runs moist deep columns for 3000 steps with repeated exact restart (saturn=%s)',saturn=>{
  const grid=createSphere(0),p=createDefinedPlanet(grid,saturn?SATURN_DEFINITION:JUPITER_DEFINITION),w=experiment(grid,p),samples=[];
  try{for(let n=1;n<=3000;n++){w.step(1/30);if(n%500===0){finite(w.s);const r=w.row();samples.push(r);budgets(r);if(n<3000)w.restart();}}const last=w.row();expect(last.restarts).toBe(5);expect(last.maxWind).toBeGreaterThan(1);expect(last.stocks[F.ammoniaCloud]+last.stocks[F.ammoniaIce]+last.stocks[F.cloud]+last.stocks[F.cloudIce]).toBeGreaterThan(0);receipt(`deep-moist-${saturn?'saturn':'jupiter'}`,{status:'passed',saturn,samples,last});}
  catch(error){receipt(`deep-moist-${saturn?'saturn':'jupiter'}`,{status:'failed',saturn,error:String(error),samples,last:w.row(),snapshot:save(w.s,p.environment,w.row().time)});throw error;}
 },120000);

 it.each([false,true])('keeps mixed reaction and phase inventories bounded under supported boundary edits (layered=%s)',layered=>{
  const grid=createSphere(0),state=new Float32Array(grid.count*STRIDE);
  for(let i=0;i<grid.count;i++){const p=i*STRIDE;state[p+F.temperature]=[-100,22,1500,4000][i%4];for(const [f,m] of [[F.rock,8],[F.sand,.4],[F.clay,.3],[F.glass,.2],[F.ceramic,.1],[F.molten,.05],[F.iron,.3],[F.water,.5],[F.ice,.1],[F.salt,.1],[F.dissolved,.02],[F.nitrogen,.3],[F.oxygen,.2],[F.methane,.02],[F.soil,.3],[F.plant,.03],[F.herbivore,.002],[F.carnivore,.001],[F.charcoal,.01],[F.soot,.001],[F.carbonMonoxide,.002],[F.carbonDioxide,.01]] as const)state[p+f]=m;}
  const environment:Environment={ambient:22,sunlight:.7,sun:[1,0,0],gravity:1,climate:layered,body:sandboxDefinition('rock')},w=experiment(grid,{state,environment}),samples=[];
  let e=environment;
  try{for(let n=1;n<=3000;n++){const phase=Math.floor((n-1)/250)%4,g=[.01,3,.2,1][phase];e={...environment,ambient:[-100,100,22,0][phase],sunlight:[0,2.5,.7,0][phase],gravity:g,rotationRate:[0,Math.PI/10,-Math.PI/10,.05][phase],body:sandboxDefinition('rock',g)};w.step(1/30,e);if(n%250===0){finite(w.s);const r=w.row();samples.push(r);budgets(r);if(n%500===0&&n<3000)w.restart(e);}}const last=w.row();expect(last.stocks[F.methane]).toBeLessThan(w.initial[F.methane]);receipt(`mixed-boundary-${layered?'layered':'simple'}`,{status:'passed',layered,samples,last});}
  catch(error){receipt(`mixed-boundary-${layered?'layered':'simple'}`,{status:'failed',layered,error:String(error),samples,last:w.row(),snapshot:save(w.s,e,w.row().time)});throw error;}
 },120000);

 it('refines the actual moist deep integration interval',()=>{
  const grid=createSphere(0),p=createDefinedPlanet(grid,JUPITER_DEFINITION),scales=[1,2,4,8],runs=scales.map(k=>{const w=experiment(grid,p);for(let n=0;n<120*k;n++)w.step(1/(30*k));finite(w.s);budgets(w.row());return w;});
  const error=(a:typeof runs[number],b:typeof runs[number])=>({inventory:MASS_FIELDS.reduce((d,f)=>d+Math.abs(a.row().stocks[f]-b.row().stocks[f]),0)/Math.max(1,a.row().initialMass),temperature:a.s.climate.giant.temperature.reduce((d,t,q)=>d+Math.abs(t-b.s.climate.giant.temperature[q]),0)/a.s.climate.giant.temperature.length});
  const coarse=error(runs[0],runs[3]),half=error(runs[1],runs[3]),fine=error(runs[2],runs[3]),result={duration:4,dt:scales.map(k=>1/(30*k)),coarse,half,fine,rows:runs.map(w=>w.row())};
  receipt('deep-moist-timestep',{status:'measured',...result});expect(coarse.inventory).toBeLessThan(.005);expect(coarse.temperature).toBeLessThan(.1);if(coarse.inventory>2e-6)expect(fine.inventory).toBeLessThan(coarse.inventory);if(coarse.temperature>.0001)expect(fine.temperature).toBeLessThan(coarse.temperature);receipt('deep-moist-timestep',{status:'passed',...result});
 },120000);

 it('keeps a smooth deep thermal mode consistent across 12/42/162 cells',()=>{
  const rows=[0,1,2].map(level=>{const grid=createSphere(level),p=createDefinedPlanet(grid,JUPITER_DEFINITION,{referenceTemperatureKelvin:165,minimumTemperatureKelvin:110,jetSpeed:0,temperaturePerturbation:0,cloudBands:false}),base=load(grid,p),g=base.climate.giant;
   const reference=g.temperature.slice();for(let i=0;i<grid.count;i++)for(let k=0;k<DEEP_LAYERS;k++)g.temperature[i*DEEP_LAYERS+k]+=2*grid.directions[i*3];g.sync(base.state);
   const mode=(s:CpuSolver)=>{let a=0,b=0;for(let i=0;i<grid.count;i++)for(let k=0;k<DEEP_LAYERS;k++){const q=i*DEEP_LAYERS+k,x=grid.directions[i*3];a+=(s.climate.giant.temperature[q]-reference[q])*x;b+=2*x*x;}return a/b;};
   const initial=mode(base),w=experiment(grid,{...p,state:base.state.slice(),climate:base.climate.snapshot()});for(let n=0;n<120;n++)w.step(1/30);finite(w.s);budgets(w.row());return {...w.row(),cells:grid.count,modeRatio:mode(w.s)/initial};});
  const spread=Math.max(...rows.map(r=>r.modeRatio))-Math.min(...rows.map(r=>r.modeRatio));receipt('deep-grid-mode',{status:'measured',rows,spread,scope:'large-scale mode consistency only; not general spatial convergence'});expect(spread).toBeLessThan(.01);for(const r of rows)expect(r.modeRatio).toBeGreaterThan(0);receipt('deep-grid-mode',{status:'passed',rows,spread,scope:'large-scale mode consistency only; not general spatial convergence'});
 },120000);
});
