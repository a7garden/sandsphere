import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,seedPlanet,totalMass,totalEnthalpy,type Environment} from '../src/sim/model';
import {GpuSolver} from '../src/sim/gpu';
import {validSnapshot,saveSnapshot,loadRecord} from '../src/sim/storage';
import {CLIMATE_LAYERS,climateColor,type WeatherClimate} from '../src/sim/weatherClimate';
import type {PlanetView} from '../src/render/planet';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {ShaderLanguage} from '@babylonjs/core/Materials/shaderLanguage';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {CLOUD_VISIBLE_MASS,COLUMN_KG} from '../src/sim/layeredAtmosphere';
const emptyEnv={ambient:18,sunlight:1,sun:[1,0,0],gravity:1,rotationRate:.06,climate:true};
export async function verifyClimateClouds(view:PlanetView,grid:ReturnType<typeof createSphere>){
 const s=seedPlanet(grid,'sand',22),empty=new Float32Array(grid.count*COMMAND_STRIDE);
 for(let i=0;i<grid.count;i++){const p=i*STRIDE,[,y,z]=grid.directions.subarray(i*3,i*3+3),wet=Math.max(0,Math.sin(4*y)*Math.cos(3*z));s[p+F.vapor]=.00005+.0008*wet*wet;if(z>0)s[p+F.water]=3;}
 const cpu=new CpuSolver(grid,s),start=performance.now();for(let k=0;k<30;k++)cpu.advance(1/30,empty,emptyEnv);
 const groups={land:0,water:0,day:0,night:0};let cloud=0;
 for(let i=0;i<grid.count;i++){const p=i*STRIDE,m=cpu.state[p+F.cloud]+cpu.state[p+F.cloudIce];cloud+=m;if(m>CLOUD_VISIBLE_MASS){groups[grid.directions[i*3+2]>0?'water':'land']++;groups[grid.directions[i*3]>0?'day':'night']++;}}
 const elapsedMs=performance.now()-start;view.setClimate('none',cpu.climate);view.update(cpu.state,0,emptyEnv);view.animate(1);for(let k=0;k<30;k++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const visual=view.visualStats(),display=visual;
 return {cells:grid.count,steps:30,elapsedMs,groups,cloudInventory:cloud,meanWaterPath:cloud*COLUMN_KG/grid.count,visual,passed:Object.values(groups).every(v=>v>0)&&display.cloudDraws>0&&Math.abs(display.cloudRenderedMass-cloud)<1e-8};
}
export async function verifyClimateGpu(){
 const grid=createSphere(2),initial=seedPlanet(grid,'sand',22),empty=new Float32Array(grid.count*COMMAND_STRIDE);
 for(let i=0;i<grid.count;i++){const p=i*STRIDE,x=grid.directions[i*3];initial[p+F.water]=x>0?.3:3;initial[p+F.carbonDioxide]=.01;initial[p+F.seed]=.08;initial[p+F.cloud]=x>.7?.2:0;initial[p+F.temperature]=20+15*x;if(i%7===0)initial[p+F.plant]=.005;}
 // Include unsuitable mineral foundations: root conditions must match WGSL too.
 for(let i=0;i<grid.count;i+=13){const p=i*STRIDE;initial[p+F.sand]=0;initial[p+F.clay]=0;initial[p+F.rock]=8;initial[p+F.plant]=.1;}
 const cpu=new CpuSolver(grid,initial.slice()),gpu=await GpuSolver.create(grid,initial.slice());if(!gpu)return {supported:false};cpu.climate.seedLife();gpu.climate.seedLife();
 let resumeCpu:CpuSolver|undefined,resumeGpu:GpuSolver|undefined,maxT=0,maxMass=0,maxWind=0,maxSwitchT=0,maxAirT=0,maxAirMass=0,maxMomentum=0,cpuEnergy=0,gpuEnergy=0,cpuEscape=0,gpuEscape=0,saveExact=false;
 try{
  for(let step=0;step<180;step++){
   cpu.advance(1/30,empty,emptyEnv);await gpu.step(1/30,empty,emptyEnv);
   if(resumeCpu&&resumeGpu){resumeCpu.advance(1/30,empty,emptyEnv);await resumeGpu.step(1/30,empty,emptyEnv);for(let i=0;i<initial.length;i++)if(i%STRIDE===F.temperature)maxSwitchT=Math.max(maxSwitchT,Math.abs(resumeCpu.state[i]-gpu.state[i]),Math.abs(resumeGpu.state[i]-cpu.state[i]));}
   cpuEnergy+=cpu.energyChanges.reduce((a,b)=>a+b,0);gpuEnergy+=gpu.energyChanges.reduce((a,b)=>a+b,0);cpuEscape+=cpu.escapeCells.reduce((a,b)=>a+b,0);gpuEscape+=gpu.escapeCells.reduce((a,b)=>a+b,0);
   for(let i=0;i<initial.length;i++){const d=Math.abs(cpu.state[i]-gpu.state[i]);if(i%STRIDE===F.temperature)maxT=Math.max(maxT,d);else maxMass=Math.max(maxMass,d/Math.max(1,Math.abs(cpu.state[i])));}
   for(let i=0;i<cpu.climate.wind.length;i++)maxWind=Math.max(maxWind,Math.abs(cpu.climate.wind[i]-gpu.climate.wind[i]));
   for(let i=0;i<cpu.climate.air.temperature.length;i++)maxAirT=Math.max(maxAirT,Math.abs(cpu.climate.air.temperature[i]-gpu.climate.air.temperature[i]));
   for(let i=0;i<cpu.climate.air.mass.length;i++)maxAirMass=Math.max(maxAirMass,Math.abs(cpu.climate.air.mass[i]-gpu.climate.air.mass[i]));
   for(let i=0;i<cpu.climate.air.velocity.length;i++)maxMomentum=Math.max(maxMomentum,Math.abs(cpu.climate.air.velocity[i]-gpu.climate.air.velocity[i]));
   if(step===89){const saved={version:4 as const,preset:'coast' as const,time:3,state:[...gpu.state],climate:gpu.climate.snapshot(),environment:emptyEnv,discoveries:[],supplied:0,removed:0};await saveSnapshot(saved,'climate-regression-only');const loaded=await loadRecord('climate-regression-only');saveExact=validSnapshot(loaded,grid.count)&&JSON.stringify(loaded)===JSON.stringify(saved);resumeCpu=new CpuSolver(grid,new Float32Array(saved.state));resumeCpu.climate.restore(saved.climate);resumeGpu=(await GpuSolver.create(grid,cpu.state.slice()))!;resumeGpu.climate.restore(cpu.climate.snapshot());}
  }
  const energyResidualCpu=totalEnthalpy(cpu.state,cpu.climate)-totalEnthalpy(initial)-cpuEnergy,energyResidualGpu=totalEnthalpy(gpu.state,gpu.climate)-totalEnthalpy(initial)-gpuEnergy,massResidualCpu=totalMass(cpu.state)+cpuEscape-totalMass(initial),massResidualGpu=totalMass(gpu.state)+gpuEscape-totalMass(initial);
  const energyScale=Math.max(1,Math.abs(totalEnthalpy(initial))),result={energyResidualCpuRelative:Math.abs(energyResidualCpu)/energyScale,energyResidualGpuRelative:Math.abs(energyResidualGpu)/energyScale,supported:true,steps:180,cells:grid.count,maxT,maxMass,maxWind,maxSwitchT,saveExact,energyResidualCpu,energyResidualGpu,massResidualCpu,massResidualGpu,seeds:gpu.climate.seeds.filter(v=>v>.001).length,cloudMoved:gpu.state.some((v,i)=>(i%STRIDE===F.cloud||i%STRIDE===F.cloudIce)&&v!==initial[i]),finite:gpu.state.every(Number.isFinite),nonnegative:gpu.state.every((v,i)=>i%STRIDE===F.temperature||v>=0)};
  return {...result,maxAirT,maxAirMass,maxMomentum,passed:saveExact&&result.finite&&result.nonnegative&&maxT<.003&&maxSwitchT<.003&&maxMass<1e-4&&maxWind<1e-5&&maxAirT<.003&&maxAirMass<1e-4&&maxMomentum<.01&&result.energyResidualCpuRelative<2e-5&&result.energyResidualGpuRelative<2e-5&&Math.abs(massResidualCpu)<.005&&Math.abs(massResidualGpu)<.005};
 }finally{gpu.dispose();resumeGpu?.dispose();}
}
export async function verifyClimateLayers(view:PlanetView,state:()=>Float32Array,climate?:WeatherClimate,environment:Environment=emptyEnv){
 const before=state(),grid=(view as unknown as {grid:ReturnType<typeof createSphere>}).grid,cpu=new CpuSolver(grid,before.slice());
 if(!climate){cpu.climate.seedLife();cpu.advance(1/30,new Float32Array(grid.count*COMMAND_STRIDE),environment);climate=cpu.climate;}
 const canvas=view.engine.getRenderingCanvas(),results=[];
 for(const section of [false,true]){view.setSection(section,0);for(let i=0;i<45;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));
  for(const layer of Object.keys(CLIMATE_LAYERS) as (keyof typeof CLIMATE_LAYERS)[]){view.setClimate(layer,climate);view.update(before,0,environment);for(let frame=0;frame<120;frame++){await new Promise<void>(r=>requestAnimationFrame(()=>r()));if(view.scene.isReady())break;}const map=view.scene.getMeshByName('climate cell map')!,colors=map.getVerticesData('color')??[],cap=view.scene.getMeshByName('live material cross section')!.getVerticesData('climateColor')??[];
   const internals=view as unknown as {climateLayers:{cellColors:Float32Array};sectionView:{owner(face:number):number}},expected=Float32Array.from(Array.from({length:grid.count},(_,i)=>climateColor(layer,before,i,environment,climate!)).flat());
   const surfaceExact=internals.climateLayers.cellColors.every((v,i)=>v===expected[i]);
   const capExact=cap.every((v,i)=>{const owner=internals.sectionView.owner(Math.floor(i/12));return v===(owner<0?0:expected[owner*4+i%4]);});
   const arrow=view.scene.getMeshByName('climate velocity arrows')!,arrowEffect=arrow.material instanceof ShaderMaterial?arrow.material.getEffect():null;
   const arrowProjection=!(layer==='wind'||layer==='currents')||!view.visualStats().climate.arrows||!!(arrowEffect?.vertexSourceCodeBeforeMigration.includes('flatWorldPosition')&&arrowEffect.fragmentSourceCodeBeforeMigration.includes('sectionInside'));
   results.push({section,layer,ready:view.scene.isReady(),enabled:map.isEnabled(),finite:colors.every(Number.isFinite)&&cap.every(Number.isFinite),surfaceExact,capExact,arrowProjection,capColored:!section||layer==='none'||cap.some((v,i)=>i%4===3&&v>0),arrows:view.visualStats().climate.arrows});
  }
 }
 view.setClimate('temperature',climate);
 const root=(view as unknown as {root:TransformNode}).root,shaderCompatible=view.scene.meshes.filter(m=>m.isDescendantOf(root)&&m.material instanceof StandardMaterial).every(m=>m.material!.shaderLanguage===ShaderLanguage.GLSL);
 return {passed:shaderCompatible&&before.every((v,i)=>v===state()[i])&&canvas===view.engine.getRenderingCanvas()&&results.every(r=>r.ready&&r.enabled===(r.layer!=='none')&&r.finite&&r.capColored&&r.surfaceExact&&r.capExact&&r.arrowProjection),shaderCompatible,stateUnchanged:before.every((v,i)=>v===state()[i]),sameCanvas:canvas===view.engine.getRenderingCanvas(),results};
}
