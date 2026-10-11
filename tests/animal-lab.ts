/** Uses real renderer and solvers; never reads or writes application saves. */
import {PlanetView} from '../src/render/planet';
import {createSphere,nearestCell} from '../src/sim/sphere';
import {F,STRIDE,CpuSolver,seedPlanet,COMMAND_STRIDE,totalMass,totalEnthalpy} from '../src/sim/model';
import {GpuSolver} from '../src/sim/gpu';
import {AnimalNavigation} from '../src/sim/animalNavigation';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
const grid=createSphere(4),state=seedPlanet(grid,'rock',22,'none'),environment={ambient:22,sunlight:1,sun:[-.3,.8,-.5]};
for(let i=0;i<grid.count;i++){
 const p=i*STRIDE,x=grid.directions[i*3],z=grid.directions[i*3+2];state[p+F.soil]=2;state[p+F.water]=x>.16?3:.025;
 if(x<-.12&&z<-.55)state[p+F.plant]=.22;
}
for(const [x,y,z,mass,kind] of [[-.14,.28,-1,1.4,F.herbivore],[-.06,.48,-1,1,F.herbivore],[-.38,.08,-1,1.2,F.herbivore],[.08,.18,-1,.9,F.carnivore],[-.50,.42,-1,.8,F.carnivore]]){
 const cell=nearestCell(grid,x,y,z);state[cell*STRIDE+kind]=mass;
}
const view=await PlanetView.create(document.querySelector('canvas')!,grid,state);view.setEnvironment(environment);view.setSun(environment.sun);view.setLayers(false,false);view.setSurfaceStyle(true,1,true);view.camera.alpha=-Math.PI/2;view.camera.beta=1.12;view.camera.radius=8.2;
let paused=false,time=0,frames=0,last=performance.now(),baseline=totalMass(state),baselineHeat=totalEnthalpy(state);
function bodies(){return view.scene.meshes.filter(m=>['grazing populations','predator populations'].includes(m.name)) as Mesh[];}
function positions(){return bodies().map(m=>{const data=(m as unknown as {_thinInstanceDataStorage:{matrixData:Float32Array}})._thinInstanceDataStorage.matrixData;return {kind:m.name,count:m.thinInstanceCount,position:[...data.slice(12,15)]};});}
const initial=positions();
view.engine.runRenderLoop(()=>{
 if(!paused)time+=1/60;view.setMotion({time,paused,environment,spin:{angle:0,running:false,tilt:0,period:120}});view.animate(1/60,1);view.setSun(environment.sun);view.scene.render();frames++;
 if(performance.now()-last>1000){document.querySelector('output')!.textContent=JSON.stringify({fps:Math.round(frames*1000/(performance.now()-last)),paused,initial,current:positions(),massUnchanged:totalMass(state)===baseline,heatUnchanged:totalEnthalpy(state)===baselineHeat});frames=0;last=performance.now();}
});
document.querySelector<HTMLButtonElement>('#pause')!.onclick=e=>{paused=!paused;(e.currentTarget as HTMLButtonElement).textContent=paused?'Resume animals':'Pause animals';};
document.querySelector<HTMLButtonElement>('#flood')!.onclick=()=>{for(let i=0;i<grid.count;i++)state[i*STRIDE+F.water]=3;view.update(state,0,environment);baseline=totalMass(state);baselineHeat=totalEnthalpy(state);document.querySelector('#result')!.textContent='Flooded land: animal representations must disappear and may not walk on the sea.';};
document.querySelector<HTMLButtonElement>('#gpu')!.onclick=async e=>{
 const button=e.currentTarget as HTMLButtonElement;button.disabled=true;const out=document.querySelector('#result')!;out.textContent='Comparing 20 conservative steps...';let gpu:GpuSolver|null=null;
 try{
  const small=createSphere(2),s=seedPlanet(small,'rock',22,'none');for(let i=0;i<small.count;i++){s[i*STRIDE+F.soil]=2;s[i*STRIDE+F.water]=.025;if(small.directions[i*3]>.3)s[i*STRIDE+F.water]=10;if(small.directions[i*3]<-.2)s[i*STRIDE+F.plant]=.4;}
  s[F.herbivore]=2;s[F.carnivore]=.8;const cpu=new CpuSolver(small,s.slice());gpu=await GpuSolver.create(small,s.slice());if(!gpu){out.textContent=JSON.stringify({supported:false});return;}
  const commands=new Float32Array(small.count*COMMAND_STRIDE),before=totalMass(s),heat=totalEnthalpy(s);let ledgerCpu=0,ledgerGpu=0;
  for(let n=0;n<20;n++){cpu.advance(.1,commands,environment);await gpu.step(.1,commands,environment);ledgerCpu+=cpu.energyChanges.reduce((a,b)=>a+b,0);ledgerGpu+=gpu.energyChanges.reduce((a,b)=>a+b,0);}
  let maxError=0,waterConsumers=0;for(let i=0;i<s.length;i++)maxError=Math.max(maxError,Math.abs(cpu.state[i]-gpu.state[i]));for(let i=0;i<small.count;i++)if(s[i*STRIDE+F.water]>1)waterConsumers+=gpu.state[i*STRIDE+F.herbivore]+gpu.state[i*STRIDE+F.carnivore];
  out.textContent=JSON.stringify({supported:true,maxError,cpuMassError:totalMass(cpu.state)-before,gpuMassError:totalMass(gpu.state)-before,cpuEnergyLedgerError:totalEnthalpy(cpu.state)-heat-ledgerCpu,gpuEnergyLedgerError:totalEnthalpy(gpu.state)-heat-ledgerGpu,waterConsumers});
 }catch(error){out.textContent=String(error);}finally{gpu?.dispose();button.disabled=false;}
};
document.querySelector<HTMLButtonElement>('#benchmark')!.onclick=()=>{
 const s=state.slice();for(let i=0;i<grid.count;i++){s[i*STRIDE+F.water]=.025;s[i*STRIDE+F.plant]=.2;s[i*STRIDE+F.herbivore]=.2;s[i*STRIDE+F.carnivore]=.1;}
 const nav=new AnimalNavigation(grid),energy=new Float32Array(grid.count*4);nav.move(s,.1,environment,energy);const start=performance.now();for(let n=0;n<20;n++)nav.move(s,.1,environment,energy);document.querySelector('#result')!.textContent=JSON.stringify({gridCells:grid.count,meanNavigationAndTransferMs:(performance.now()-start)/20});
};
