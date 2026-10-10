import {CpuSolver,F,STRIDE,MASS_FIELDS,COMMAND_STRIDE,totalMass,totalEnthalpy,capacity} from '../src/sim/model';
import {GpuSolver} from '../src/sim/gpu';
import {createSphere} from '../src/sim/sphere';
import {PHYSICS_DT} from '../src/sim/clock';
import {PHASE_ENERGY} from '../src/sim/thermodynamics';
import {validSnapshot} from '../src/sim/storage';
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
  const steps=kind==='paused commands'?1:300;
  for(let n=0;n<steps;n++){
   const dt=kind==='paused commands'?0:PHYSICS_DT;cpu.advance(dt,n===0?commands:empty,env);await gpu.step(dt,n===0?commands:empty,env);
   cpuEnergy+=cpu.energyChanges.reduce((a,b)=>a+b,0);gpuEnergy+=gpu.energyChanges.reduce((a,b)=>a+b,0);cpuEscape+=cpu.escapeCells.reduce((a,b)=>a+b,0);gpuEscape+=gpu.escapeCells.reduce((a,b)=>a+b,0);
   for(let i=0;i<grid.count;i++){const p=i*STRIDE,d=Math.abs(cpu.state[p+8]-gpu.state[p+8]);if(d>maxT){maxT=d;maxTCase=n+1;peak={step:n+1,cell:i,cpu:Array.from(cpu.state.slice(p,p+24)),gpu:Array.from(gpu.state.slice(p,p+24))};}if(firstBranches.length===0&&d>.01)firstBranches.push({step:n+1,cell:i,cpu:Array.from(cpu.state.slice(p,p+24)),gpu:Array.from(gpu.state.slice(p,p+24))});for(const f of MASS_FIELDS){maxMass=Math.max(maxMass,Math.abs(cpu.state[p+f]-gpu.state[p+f])/Math.max(1,cpu.state[p+f]));cpuMin=Math.min(cpuMin,cpu.state[p+f]);gpuMin=Math.min(gpuMin,gpu.state[p+f]);}}
  }
  let energyScale=0;for(let i=0;i<grid.count;i++){energyScale+=capacity(s,i)*Math.abs(s[i*STRIDE+8]);for(const f of MASS_FIELDS)energyScale+=Math.abs(s[i*STRIDE+f]*PHASE_ENERGY[f]);}
  const snap=(state:Float32Array)=>({version:3,preset:'coast',state:[...state],time:steps*PHYSICS_DT,discoveries:[],supplied:0,removed:0,environment:env});
  results.push({kind,firstBranches,peak,cells:grid.count,steps,maxTemperatureDifference:maxT,maxTemperatureStep:maxTCase,maxMassRelativeDifference:maxMass,cpuMin,gpuMin,cpuFinite:cpu.state.every(Number.isFinite),gpuFinite:gpu.state.every(Number.isFinite),cpuEnergyResidualRelative:Math.abs(totalEnthalpy(cpu.state)-totalEnthalpy(s)-cpuEnergy)/Math.max(1,energyScale),gpuEnergyResidualRelative:Math.abs(totalEnthalpy(gpu.state)-totalEnthalpy(s)-gpuEnergy)/Math.max(1,energyScale),closedMassDifferenceRelative:Math.abs(totalMass(cpu.state)+cpuEscape-totalMass(gpu.state)-gpuEscape)/Math.max(1,totalMass(s)),cpuFinalSnapshotValid:validSnapshot(snap(cpu.state),grid.count),gpuFinalSnapshotValid:validSnapshot(snap(gpu.state),grid.count)});gpu.dispose();
  document.getElementById('result')!.textContent=JSON.stringify(results,null,2);
 }
 return {supported:true,results};
}
Object.assign(window,{reaudit:{verify}});document.getElementById('run')!.onclick=async()=>{document.getElementById('result')!.textContent=JSON.stringify(await verify(),null,2);};
