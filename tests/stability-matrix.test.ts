import {describe,it,expect} from 'vitest';
import {mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CpuSolver,F,STRIDE,MASS_FIELDS,COMMAND_STRIDE,totalEnthalpy,type Environment} from '../src/sim/model';
import {createSphere,type SphereGrid} from '../src/sim/sphere';
import {PHYSICS_DT} from '../src/sim/clock';
import {ATOMIC_MASS,elementalMass,type Element} from '../src/sim/chemistry';
import {MIN_THERMODYNAMIC_TEMPERATURE} from '../src/sim/thermodynamics';
import {GASES} from '../src/sim/gases';
import {AIR_FIELDS,AIR_SPECIES} from '../src/sim/layeredAtmosphere';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {STABILITY_KINDS,stabilityScenario,stabilityInventory,stabilitySnapshot,type StabilityKind} from './helpers/stabilityScenario';

const limits={mass:2e-5,elements:2e-5,ledger:2e-7,numerical:5e-4};
const elements=Object.keys(ATOMIC_MASS) as Element[];
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const sourceSha256=Object.fromEntries([
 ...readdirSync('src/sim').filter(path=>/\.(ts|wgsl)$/.test(path)).sort().map(path=>`src/sim/${path}`),
 'tests/stability-matrix.test.ts','tests/helpers/stabilityScenario.ts','tests/helpers/coldMethaneScenario.ts','tests/helpers/airInventory.ts',
].map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
function saveReport(name:string,value:Record<string,unknown>){
 const root='artifacts/stability-matrix',run=`${root}/${runId}`;mkdirSync(run,{recursive:true});
 const json=JSON.stringify({runId,recordedAt:new Date().toISOString(),sourceSha256,...value},null,2);
 writeFileSync(`${run}/${name}.json`,json);writeFileSync(`${root}/${name}.json`,json);
}
function load(grid:SphereGrid,p:ReturnType<typeof stabilityScenario>){const s=new CpuSolver(grid,p.state.slice());s.climate.restore(p.climate);return s;}
function stateChecks(s:CpuSolver){
 expect(s.state.every(Number.isFinite)).toBe(true);
 for(let p=0;p<s.state.length;p+=STRIDE){expect(s.state[p+F.temperature]).toBeGreaterThanOrEqual(Math.fround(MIN_THERMODYNAMIC_TEMPERATURE));for(const f of MASS_FIELDS)expect(s.state[p+f]).toBeGreaterThanOrEqual(0);}
 const a=s.climate.air;if(a.ready){expect(a.mass.every(v=>Number.isFinite(v)&&v>=0)).toBe(true);expect(a.temperature.every(v=>Number.isFinite(v)&&v>=MIN_THERMODYNAMIC_TEMPERATURE)).toBe(true);expect(a.velocity.every(Number.isFinite)).toBe(true);}
}
function experiment(grid:SphereGrid,p:ReturnType<typeof stabilityScenario>){
 let solver=load(grid,p),time=0,steps=0,restarts=0,shadow:CpuSolver|undefined;
 const empty=new Float32Array(grid.count*COMMAND_STRIDE),initial=stabilityInventory(solver),initialH=totalEnthalpy(solver.state,solver.climate),initialElements=elementalMass(initial),lost=new Float64Array(STRIDE);
 const energy=[0,0,0,0];let absolutePhysical=0,absoluteNumerical=0,minT=Infinity,maxT=-Infinity,maxWind=0,condensed=0,precipitated=0;
 function sample(){
  const stock=stabilityInventory(solver),withLost=stock.map((v,f)=>v+lost[f]),after=elementalMass(withLost),initialM=initial.reduce((a,b)=>a+b);
  const elementResiduals=Object.fromEntries(elements.map(e=>[e,{initial:initialElements[e],final:after[e],normalized:Math.abs(after[e]-initialElements[e])/Math.max(1,initialElements[e])}]));
  return {steps,time,cells:grid.count,restarts,minT,maxT,maxWind,condensed,precipitated,initialH,energy:[...energy],absolutePhysical,absoluteNumerical,roundoffToPhysical:absoluteNumerical/Math.max(1e-30,absolutePhysical),massRelative:Math.abs(withLost.reduce((a,b)=>a+b)-initialM)/Math.max(1,initialM),elementRelative:Math.max(...elements.map(e=>Math.abs(after[e]-initialElements[e])/Math.max(1,initialElements[e]))),elementResiduals,ledgerRelative:Math.abs(totalEnthalpy(solver.state,solver.climate)-initialH-energy.reduce((a,b)=>a+b))/Math.max(1,Math.abs(initialH)),numericalRelative:absoluteNumerical/Math.max(1,Math.abs(initialH)),meanSurfaceTemperature:solver.state.filter((_,i)=>i%STRIDE===F.temperature).reduce((a,b)=>a+b)/grid.count,initialStocks:[...initial],stocks:[...stock]};
 }
 function step(dt:number){
  solver.advance(dt,empty,p.environment);
  if(shadow){
   shadow.advance(dt,empty,p.environment);
   expect(solver.state).toEqual(shadow.state);expect(solver.climate.snapshot()).toEqual(shadow.climate.snapshot());
   expect(solver.energyChanges).toEqual(shadow.energyChanges);expect(solver.escapeCells).toEqual(shadow.escapeCells);
   expect(solver.condensedCells).toEqual(shadow.condensedCells);expect(solver.precipitatedCells).toEqual(shadow.precipitatedCells);
   solver=shadow;shadow=undefined;restarts++;
  }
  time+=dt;steps++;
  for(let k=0;k<solver.energyChanges.length;k++){const v=solver.energyChanges[k],channel=k%4;energy[channel]+=v;if(channel===3)absoluteNumerical+=Math.abs(v);else absolutePhysical+=Math.abs(v);}
  for(let i=0;i<grid.count;i++){
   const t=solver.state[i*STRIDE+F.temperature];minT=Math.min(minT,t);maxT=Math.max(maxT,t);
   for(let k=0;k<GASES.length;k++)lost[GASES[k].field]+=solver.escapeCells[i*GASES.length+k];
  }
  if(solver.climate.air.ready){for(const t of solver.climate.air.temperature){minT=Math.min(minT,t);maxT=Math.max(maxT,t);}for(let q=0;q<solver.climate.air.velocity.length;q+=3)maxWind=Math.max(maxWind,Math.hypot(...solver.climate.air.velocity.subarray(q,q+3)));}
  condensed+=solver.condensedCells.reduce((a,b)=>a+b,0);precipitated+=solver.precipitatedCells.reduce((a,b)=>a+b,0);
 }
 function restart(){
  const serialized=JSON.stringify(stabilitySnapshot(solver,p.environment,time));
  const saved=JSON.parse(serialized);expect(validSnapshot(saved,grid.count)).toBe(true);
  const upgraded=upgradeSnapshot(saved,grid.count);expect(JSON.stringify(saved)).toBe(serialized);
  shadow=new CpuSolver(grid,new Float32Array(upgraded.state));shadow.climate.restore(upgraded.climate);
  expect(shadow.state).toEqual(solver.state);expect(shadow.climate.snapshot()).toEqual(solver.climate.snapshot());
 }
 return {step,restart,sample,initial,get solver(){return solver;},environment:p.environment};
}
function budgetChecks(row:ReturnType<ReturnType<typeof experiment>['sample']>){expect(row.massRelative).toBeLessThan(limits.mass);expect(row.elementRelative).toBeLessThan(limits.elements);expect(row.ledgerRelative).toBeLessThan(limits.ledger);expect(row.numericalRelative).toBeLessThan(limits.numerical);}

describe('cross-condition stabilization matrix',()=>{
 it.each(STABILITY_KINDS)('runs 10,000 steps through repeated JSON replacement: %s',kind=>{
  const grid=createSphere(0),w=experiment(grid,stabilityScenario(grid,kind)),samples=[];
  try{
   for(let n=1;n<=10000;n++){
    w.step(PHYSICS_DT);
    if(n%1000===0){stateChecks(w.solver);const row=w.sample();samples.push(row);saveReport(kind,{status:'running',kind,limits,samples});budgetChecks(row);w.restart();}
   }
   const row=w.sample();expect(row.restarts).toBe(9);
   if(kind.endsWith('fire')){expect(row.stocks[F.methane]).toBeLessThan(w.initial[F.methane]*.99);expect(row.stocks[F.carbonDioxide]+row.stocks[F.carbonMonoxide]+row.stocks[F.charcoal]+row.stocks[F.soot]).toBeGreaterThan(.001);}
   else if(kind==='cold-methane'){expect(row.minT).toBeLessThan(-150);expect(row.maxWind).toBeGreaterThan(100);}
   else {expect(row.stocks[F.water]).not.toBe(w.initial[F.water]);expect(row.condensed+row.precipitated).toBeGreaterThan(0);}
   saveReport(kind,{status:'passed',kind,limits,samples});console.info('stability longrun',JSON.stringify({kind,...row}));
  }catch(error){saveReport(kind,{status:'failed',kind,limits,error:String(error),last:w.sample(),samples,snapshot:stabilitySnapshot(w.solver,w.environment,w.sample().time)});throw error;}
 },120000);

 it.each(['layered-water','cold-methane','layered-fire'] as StabilityKind[])('refines the actual coupled timestep: %s',kind=>{
  const grid=createSphere(0),p=stabilityScenario(grid,kind);
  // Oxygen-rich methane isolates smooth reaction integration from the separate
  // finite-oxygen/activation-boundary stress exercised by the longrun matrix.
  if(kind==='layered-fire'){
   for(let i=0;i<grid.count;i++){p.state[i*STRIDE+F.soil]=0;p.state[i*STRIDE+F.oxygen]=.4;}
   const base=new CpuSolver(grid,p.state);base.climate.restore(p.climate);
   const air=base.climate.air;for(let q=0;q<air.temperature.length;q++){air.temperature[q]=800;air.mass[q*AIR_SPECIES+AIR_FIELDS.indexOf(F.oxygen)]=air.mass[q*AIR_SPECIES+AIR_FIELDS.indexOf(F.methane)]*8;}
   air.attach(p.state);p.climate=base.climate.snapshot();
  }
  const scales=[1,2,4,8],runs=scales.map(scale=>{const w=experiment(grid,p);for(let n=0;n<60*scale;n++)w.step(PHYSICS_DT/scale);stateChecks(w.solver);budgetChecks(w.sample());return w;});
  const error=(a:typeof runs[number],b:typeof runs[number])=>({inventory:MASS_FIELDS.reduce((d,f)=>d+Math.abs(a.sample().stocks[f]-b.sample().stocks[f]),0)/Math.max(1,a.initial.reduce((x,y)=>x+y)),temperature:a.solver.state.filter((_,i)=>i%STRIDE===F.temperature).reduce((d,t,i)=>d+Math.abs(t-b.solver.state[i*STRIDE+F.temperature]),0)/grid.count,airTemperature:a.solver.climate.air.temperature.reduce((d,t,i)=>d+Math.abs(t-b.solver.climate.air.temperature[i]),0)/a.solver.climate.air.temperature.length});
  // The atmosphere already substeps at 1 physical second: 1/30 and 1/60
  // game second therefore share its internal step. Refine below that plateau.
  const coarse=error(runs[0],runs[3]),half=error(runs[1],runs[3]),fine=error(runs[2],runs[3]);saveReport(`timestep-${kind}`,{kind,duration:2,dt:scales.map(scale=>PHYSICS_DT/scale),coarse,half,fine,rows:runs.map(w=>w.sample())});
  expect(coarse.inventory).toBeLessThan(.005);expect(coarse.temperature).toBeLessThan(.1);expect(coarse.airTemperature).toBeLessThan(.1);
  if(coarse.inventory>2e-6)expect(fine.inventory).toBeLessThan(coarse.inventory);if(coarse.temperature>.0001)expect(fine.temperature).toBeLessThan(coarse.temperature);
  if(coarse.airTemperature>.0001)expect(fine.airTemperature).toBeLessThan(coarse.airTemperature);
  if(kind==='layered-fire')expect(runs[0].sample().stocks[F.methane]).toBeLessThan(runs[0].initial[F.methane]*.99);
  console.info('stability timestep',JSON.stringify({kind,coarse,fine}));
 });

 it.each([false,true])('keeps a smooth large-scale thermal mode consistent across grids (layered=%s)',layered=>{
  const rows=[1,2,3].map(level=>{
   const grid=createSphere(level),state=new Float32Array(grid.count*STRIDE),environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:layered,body:sandboxDefinition('rock',1)};
   for(let i=0;i<grid.count;i++){state[i*STRIDE+F.rock]=8;state[i*STRIDE+F.temperature]=20+10*grid.directions[i*3+1];state[i*STRIDE+F.nitrogen]=.3;}
   const base=new CpuSolver(grid,state);if(layered){base.climate.prepareSurface(state,environment);for(let i=0;i<grid.count;i++)for(let k=0;k<base.climate.air.temperature.length/grid.count;k++)base.climate.air.temperature[i*base.climate.air.temperature.length/grid.count+k]=20+10*grid.directions[i*3+1];base.climate.air.attach(state);}
   const w=experiment(grid,{state,environment,climate:layered?base.climate.snapshot():undefined});
   const mode=(s:Float32Array)=>{let sum=0;for(let i=0;i<grid.count;i++)sum+=(s[i*STRIDE+F.temperature]-20)*grid.directions[i*3+1];return sum/grid.count;};
   const initial=mode(state);for(let n=0;n<60;n++)w.step(PHYSICS_DT);stateChecks(w.solver);budgetChecks(w.sample());return {...w.sample(),modeRatio:mode(w.solver.state)/initial};
  });
  const spread=Math.max(...rows.map(r=>r.modeRatio))-Math.min(...rows.map(r=>r.modeRatio));saveReport(`grid-${layered?'layered':'simple'}`,{layered,rows,spread});expect(spread).toBeLessThan(.01);for(const r of rows)expect(r.modeRatio).toBeGreaterThan(0);console.info('stability grid',JSON.stringify({layered,spread,rows:rows.map(r=>({cells:r.cells,modeRatio:r.modeRatio,ledgerRelative:r.ledgerRelative}))}));
 },20000);

 it.each([
  {kind:'layered-water',gravity:.01,sunlight:0},{kind:'layered-water',gravity:3,sunlight:2.5},
  {kind:'cold-methane',gravity:.2,sunlight:0},{kind:'cold-methane',gravity:3,sunlight:2.5},
  {kind:'simple-fire',gravity:.01,sunlight:2.5},{kind:'layered-fire',gravity:3,sunlight:0},
 ] as {kind:StabilityKind;gravity:number;sunlight:number}[])('keeps bounded supported parameters: $kind, g=$gravity, sun=$sunlight',({kind,gravity,sunlight})=>{
  const grid=createSphere(1),p=stabilityScenario(grid,kind);p.environment={...p.environment,gravity,sunlight,body:sandboxDefinition('rock',gravity)};
  const w=experiment(grid,p);try{for(let n=0;n<120;n++)w.step(PHYSICS_DT);stateChecks(w.solver);const row=w.sample();saveReport(`parameters-${kind}-${gravity}-${sunlight}`,{status:'passed',kind,gravity,sunlight,...row});budgetChecks(row);w.restart();w.step(PHYSICS_DT);}catch(error){saveReport(`parameters-${kind}-${gravity}-${sunlight}`,{status:'failed',kind,gravity,sunlight,error:String(error),last:w.sample(),snapshot:stabilitySnapshot(w.solver,w.environment,w.sample().time)});throw error;}
 });
});
