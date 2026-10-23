import {createSphere} from '../src/sim/sphere';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,totalMass,totalEnthalpy,totals} from '../src/sim/model';
import {createMarsPlanet} from '../src/sim/planetCreation';
import {AIR_LAYERS,COLUMN_KG} from '../src/sim/layeredAtmosphere';
import {GpuSolver} from '../src/sim/gpu';
import {WorkerSolver} from '../src/sim/workerSolver';
import {validSnapshot} from '../src/sim/storage';
import {PlanetView} from '../src/render/planet';
import type {ClimateLayer} from '../src/sim/weatherClimate';
const output=document.querySelector<HTMLPreElement>('#results')!,results:Record<string,unknown>={};
const check=(condition:boolean,message:string)=>{if(!condition)throw new Error(message);};
function initial(detail:number){
 const grid=createSphere(detail),p=createMarsPlanet(grid),seed=new CpuSolver(grid,p.state);
 for(let i=0;i<grid.count;i++){seed.state[i*STRIDE+F.temperature]=grid.directions[i*3+1]>.3?-140:-60;seed.state[i*STRIDE+F.ice]=0;}
 seed.climate.prepareSurface(seed.state,p.environment);
 for(let i=0;i<grid.count;i++){const [x,y]=grid.directions.subarray(i*3,i*3+2),l=Math.hypot(x,y),v=l>1e-5?[-150*y/l,150*x/l,0]:[150,0,0];for(let k=0;k<AIR_LAYERS;k++)seed.climate.air.velocity.set(v,(i*AIR_LAYERS+k)*3);}
 seed.climate.air.attach(seed.state);return {...p,grid,state:seed.state.slice(),climate:seed.climate.snapshot()};
}
async function verify(){
 const p=initial(1),{grid}=p,empty=new Float32Array(grid.count*COMMAND_STRIDE),cpu=new CpuSolver(grid,p.state.slice()),worker=await WorkerSolver.create(grid,p.state.slice(),true);cpu.climate.restore(p.climate);worker?.climate.restore(p.climate);
 check(!!worker,'CPU worker unavailable');
 try{
  for(let n=0;n<30;n++){cpu.advance(.1,empty,p.environment);await worker!.step(.1,empty,p.environment);}
  check(cpu.state.every((v,i)=>v===worker!.state[i]),'CPU/worker surface mismatch');check(JSON.stringify(cpu.climate.snapshot())===JSON.stringify(worker!.climate.snapshot()),'CPU/worker climate mismatch');
  check(totals(cpu.state)[F.carbonDioxideIce]>0&&totals(cpu.state)[F.airborneDust]>0,'No frost/dust formed');
  results.worker={passed:true,steps:30,co2Ice:totals(cpu.state)[F.carbonDioxideIce],airborneDust:totals(cpu.state)[F.airborneDust]};
 }finally{worker?.dispose();}
 const gpu=await GpuSolver.create(grid,p.state.slice());if(!gpu){results.gpu={available:false};return;}
 try{
  gpu.climate.restore(p.climate);const reference=new CpuSolver(grid,p.state.slice());reference.climate.restore(p.climate);
  const mass=totalMass(p.state),h=totalEnthalpy(p.state,p.climate);let external=0,escaped=0;
  for(let n=0;n<30;n++){reference.advance(.1,empty,p.environment);await gpu.step(.1,empty,p.environment);external+=gpu.energyChanges.reduce((a,b)=>a+b,0);escaped+=gpu.escapeCells.reduce((a,b)=>a+b,0);}
  const stateError=Math.max(...reference.state.map((v,i)=>Math.abs(v-gpu.state[i]))),massResidual=totalMass(gpu.state)+escaped-mass,energyResidual=totalEnthalpy(gpu.state,gpu.climate)-h-external;
  results.gpu={stateError,massResidual,energyResidual,external,initialEnergy:h,finalEnergy:totalEnthalpy(gpu.state,gpu.climate)};
  check(stateError<.01,'CPU/GPU state mismatch');check(Math.abs(massResidual)<.002,'GPU mass budget');check(Math.abs(energyResidual)<.1,'GPU energy budget');
  const snapshot={version:6 as const,preset:'coast' as const,planet:{primary:p.primary},environment:p.environment,spin:p.spin,state:[...gpu.state],climate:gpu.climate.snapshot(),time:3,discoveries:[],supplied:0,removed:0};check(validSnapshot(snapshot,grid.count),'GPU snapshot rejected');
  const resumed=new CpuSolver(grid,new Float32Array(snapshot.state));resumed.climate.restore(JSON.parse(JSON.stringify(snapshot.climate)));await gpu.step(.1,empty,p.environment);resumed.advance(.1,empty,p.environment);
  const resumeError=Math.max(...resumed.state.map((v,i)=>Math.abs(v-gpu.state[i])));check(resumeError<.01,'GPU to CPU resume mismatch');
  results.gpu={available:true,passed:true,stateError,massResidual,energyResidual,resumeError,co2Ice:totals(gpu.state)[F.carbonDioxideIce],airborneDust:totals(gpu.state)[F.airborneDust]};
 }finally{gpu.dispose();}
}
async function preview(){
 const p=initial(3),solver=new CpuSolver(p.grid,p.state),empty=new Float32Array(p.grid.count*COMMAND_STRIDE);solver.climate.restore(p.climate);
 for(let n=0;n<90;n++)solver.advance(1/30,empty,p.environment);
 const view=await PlanetView.create(document.querySelector('canvas')!,p.grid,solver.state);view.setSpin(0,false,0);view.setEnvironment(p.environment);view.setSun(p.environment.sun);view.setClimate('none',solver.climate);
 for(const [id,layer] of [['material','none'],['frost','co2ice'],['dust','dust']] as const)document.getElementById(id)!.onclick=()=>view.setClimate(layer as ClimateLayer,solver.climate);
 document.getElementById('section')!.onclick=()=>view.setSection(!view.isSection,0);
 const t=totals(solver.state);document.getElementById('reading')!.textContent=`3행성분 · ${p.grid.count}셀 · CO₂ 얼음 ${t[F.carbonDioxideIce].toFixed(4)} kg · 대기 먼지 ${t[F.airborneDust].toFixed(6)} kg · 최대 먼지 광학 깊이 ${Math.max(...solver.state.filter((_,i)=>i%STRIDE===F.airborneDust).map(m=>m*COLUMN_KG*600)).toFixed(2)}`;
 view.engine.runRenderLoop(()=>{view.update(solver.state,0,p.environment);view.scene.render();});
}
void preview().catch(error=>{document.getElementById('reading')!.textContent=String(error);});
verify().then(()=>{output.textContent=JSON.stringify({passed:true,...results},null,2);}).catch(error=>{output.textContent=JSON.stringify({passed:false,error:String(error),...results},null,2);console.error(error);});
