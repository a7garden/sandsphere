import {CpuSolver,F,STRIDE,COMMAND_STRIDE,totalMass,totalEnthalpy,type Snapshot} from '../src/sim/model';
import {GpuSolver} from '../src/sim/gpu';
import {createSphere} from '../src/sim/sphere';
import {advanceOrbit} from '../src/sim/system';
import {PHYSICS_DT} from '../src/sim/clock';
import {saveSnapshot,loadRecord,validSnapshot,upgradeSnapshot} from '../src/sim/storage';

export async function verifyEvolvedGpu(saved:Snapshot){
 const grid=createSphere(2),cpu=new CpuSolver(grid,new Float32Array(saved.state)),gpu=await GpuSolver.create(grid,new Float32Array(saved.state));
 if(!gpu)return {supported:false,passed:false};cpu.climate.restore(saved.climate);gpu.climate.restore(saved.climate);
 const orbit=structuredClone(saved),empty=new Float32Array(grid.count*COMMAND_STRIDE),mass=totalMass(cpu.state),h=totalEnthalpy(cpu.state);
 let switchCpu:CpuSolver|undefined,switchGpu:GpuSolver|undefined,maxT=0,maxMatter=0,maxWind=0,maxCurrent=0,maxSwitchT=0,saveExact=false,restored:Snapshot|undefined,qCpu=0,qGpu=0,escCpu=0,escGpu=0;
 try{
  for(let k=0;k<900;k++){
   advanceOrbit(orbit,PHYSICS_DT);cpu.advance(PHYSICS_DT,empty,orbit.environment);await gpu.step(PHYSICS_DT,empty,orbit.environment);
   qCpu+=cpu.energyChanges.reduce((a,b)=>a+b,0);qGpu+=gpu.energyChanges.reduce((a,b)=>a+b,0);escCpu+=cpu.escapeCells.reduce((a,b)=>a+b,0);escGpu+=gpu.escapeCells.reduce((a,b)=>a+b,0);
   if(switchCpu&&switchGpu){switchCpu.advance(PHYSICS_DT,empty,orbit.environment);await switchGpu.step(PHYSICS_DT,empty,orbit.environment);for(let i=F.temperature;i<cpu.state.length;i+=STRIDE)maxSwitchT=Math.max(maxSwitchT,Math.abs(switchCpu.state[i]-gpu.state[i]),Math.abs(switchGpu.state[i]-cpu.state[i]));}
   for(let i=0;i<cpu.state.length;i++){const diff=Math.abs(cpu.state[i]-gpu.state[i]);if(i%STRIDE===F.temperature)maxT=Math.max(maxT,diff);else maxMatter=Math.max(maxMatter,diff/Math.max(1,cpu.state[i]));}
   for(let i=0;i<cpu.climate.wind.length;i++){maxWind=Math.max(maxWind,Math.abs(cpu.climate.wind[i]-gpu.climate.wind[i]));maxCurrent=Math.max(maxCurrent,Math.abs(cpu.climate.currents[i]-gpu.climate.currents[i]));}
   if(k===449){const snapshot:Snapshot={...structuredClone(orbit),state:[...gpu.state],climate:gpu.climate.snapshot()};await saveSnapshot(snapshot,'long-climate-audit-only');const raw=await loadRecord('long-climate-audit-only');saveExact=JSON.stringify(raw)===JSON.stringify(snapshot)&&validSnapshot(raw,grid.count);if(!saveExact)throw new Error('장시간 기후 저장 왕복 불일치');restored=upgradeSnapshot(raw as Snapshot,grid.count);switchCpu=new CpuSolver(grid,new Float32Array(restored.state));switchCpu.climate.restore(restored.climate);switchGpu=(await GpuSolver.create(grid,cpu.state.slice()))!;switchGpu.climate.restore(cpu.climate.snapshot());}
  }
  const result={supported:true,evolvedSeconds:saved.time,continuedSeconds:30,cells:grid.count,steps:900,maxT,maxMatter,maxWind,maxCurrent,maxSwitchT,saveExact,massResidualCpu:totalMass(cpu.state)+escCpu-mass,massResidualGpu:totalMass(gpu.state)+escGpu-mass,energyResidualCpu:totalEnthalpy(cpu.state)-h-qCpu,energyResidualGpu:totalEnthalpy(gpu.state)-h-qGpu,finite:gpu.state.every(Number.isFinite),nonnegative:gpu.state.every((v,i)=>i%STRIDE===F.temperature||v>=0)};
  return {...result,passed:result.finite&&result.nonnegative&&saveExact&&maxT<.01&&maxSwitchT<.01&&maxMatter<1e-3&&maxWind<1e-5&&maxCurrent<1e-5&&Math.abs(result.massResidualCpu)<.01&&Math.abs(result.massResidualGpu)<.01};
 }finally{gpu.dispose();switchGpu?.dispose();}
}
