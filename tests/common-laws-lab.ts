import {hydraulicScenario} from './helpers/hydraulicScenario';
import {terrainScenario,TERRAIN_MOUND} from './helpers/terrainScenario';
import {largeInventoryScenario,largeInventoryStocks} from './helpers/largeInventoryScenario';
import {oceanScenario} from './helpers/oceanScenario';
import {surfaceThermalScenario} from './helpers/surfaceThermalScenario';
import {coldMethaneScenario} from './helpers/coldMethaneScenario';
import {plumeScenario} from './helpers/plumeScenario';
import {elementalMass,ATOMIC_MASS,type Element} from '../src/sim/chemistry';
import {GASES} from '../src/sim/gases';
import {createSphere} from '../src/sim/sphere';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,seedPlanet,totalMass,totalEnthalpy,type Environment,type Solver,type Snapshot} from '../src/sim/model';
import {GpuSolver} from '../src/sim/gpu';
import {WorkerSolver} from '../src/sim/workerSolver';
import {createMarsPlanet,createJupiterPlanet} from '../src/sim/planetCreation';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import type {ClimateSnapshot} from '../src/sim/weatherClimate';

const grid=createSphere(1),out=document.querySelector<HTMLPreElement>('#results')!,results:Record<string,unknown>[]=[],empty=new Float32Array(grid.count*COMMAND_STRIDE);
const check=(ok:boolean,message:string)=>{if(!ok)throw new Error(message);};
function scenario(name:string):{state:Float32Array;environment:Environment;climate?:ClimateSnapshot}{
 if(name==='cold-initialization'||name.startsWith('save-domain-')){
  const state=seedPlanet(grid,'rock',name==='cold-initialization'?-272:20,'nitrogen');
  if(name.startsWith('save-domain-'))for(let i=0;i<grid.count;i++)state[i*STRIDE+F.rock]=100005.5;
  return {state,environment:{ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:name!=='save-domain-simple',body:sandboxDefinition('rock')}};
 }
 if(name.startsWith('large-inventory-'))return largeInventoryScenario(grid,name.endsWith('layered'));
 if(name.startsWith('terrain-'))return terrainScenario(grid,name.endsWith('layered'),name.includes('loaded'));
 if(name==='hydraulic'||name==='hydraulic-barrier')return hydraulicScenario(grid,name==='hydraulic-barrier');
 if(name==='ocean')return oceanScenario(grid);
 if(name.startsWith('surface-cold')||name.startsWith('surface-hot'))return surfaceThermalScenario(grid,name.startsWith('surface-cold')?-260:4000,name.endsWith('layered'));
 if(name==='cold-methane')return coldMethaneScenario(grid);
 if(name==='fire-plume'||name==='fire-neighbor')return plumeScenario(grid,name==='fire-plume'?'vertical':'lateral');
 if(name==='mars')return createMarsPlanet(grid);
 if(name==='giant')return createJupiterPlanet(grid);
 const temperature=name==='frozen'?-90:name==='kiln'?1800:name==='smoke'||name==='smoke-layered'?800:name==='pyrolysis'||name.startsWith('incomplete')?800:name==='thermal-reactions'||name==='oxygen-layered'?600:22,state=seedPlanet(grid,'rock',temperature,'nitrogen'),environment:Environment={ambient:Math.min(100,temperature),sunlight:0,sun:[1,0,0],gravity:name==='escape'?.03:1,climate:name==='layered'||name==='wet-reactions'||name==='oxygen-layered'||name==='incomplete-layered'||name==='smoke-layered'};
 for(let i=0;i<grid.count;i++){
  const p=i*STRIDE;state[p+F.temperature]+=grid.directions[i*3]*2;
  if(name==='kiln'){state[p+F.sand]=3;state[p+F.clay]=2;state[p+F.firing]=29.5;state[p+F.glass]=1;}
  else if(name==='frozen'){state[p+F.ice]=5;state[p+F.dissolved]=.1;}
  else if(name==='thermal-reactions'||name==='oxygen-layered'){state[p+F.soil]=2;state[p+F.plant]=1;state[p+F.methane]=.1;state[p+F.oxygen]=2;}
  else if(name==='charcoal-grains'){state[p+F.charcoal]=i===0?400:0;}
  else if(name==='smoke'||name==='smoke-layered'){state[p+F.soil]=.3;state[p+F.methane]=.03;state[p+F.oxygen]=.01;state[p+F.charcoal]=i===0?300:.1;state[p+F.soot]=i===0?.01:0;}
  else if(name==='pyrolysis'||name.startsWith('incomplete')){state[p+F.soil]=1;state[p+F.methane]=.1;state[p+F.oxygen]=name==='pyrolysis'?0:.01;}
  else if(name==='photosynthesis'){state[p+F.sand]=1;state[p+F.water]=.12;state[p+F.plant]=.001;state[p+F.carbonDioxide]=.03;environment.sunlight=1;}
  else if(name==='ecology'||name==='wet-reactions'){state[p+F.soil]=10;state[p+F.water]=.3;state[p+F.plant]=1;state[p+F.herbivore]=.1;state[p+F.carnivore]=.02;environment.sunlight=1;}
  else {state[p+F.water]=i%2?.3:3;state[p+F.sand]=i%3;state[p+F.vapor]=.001;}
 }
 environment.body=sandboxDefinition('rock',environment.gravity);
 return {state,environment};
}
function difference(a:Float32Array,b:Float32Array){let temperature=0,inventory=0;for(let i=0;i<a.length;i++){const error=Math.abs(a[i]-b[i]);if(i%STRIDE===F.temperature)temperature=Math.max(temperature,error);else inventory=Math.max(inventory,error/Math.max(1,Math.abs(a[i])));}return {temperature,inventory};}
function elements(s:Solver){return elementalMass(largeInventoryStocks(s));}
async function run():Promise<void>{
 for(const name of ['cold-initialization','save-domain-simple','save-domain-layered','large-inventory-simple','large-inventory-layered','terrain-simple','terrain-layered','terrain-loaded-simple','terrain-loaded-layered','hydraulic','hydraulic-barrier','ocean','surface-cold','surface-hot','surface-cold-layered','surface-hot-layered','mixed','frozen','kiln','ecology','photosynthesis','wet-reactions','thermal-reactions','oxygen-layered','pyrolysis','incomplete','incomplete-layered','charcoal-grains','smoke','smoke-layered','fire-plume','fire-neighbor','cold-methane','escape','layered','mars','giant'])for(const backend of ['Worker CPU','WebGPU','Worker WebGPU']){
  out.textContent=JSON.stringify({running:true,stage:'initialize',name,backend,results});
  const p=scenario(name),reference=new CpuSolver(grid,p.state.slice()),candidate:Solver|null=backend==='WebGPU'?await GpuSolver.create(grid,p.state.slice()):await WorkerSolver.create(grid,p.state.slice(),backend==='Worker CPU');
  check(!!candidate,`${backend} unavailable`);if(!candidate)continue;
  try{
   check(candidate.backend===(backend==='Worker CPU'?'CPU':'WebGPU'),`${backend} silently fell back`);
   reference.climate.restore(p.climate);candidate.climate.restore(p.climate);
   const mass=totalMass(candidate.state,candidate.climate),energy=totalEnthalpy(candidate.state,candidate.climate);let external=0,escaped=0,supplied=0,absoluteNumerical=0;const initialElements=elements(candidate),escapedStock=new Float64Array(STRIDE);
   // Include a paused command, which must not execute any reaction.
   const heat=empty.slice();heat[4]=2;if(name==='thermal-reactions'||name==='oxygen-layered')heat[11]=.01;reference.advance(0,heat,p.environment);await candidate.step(0,heat,p.environment);external+=candidate.energyChanges.reduce((a,b)=>a+b,0);absoluteNumerical+=candidate.energyChanges.reduce((a,b,k)=>a+(k%4===3?Math.abs(b):0),0);supplied+=heat[11];
   let maxTemperature=0,maxInventory=0;
   for(let n=0;n<60;n++){
    if(n%15===0)out.textContent=JSON.stringify({running:true,stage:'step',name,backend,step:n,results});
    const command=n===15?heat:n===30&&(name.startsWith('incomplete')||name.startsWith('smoke'))?empty.slice():empty;if(n===30&&(name.startsWith('incomplete')||name.startsWith('smoke')))for(let i=0;i<grid.count;i++)command[i*COMMAND_STRIDE+11]=.1;supplied+=Array.from({length:grid.count},(_,i)=>command[i*COMMAND_STRIDE+11]).reduce((a,b)=>a+b);reference.advance(1/30,command,p.environment);await candidate.step(1/30,command,p.environment);
    external+=candidate.energyChanges.reduce((a,b)=>a+b,0);escaped+=candidate.escapeCells.reduce((a,b)=>a+b,0);
    absoluteNumerical+=candidate.energyChanges.reduce((a,b,k)=>a+(k%4===3?Math.abs(b):0),0);
    for(let i=0;i<grid.count;i++)for(let k=0;k<GASES.length;k++)escapedStock[GASES[k].field]+=candidate.escapeCells[i*GASES.length+k];
    const d=difference(reference.state,candidate.state);maxTemperature=Math.max(maxTemperature,d.temperature);maxInventory=Math.max(maxInventory,d.inventory);
   }
   if(name.startsWith('hydraulic'))check(candidate.climate.ocean.kineticEnergy()>1e-12,'head difference produced no kinetic stock');
   if(name==='ocean'){check(candidate.climate.ocean.kineticEnergy()>0,'wind did not accelerate water');const a=reference.climate.ocean.momentum,b=candidate.climate.ocean.momentum;check(Math.max(...a.map((v,i)=>Math.abs(v-b[i])))<1e-5,'ocean momentum backend mismatch');}
   if(name==='photosynthesis')check(candidate.state.some((v,i)=>i%STRIDE===F.oxygen&&v>0),'photosynthesis produced no oxygen');
   if(name==='wet-reactions')check(candidate.state.some((v,i)=>i%STRIDE===F.methane&&v>0),'wet reaction produced no methane');
   if(name==='thermal-reactions'||name==='oxygen-layered')check(candidate.state.some((v,i)=>i%STRIDE===F.carbonDioxide&&v>.01),'thermal reaction produced no CO2');
   if(name==='pyrolysis'||name.startsWith('incomplete'))check(candidate.state.some((v,i)=>i%STRIDE===F.charcoal&&v>0),'pyrolysis produced no charcoal');
   if(name.startsWith('incomplete'))check(candidate.state.some((v,i)=>i%STRIDE===F.carbonMonoxide&&v>0),'incomplete combustion produced no CO');
   if(name==='fire-plume'||name==='fire-neighbor'){check(candidate.climate.air.updraft.some(w=>w>1),'no buoyant plume');check(candidate.climate.air.velocity.some(w=>Math.abs(w)>1e-3),'no induced wind');}
   if(name==='cold-methane')check(Math.min(...candidate.climate.air.temperature)<-150,'cold atmosphere never crossed legacy cutoff');
   if(name==='charcoal-grains')check(candidate.state[F.charcoal]<400,'charcoal did not flow');
   if(name.startsWith('terrain-'))check(name.includes('loaded')?candidate.state[F.sand]===TERRAIN_MOUND:candidate.state[F.sand]<TERRAIN_MOUND,'terrain mechanical work admission failed');
   if(name.startsWith('large-inventory-'))check(candidate.state[F.water]>.001,'large water inventory produced no transport into the dry cell');
   if(name.startsWith('smoke'))check(candidate.state.some((v,i)=>i%STRIDE===F.soot&&v>0),'missing smoke carbon');
   const massResidual=totalMass(candidate.state,candidate.climate)+escaped-mass-supplied,energyResidual=totalEnthalpy(candidate.state,candidate.climate)-energy-external;
   check(maxTemperature<.01&&maxInventory<1e-4,`${name}/${backend} trajectory mismatch ${maxTemperature}/${maxInventory}`);
   check(Math.abs(massResidual)<.002&&Math.abs(energyResidual)/Math.max(1,Math.abs(energy))<2e-5,`${name}/${backend} budget mismatch ${massResidual}/${energyResidual}`);
   const numericalRelative=absoluteNumerical/Math.max(1,Math.abs(energy));
   if(name.startsWith('large-inventory-'))check(Math.abs(energyResidual)/Math.max(1,Math.abs(energy))<2e-7&&numericalRelative<5e-4,`${name}/${backend} energy ledger or numerical residual exceeded the large-inventory limit`);
   const finalElements=elements(candidate),exported=elementalMass(escapedStock);
   const maxElementResidual=Math.max(...Object.keys(ATOMIC_MASS).map(key=>{const element=key as Element;return Math.abs(finalElements[element]+exported[element]-initialElements[element]-(element==='O'?supplied:0))/Math.max(1,initialElements[element]);}));
   check(maxElementResidual<2e-5,`${name}/${backend} elemental mismatch ${maxElementResidual}`);
   const snapshot:Snapshot={version:11,preset:'coast',state:[...candidate.state],environment:p.environment,climate:candidate.climate.snapshot(),time:2,supplied:0,removed:0,discoveries:[],...(name==='giant'?{}:{planet:{primary:name==='mars'?'sand':'rock'}})};
   check(validSnapshot(snapshot,grid.count),`${name}/${backend} invalid save`);
   const serialized=JSON.stringify(snapshot),loaded=JSON.parse(serialized) as Snapshot;check(validSnapshot(loaded,grid.count),`${name}/${backend} invalid JSON save`);
   const upgraded=upgradeSnapshot(loaded,grid.count);check(JSON.stringify(loaded)===serialized,`${name}/${backend} upgrade changed its input`);
   const resumed=new CpuSolver(grid,new Float32Array(upgraded.state));resumed.climate.restore(upgraded.climate);
   if(name.startsWith('large-inventory-')){
    check(resumed.climate.air.surfaceMassCarry.every((v,i)=>v===candidate.climate.air.surfaceMassCarry[i]),`${name}/${backend} lost saved local mass precision`);
    check(Math.abs(totalMass(resumed.state,resumed.climate)-totalMass(candidate.state,candidate.climate))<1e-8,`${name}/${backend} JSON changed canonical mass`);
    check(Math.abs(totalEnthalpy(resumed.state,resumed.climate)-totalEnthalpy(candidate.state,candidate.climate))<1e-7,`${name}/${backend} JSON changed canonical energy`);
   }
   resumed.advance(1/30,empty,p.environment);await candidate.step(1/30,empty,p.environment);const resume=difference(resumed.state,candidate.state);
   check(resume.temperature<.01&&resume.inventory<1e-4,`${name}/${backend} resume mismatch`);
   results.push({name,backend,passed:true,maxTemperature,maxInventory,massResidual,energyResidual,numericalRelative,maxElementResidual,resume});out.textContent=JSON.stringify({running:true,results},null,2);
  }finally{candidate.dispose();}
 }
 // A host-process exception after GPU readback must not publish a half step.
 const p=createMarsPlanet(grid),gpu=await GpuSolver.create(grid,p.state.slice());check(!!gpu,'WebGPU unavailable');
 if(gpu)try{
  await gpu.step(1/30,empty,p.environment);const before=gpu.state.slice(),climate=gpu.climate.snapshot(),original=gpu.climate.step.bind(gpu.climate);
  const reference=new CpuSolver(grid,before.slice());reference.climate.restore(climate);const command=empty.slice();command[4]=5;
  gpu.climate.step=(...args)=>{original(...args);throw new Error('injected host failure');};
  let rejected=false;try{await gpu.step(.1,command,p.environment);}catch{rejected=true;}
  check(rejected&&gpu.state.every((v,i)=>v===before[i])&&JSON.stringify(gpu.climate.snapshot())===JSON.stringify(climate),'GPU rollback changed committed state');
  gpu.climate.step=original;reference.advance(.1,command,p.environment);await gpu.step(.1,command,p.environment);
  const retry=difference(reference.state,gpu.state);check(retry.temperature<.01&&retry.inventory<1e-4,'GPU retry applied command twice');results.push({rollback:true,retry,passed:true});
 }finally{gpu?.dispose();}
 out.textContent=JSON.stringify({passed:true,results},null,2);
}
run().catch(error=>{out.textContent=JSON.stringify({passed:false,error:String(error),results},null,2);console.error(error);});
