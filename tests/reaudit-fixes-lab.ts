import {CpuSolver,F,STRIDE,MASS_FIELDS,COMMAND_STRIDE,totalMass,totalEnthalpy,capacity} from '../src/sim/model';
import {GpuSolver} from '../src/sim/gpu';
import {createSphere} from '../src/sim/sphere';
import {PHYSICS_DT} from '../src/sim/clock';
import {PHASE_ENERGY} from '../src/sim/thermodynamics';
import {validSnapshot,upgradeSnapshot,saveSnapshot,loadRecord} from '../src/sim/storage';
import {prepareSystemSave,validSystem,type SystemSave} from '../src/sim/system';
import {emptyStock} from '../src/sim/model';
import {freshProgress} from '../src/sim/progress';
async function verify(){
 const results=[];
 for(const kind of ['mixed cold','mixed hot','mixed ecology','weak gravity mixture','paused commands','complete freeze'] as const){
  const grid=createSphere(2),s=new Float32Array(grid.count*STRIDE),commands=new Float32Array(grid.count*COMMAND_STRIDE);
  for(let i=0;i<grid.count;i++){
   const p=i*STRIDE;s[p+F.rock]=8;s[p+F.nitrogen]=.3;s[p+F.temperature]=20;
   if(kind==='mixed cold'){s[p+F.temperature]=-20+40*(i%9)/8;s[p+F.water]=i%3===0?.8:3;s[p+F.ice]=i%3===0?4:.1;s[p+F.dissolved]=s[p+4]*.035;s[p+F.cloud]=.3;s[p+F.cloudIce]=.2;s[p+F.vapor]=.01;}
   if(kind==='mixed hot'){s[p+8]=850+1100*(i%7)/6;s[p+F.sand]=2;s[p+F.clay]=1;s[p+F.firing]=29.9;s[p+F.glass]=2;s[p+F.molten]=1;s[p+F.iron]=i%2?2:0;}
   if(kind==='mixed ecology'){s[p+8]=-20+120*(i%9)/8;s[p+F.soil]=3;s[p+F.plant]=2;s[p+F.herbivore]=.3;s[p+F.carnivore]=.1;s[p+F.water]=.05+.5*(i%3);s[p+F.cloud]=i%2?.2:0;}
   if(kind==='weak gravity mixture'){s[p+8]=-20+770*(i%11)/10;s[p+F.methane]=1;s[p+F.carbonDioxide]=.3;s[p+F.water]=i%3?.1:0;}
   if(kind==='complete freeze'){s[p+8]=-20;s[p+F.nitrogen]=0;s[p+F.water]=.8;s[p+F.ice]=4;}
   if(kind==='paused commands'){s[p+8]=-20;s[p+F.clay]=2;s[p+F.firing]=29.99;s[p+F.water]=.8;s[p+F.ice]=4;for(let k=0;k<20;k++)commands[i*20+k]=[4,5,6,7,11].includes(k)?0:(i%5+1)*.1;commands[i*20+4]=100;commands[i*20+5]=.01;commands[i*20+6]=.1;}
  }
  const cpu=new CpuSolver(grid,s.slice()),gpu=await GpuSolver.create(grid,s.slice());if(!gpu)return {supported:false};
  const env={ambient:20,sunlight:kind==='mixed ecology'?1:0,sun:[1,0,0],gravity:kind==='weak gravity mixture'?.01:1,rotationRate:.05},empty=new Float32Array(commands.length);
  let maxT=0,maxMass=0,cpuEnergy=0,gpuEnergy=0,cpuEscape=0,gpuEscape=0,cpuMin=0,gpuMin=0,maxTCase=0;
  const firstBranches:unknown[]=[];let peak:unknown=null;
  let maxTemperatureScaled=0,allStepsValid=true,saveResumeExact=true,switchedCpu:CpuSolver|undefined,switchedGpu:GpuSolver|undefined,maxSwitchTemperatureScaled=0,maxSwitchMass=0;
  const steps=kind==='paused commands'?1:300;
  for(let n=0;n<steps;n++){
   const dt=kind==='paused commands'?0:PHYSICS_DT;cpu.advance(dt,n===0?commands:empty,env);await gpu.step(dt,n===0?commands:empty,env);
   if(switchedCpu&&switchedGpu){switchedCpu.advance(dt,empty,env);await switchedGpu.step(dt,empty,env);for(let j=0;j<cpu.state.length;j++){const f=j%STRIDE;for(const [a,b] of [[switchedCpu.state[j],gpu.state[j]],[switchedGpu.state[j],cpu.state[j]]]){if(f===8)maxSwitchTemperatureScaled=Math.max(maxSwitchTemperatureScaled,Math.abs(a-b)/(.003+5e-5*Math.max(Math.abs(a),Math.abs(b))));else if(MASS_FIELDS.includes(f))maxSwitchMass=Math.max(maxSwitchMass,Math.abs(a-b)/Math.max(1,Math.abs(b)));}}}
   const persisted=(state:Float32Array)=>({version:3 as const,preset:'coast' as const,state:[...state],time:(n+1)*dt,discoveries:[],supplied:0,removed:0,environment:env});
   for(const state of [cpu.state,gpu.state,switchedCpu?.state,switchedGpu?.state].filter(Boolean) as Float32Array[])allStepsValid=allStepsValid&&validSnapshot(persisted(state),grid.count)&&state.every((v,j)=>!MASS_FIELDS.includes(j%STRIDE)||v>=0);
   if(n===149){const system:SystemSave={version:2,savedAt:0,activeId:'planet-cpu',stock:emptyStock(),progress:freshProgress(),planets:[{id:'planet-cpu',name:'CPU',snapshot:persisted(cpu.state)},{id:'planet-gpu',name:'GPU',snapshot:persisted(gpu.state)}]};const saved=JSON.parse(JSON.stringify(prepareSystemSave(system,grid.count)));saveResumeExact=validSystem(saved,grid.count)&&saved.planets.every((p:typeof system.planets[number],i:number)=>p.snapshot.state.every((v:number,j:number)=>v===[cpu.state,gpu.state][i][j]));switchedCpu=new CpuSolver(grid,new Float32Array(upgradeSnapshot(saved.planets[1].snapshot,grid.count).state));switchedGpu=(await GpuSolver.create(grid,new Float32Array(upgradeSnapshot(saved.planets[0].snapshot,grid.count).state)))!;}
   cpuEnergy+=cpu.energyChanges.reduce((a,b)=>a+b,0);gpuEnergy+=gpu.energyChanges.reduce((a,b)=>a+b,0);cpuEscape+=cpu.escapeCells.reduce((a,b)=>a+b,0);gpuEscape+=gpu.escapeCells.reduce((a,b)=>a+b,0);
   for(let i=0;i<grid.count;i++){const p=i*STRIDE,d=Math.abs(cpu.state[p+8]-gpu.state[p+8]);maxTemperatureScaled=Math.max(maxTemperatureScaled,d/(.003+5e-5*Math.max(Math.abs(cpu.state[p+8]),Math.abs(gpu.state[p+8]))));if(d>maxT){maxT=d;maxTCase=n+1;peak={step:n+1,cell:i,cpu:Array.from(cpu.state.slice(p,p+24)),gpu:Array.from(gpu.state.slice(p,p+24))};}if(firstBranches.length===0&&d>.01)firstBranches.push({step:n+1,cell:i,cpu:Array.from(cpu.state.slice(p,p+24)),gpu:Array.from(gpu.state.slice(p,p+24))});for(const f of MASS_FIELDS){maxMass=Math.max(maxMass,Math.abs(cpu.state[p+f]-gpu.state[p+f])/Math.max(1,cpu.state[p+f]));cpuMin=Math.min(cpuMin,cpu.state[p+f]);gpuMin=Math.min(gpuMin,gpu.state[p+f]);}}
  }
  let energyScale=0;for(let i=0;i<grid.count;i++){energyScale+=capacity(s,i)*Math.abs(s[i*STRIDE+8]);for(const f of MASS_FIELDS)energyScale+=Math.abs(s[i*STRIDE+f]*PHASE_ENERGY[f]);}
  const snap=(state:Float32Array)=>({version:3,preset:'coast',state:[...state],time:steps*PHYSICS_DT,discoveries:[],supplied:0,removed:0,environment:env});
  results.push({kind,allStepsValid,saveResumeExact,maxTemperatureScaled,maxSwitchTemperatureScaled,maxSwitchMass,cells:grid.count,steps,maxTemperatureDifference:maxT,maxTemperatureStep:maxTCase,maxMassRelativeDifference:maxMass,cpuMin,gpuMin,cpuFinite:cpu.state.every(Number.isFinite),gpuFinite:gpu.state.every(Number.isFinite),cpuEnergyResidualRelative:Math.abs(totalEnthalpy(cpu.state)-totalEnthalpy(s)-cpuEnergy)/Math.max(1,energyScale),gpuEnergyResidualRelative:Math.abs(totalEnthalpy(gpu.state)-totalEnthalpy(s)-gpuEnergy)/Math.max(1,energyScale),closedMassDifferenceRelative:Math.abs(totalMass(cpu.state)+cpuEscape-totalMass(gpu.state)-gpuEscape)/Math.max(1,totalMass(s)),cpuFinalSnapshotValid:validSnapshot(snap(cpu.state),grid.count),gpuFinalSnapshotValid:validSnapshot(snap(gpu.state),grid.count)});gpu.dispose();switchedGpu?.dispose();
  document.getElementById('result')!.textContent=JSON.stringify(results,null,2);
 }
 const tolerances={temperatureAbsolute:.003,temperatureRelative:5e-5,massCellScaled:1e-4,closedMassRelative:1e-6,energyScaleRelative:2e-5};
 const checked=results.map(r=>({...r,passed:r.allStepsValid&&r.saveResumeExact&&r.maxTemperatureScaled<=1&&r.maxSwitchTemperatureScaled<=1&&r.maxSwitchMass<=tolerances.massCellScaled&&r.maxMassRelativeDifference<=tolerances.massCellScaled&&r.closedMassDifferenceRelative<=tolerances.closedMassRelative&&r.cpuEnergyResidualRelative<=tolerances.energyScaleRelative&&r.gpuEnergyResidualRelative<=tolerances.energyScaleRelative&&r.cpuMin>=0&&r.gpuMin>=0&&r.cpuFinite&&r.gpuFinite&&r.cpuFinalSnapshotValid&&r.gpuFinalSnapshotValid}));
 return {supported:true,passed:checked.every(r=>r.passed),tolerances,results:checked};
}
async function seedResume(legacy=false){
 const grid=createSphere(4),state=new Float32Array(grid.count*STRIDE);
 for(let i=0;i<grid.count;i++){const p=i*STRIDE;state[p+F.temperature]=-20;state[p+F.water]=.8;state[p+F.ice]=4;}
 const cpu=new CpuSolver(grid,state),env={ambient:-20,sunlight:0,sun:[1,0,0],gravity:1};
 cpu.advance(PHYSICS_DT,new Float32Array(grid.count*COMMAND_STRIDE),env);
 if(legacy)for(let i=0;i<grid.count;i++){const p=i*STRIDE;cpu.state[p+F.water]=-1.7881393432617188e-7;cpu.state[p+F.ice]=4.800000190734863;cpu.state[p+F.dissolved]=cpu.state[p+F.water]*.36;cpu.state[p+F.salt]=.028-cpu.state[p+F.dissolved];}
 const snapshot={version:3 as const,preset:'winter' as const,state:[...cpu.state],time:123,discoveries:[],supplied:0,removed:0,environment:env,paused:true,spin:{angle:0,running:false},transferredIn:0};
 const stock=emptyStock();stock.glass=2;
 const system:SystemSave={version:2,savedAt:Date.now(),activeId:'planet-first',stock,progress:freshProgress(),planets:[{id:'planet-first',name:legacy?'Legacy recovery':'Cold resume',snapshot},{id:'planet-second',name:'Second destination',snapshot:structuredClone(snapshot)}]};
 const canonical=prepareSystemSave(system,grid.count);await saveSnapshot(legacy?system:canonical,'verification-system');
 localStorage.removeItem('sandsphere-system-resume-test');localStorage.removeItem('sandsphere-resume-test');
 const disk=await loadRecord('verification-system');
 return {legacy,valid:validSystem(disk,grid.count),cells:grid.count,expected:canonical};
}
async function seedSectionSwitch(){
 const {expected:system,cells}=await seedResume(false);
 system.planets[0].name='Rain source';system.planets[1].name='Dry destination';
 for(let planet=0;planet<2;planet++)for(let i=0;i<cells;i++){const s=system.planets[planet].snapshot.state,p=i*STRIDE;s[p+F.temperature]=20;s[p+F.rock]=8;s[p+F.water]=3;s[p+F.ice]=0;s[p+F.cloud]=planet===0?1:0;s[p+F.cloudIce]=0;s[p+F.vapor]=.01;}
 system.savedAt=Date.now();await saveSnapshot(prepareSystemSave(system,cells),'verification-system');return {cells,valid:true};
}
Object.assign(window,{reauditFixes:{verify,seedResume,seedSectionSwitch}});document.getElementById('run')!.onclick=async()=>{document.getElementById('result')!.textContent=JSON.stringify(await verify(),null,2);};
