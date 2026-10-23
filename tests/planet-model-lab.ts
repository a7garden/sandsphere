import {createSphere} from '../src/sim/sphere';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,totalMass,totalEnthalpy} from '../src/sim/model';
import {createMarsPlanet} from '../src/sim/planetCreation';
import {GpuSolver} from '../src/sim/gpu';
import {WorkerSolver} from '../src/sim/workerSolver';
import {validSnapshot} from '../src/sim/storage';
const output=document.querySelector<HTMLPreElement>('#results')!;
const results:Record<string,unknown>={};
const check=(condition:boolean,message:string)=>{if(!condition)throw new Error(message);};
async function verify(){
 const grid=createSphere(1),p=createMarsPlanet(grid),empty=new Float32Array(grid.count*COMMAND_STRIDE);
 for(let i=0;i<grid.count;i++)p.state[i*STRIDE+F.temperature]=-125;
 const cpu=new CpuSolver(grid,p.state.slice()),worker=await WorkerSolver.create(grid,p.state.slice(),true);
 check(!!worker,'CPU worker unavailable');
 try{
  for(let n=0;n<30;n++){cpu.advance(1/30,empty,p.environment);await worker!.step(1/30,empty,p.environment);}
  check(cpu.state.every((v,i)=>v===worker!.state[i]),'CPU/worker surface mismatch');
  check(JSON.stringify(cpu.climate.snapshot())===JSON.stringify(worker!.climate.snapshot()),'CPU/worker climate mismatch');
  results.worker={passed:true,steps:30,radiusMeters:worker!.climate.air.radiusMeters,minimumSurfaceTemperature:Math.min(...worker!.state.filter((_,i)=>i%STRIDE===F.temperature))};
 }finally{worker?.dispose();}
 const gpu=await GpuSolver.create(grid,p.state.slice());
 if(!gpu){results.gpu={available:false};return;}
 try{
  const reference=new CpuSolver(grid,p.state.slice()),mass=totalMass(p.state),h=totalEnthalpy(p.state);let external=0,escaped=0;
  for(let n=0;n<30;n++){reference.advance(1/30,empty,p.environment);await gpu.step(1/30,empty,p.environment);external+=gpu.energyChanges.reduce((a,b)=>a+b,0);escaped+=gpu.escapeCells.reduce((a,b)=>a+b,0);}
  const temperatureError=Math.max(...Array.from({length:grid.count},(_,i)=>Math.abs(reference.state[i*STRIDE+F.temperature]-gpu.state[i*STRIDE+F.temperature])));
  const massResidual=totalMass(gpu.state)+escaped-mass,energyResidual=totalEnthalpy(gpu.state,gpu.climate)-h-external;
  check(temperatureError<.01,'CPU/GPU temperature mismatch');check(Math.abs(massResidual)<.002,'GPU mass budget');check(Math.abs(energyResidual)<.1,'GPU energy budget');
  check(gpu.state[F.temperature]<-120,'GPU legacy cold clamp remained');
  const snapshot={version:5 as const,preset:'coast' as const,planet:{primary:p.primary},environment:p.environment,spin:p.spin,state:[...gpu.state],climate:gpu.climate.snapshot(),time:1,discoveries:[],supplied:0,removed:0};
  check(validSnapshot(snapshot,grid.count),'GPU snapshot rejected');
  const resumed=new CpuSolver(grid,new Float32Array(snapshot.state));resumed.climate.restore(JSON.parse(JSON.stringify(snapshot.climate)));
  await gpu.step(1/30,empty,p.environment);resumed.advance(1/30,empty,p.environment);
  const resumeError=Math.max(...resumed.state.map((v,i)=>Math.abs(v-gpu.state[i])));check(resumeError<.01,'GPU to CPU resume mismatch');
  results.gpu={available:true,passed:true,temperatureError,massResidual,energyResidual,resumeError,radiusMeters:gpu.climate.air.radiusMeters};
 }finally{gpu.dispose();}
}
verify().then(()=>{output.textContent=JSON.stringify({passed:true,...results},null,2);}).catch(error=>{output.textContent=JSON.stringify({passed:false,error:String(error),...results},null,2);console.error(error);});
