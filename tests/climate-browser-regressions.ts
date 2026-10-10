import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,seedPlanet,totalMass,totalEnthalpy} from '../src/sim/model';
import {GpuSolver} from '../src/sim/gpu';
import {validSnapshot,saveSnapshot,loadRecord} from '../src/sim/storage';
import {CLIMATE_LAYERS} from '../src/sim/weatherClimate';
import type {PlanetView} from '../src/render/planet';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {ShaderLanguage} from '@babylonjs/core/Materials/shaderLanguage';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
const emptyEnv={ambient:18,sunlight:1,sun:[1,0,0],gravity:1,rotationRate:.06,climate:true};
export async function verifyClimateGpu(){
 const grid=createSphere(2),initial=seedPlanet(grid,'sand',22),empty=new Float32Array(grid.count*COMMAND_STRIDE);
 for(let i=0;i<grid.count;i++){const p=i*STRIDE,x=grid.directions[i*3];initial[p+F.water]=x>0?.3:3;initial[p+F.carbonDioxide]=.01;initial[p+F.seed]=.08;initial[p+F.cloud]=x>.7?.2:0;initial[p+F.temperature]=20+15*x;if(i%7===0)initial[p+F.plant]=.005;}
 // Include unsuitable mineral foundations: root conditions must match WGSL too.
 for(let i=0;i<grid.count;i+=13){const p=i*STRIDE;initial[p+F.sand]=0;initial[p+F.clay]=0;initial[p+F.rock]=8;initial[p+F.plant]=.1;}
 const cpu=new CpuSolver(grid,initial.slice()),gpu=await GpuSolver.create(grid,initial.slice());if(!gpu)return {supported:false};cpu.climate.seedLife();gpu.climate.seedLife();
 let resumeCpu:CpuSolver|undefined,resumeGpu:GpuSolver|undefined,maxT=0,maxMass=0,maxWind=0,maxSwitchT=0,cpuEnergy=0,gpuEnergy=0,cpuEscape=0,gpuEscape=0,saveExact=false;
 try{
  for(let step=0;step<180;step++){
   cpu.advance(1/30,empty,emptyEnv);await gpu.step(1/30,empty,emptyEnv);
   if(resumeCpu&&resumeGpu){resumeCpu.advance(1/30,empty,emptyEnv);await resumeGpu.step(1/30,empty,emptyEnv);for(let i=0;i<initial.length;i++)if(i%STRIDE===F.temperature)maxSwitchT=Math.max(maxSwitchT,Math.abs(resumeCpu.state[i]-gpu.state[i]),Math.abs(resumeGpu.state[i]-cpu.state[i]));}
   cpuEnergy+=cpu.energyChanges.reduce((a,b)=>a+b,0);gpuEnergy+=gpu.energyChanges.reduce((a,b)=>a+b,0);cpuEscape+=cpu.escapeCells.reduce((a,b)=>a+b,0);gpuEscape+=gpu.escapeCells.reduce((a,b)=>a+b,0);
   for(let i=0;i<initial.length;i++){const d=Math.abs(cpu.state[i]-gpu.state[i]);if(i%STRIDE===F.temperature)maxT=Math.max(maxT,d);else maxMass=Math.max(maxMass,d/Math.max(1,Math.abs(cpu.state[i])));}
   for(let i=0;i<cpu.climate.wind.length;i++)maxWind=Math.max(maxWind,Math.abs(cpu.climate.wind[i]-gpu.climate.wind[i]));
   if(step===89){const saved={version:4 as const,preset:'coast' as const,time:3,state:[...gpu.state],climate:gpu.climate.snapshot(),environment:emptyEnv,discoveries:[],supplied:0,removed:0};await saveSnapshot(saved,'climate-regression-only');const loaded=await loadRecord('climate-regression-only');saveExact=validSnapshot(loaded,grid.count)&&JSON.stringify(loaded)===JSON.stringify(saved);resumeCpu=new CpuSolver(grid,new Float32Array(saved.state));resumeCpu.climate.restore(saved.climate);resumeGpu=(await GpuSolver.create(grid,cpu.state.slice()))!;resumeGpu.climate.restore(cpu.climate.snapshot());}
  }
  const energyResidualCpu=totalEnthalpy(cpu.state)-totalEnthalpy(initial)-cpuEnergy,energyResidualGpu=totalEnthalpy(gpu.state)-totalEnthalpy(initial)-gpuEnergy,massResidualCpu=totalMass(cpu.state)+cpuEscape-totalMass(initial),massResidualGpu=totalMass(gpu.state)+gpuEscape-totalMass(initial);
  const energyScale=Math.max(1,Math.abs(totalEnthalpy(initial))),result={energyResidualCpuRelative:Math.abs(energyResidualCpu)/energyScale,energyResidualGpuRelative:Math.abs(energyResidualGpu)/energyScale,supported:true,steps:180,cells:grid.count,maxT,maxMass,maxWind,maxSwitchT,saveExact,energyResidualCpu,energyResidualGpu,massResidualCpu,massResidualGpu,seeds:gpu.climate.seeds.filter(v=>v>.001).length,cloudMoved:gpu.state[F.cloud]!==initial[F.cloud],finite:gpu.state.every(Number.isFinite),nonnegative:gpu.state.every((v,i)=>i%STRIDE===F.temperature||v>=0)};
  return {...result,passed:saveExact&&result.finite&&result.nonnegative&&maxT<.003&&maxSwitchT<.003&&maxMass<1e-4&&maxWind<1e-5&&result.energyResidualCpuRelative<2e-5&&result.energyResidualGpuRelative<2e-5&&Math.abs(massResidualCpu)<.005&&Math.abs(massResidualGpu)<.005};
 }finally{gpu.dispose();resumeGpu?.dispose();}
}
export async function verifyClimateLayers(view:PlanetView,state:()=>Float32Array){
 const before=state(),grid=(view as unknown as {grid:ReturnType<typeof createSphere>}).grid,cpu=new CpuSolver(grid,before.slice());cpu.climate.seedLife();cpu.advance(1/30,new Float32Array(grid.count*COMMAND_STRIDE),emptyEnv);const canvas=view.engine.getRenderingCanvas(),results=[];
 for(const section of [false,true]){view.setSection(section,0);for(let i=0;i<45;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));
  for(const layer of Object.keys(CLIMATE_LAYERS) as (keyof typeof CLIMATE_LAYERS)[]){view.setClimate(layer,cpu.climate);view.update(before,0,emptyEnv);for(let frame=0;frame<120;frame++){await new Promise<void>(r=>requestAnimationFrame(()=>r()));if(view.scene.isReady())break;}const map=view.scene.getMeshByName('climate cell map')!,colors=map.getVerticesData('color')??[],cap=view.scene.getMeshByName('live material cross section')!.getVerticesData('climateColor')??[];
   results.push({section,layer,ready:view.scene.isReady(),enabled:map.isEnabled(),finite:colors.every(Number.isFinite)&&cap.every(Number.isFinite),capColored:!section||layer==='none'||cap.some((v,i)=>i%4===3&&v>0),arrows:view.visualStats().climate.arrows});
  }
 }
 view.setClimate('temperature',cpu.climate);
 const root=(view as unknown as {root:TransformNode}).root,shaderCompatible=view.scene.meshes.filter(m=>m.isDescendantOf(root)&&m.material instanceof StandardMaterial).every(m=>m.material!.shaderLanguage===ShaderLanguage.GLSL);
 return {passed:shaderCompatible&&before.every((v,i)=>v===state()[i])&&canvas===view.engine.getRenderingCanvas()&&results.every(r=>r.ready&&r.enabled===(r.layer!=='none')&&r.finite&&r.capColored),shaderCompatible,stateUnchanged:before.every((v,i)=>v===state()[i]),sameCanvas:canvas===view.engine.getRenderingCanvas(),results};
}
