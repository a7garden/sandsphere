import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,COMMAND_STRIDE,seedWorld,CpuSolver,totalMass,totalEnthalpy} from '../src/sim/model';
import {CLIMATE_LAYERS,type ClimateLayer} from '../src/sim/weatherClimate';
import {PlanetView} from '../src/render/planet';
import {SimulationClock,PHYSICS_DT} from '../src/sim/clock';
import {verifyClimateLayers,verifyClimateGpu} from './climate-browser-regressions';
const grid=createSphere(3),initial=seedWorld(grid,'coast',22),environment={ambient:18,sunlight:1,sun:[1,0,0],gravity:1,rotationRate:.06,climate:true},cpu=new CpuSolver(grid,initial),empty=new Float32Array(grid.count*COMMAND_STRIDE),clock=new SimulationClock();
cpu.climate.seedLife(cpu.state);for(let i=0;i<grid.count;i++){const p=i*STRIDE,x=grid.directions[i*3];cpu.state[p+F.carbonDioxide]=.003;if(x>.7){cpu.state[p+F.cloud]=.12;cpu.state[p+F.nitrogen]=.6;}if(i%11===0)cpu.state[p+F.water]=.2;}
const view=await PlanetView.create(document.querySelector('canvas')!,grid,cpu.state);view.setSpin(0,false,0);view.setEnvironment(environment);view.setSun(environment.sun);view.setCloudStyle('faceted');
let paused=false,time=0,previous=performance.now(),layer:ClimateLayer='none';
const layerInput=document.getElementById('layer') as HTMLSelectElement;layerInput.innerHTML=Object.entries(CLIMATE_LAYERS).map(([id,info])=>`<option value="${id}">${info.name}</option>`).join('');layerInput.onchange=()=>{layer=layerInput.value as ClimateLayer;view.setClimate(layer,cpu.climate);};
document.getElementById('pause')!.onclick=()=>{paused=!paused;document.getElementById('pause')!.textContent=paused?'재개':'정지';};document.getElementById('section')!.onclick=()=>view.setSection(!view.isSection,0);view.setClimate(layer,cpu.climate);
view.engine.runRenderLoop(()=>{const now=performance.now(),dt=(now-previous)/1000;previous=now;if(!paused){clock.add(dt,1);for(let k=clock.take();k>0;k--){cpu.advance(PHYSICS_DT,empty,environment);time+=PHYSICS_DT;}view.update(cpu.state,dt,environment);view.showRain(cpu.precipitatedCells,PHYSICS_DT);}view.setTime(time);view.animate(dt);view.scene.render();document.querySelector('output')!.textContent=`${time.toFixed(2)}초 · ${CLIMATE_LAYERS[layer].name} · 질량 ${totalMass(cpu.state).toFixed(3)}kg\n${CLIMATE_LAYERS[layer].legend}`;});
Object.assign(window,{climateLab:{view,grid,solver:cpu,environment,state:()=>cpu.state.slice(),verifyLayers:()=>verifyClimateLayers(view,()=>cpu.state.slice()),verifyGpu:verifyClimateGpu,stats:()=>({time,paused,mass:totalMass(cpu.state),enthalpy:totalEnthalpy(cpu.state),visual:view.visualStats()})}});
