import {createSphere} from '../src/sim/sphere';
import {CpuSolver,COMMAND_STRIDE,totalMass,totalEnthalpy,type Snapshot,type Solver} from '../src/sim/model';
import {createJupiterPlanet,createSaturnPlanet} from '../src/sim/planetCreation';
import {GpuSolver} from '../src/sim/gpu';
import {WorkerSolver} from '../src/sim/workerSolver';
import {validSnapshot} from '../src/sim/storage';
const results:Record<string,unknown>[]=[],out=document.querySelector<HTMLPreElement>('#results')!,check=(pass:boolean,message:string)=>{if(!pass)throw new Error(message);};
const species=(mass:Float64Array)=>[0,1,2,5].map(f=>{let total=0;for(let q=0;q<mass.length;q+=8)for(let k=0;k<(f>=2?3:1);k++)total+=mass[q+f+k];return total;});
async function run(){const grid=createSphere(1),cmd=new Float32Array(grid.count*COMMAND_STRIDE);
 for(const preset of ['jupiter','saturn'] as const){const p=preset==='jupiter'?createJupiterPlanet(grid):createSaturnPlanet(grid);
  for(const backend of ['Worker CPU','WebGPU','Worker WebGPU'] as const){const cpu=new CpuSolver(grid,p.state.slice());cpu.climate.restore(p.climate);let candidate:Solver|null=null;
   try{candidate=backend==='WebGPU'?await GpuSolver.create(grid,p.state.slice()):await WorkerSolver.create(grid,p.state.slice(),backend==='Worker CPU');if(!candidate){results.push({preset,backend,available:false});continue;}candidate.climate.restore(p.climate);
    const m=totalMass(candidate.state,candidate.climate),h=totalEnthalpy(candidate.state,candidate.climate),initialSpecies=species(candidate.climate.giant.mass);let external=0;
    for(let n=0;n<30;n++){cpu.advance(.1,cmd,p.environment);await candidate.step(.1,cmd,p.environment);external+=candidate.energyChanges.reduce((a,b)=>a+b,0);}
    const stateError=Math.max(...cpu.state.map((v,i)=>Math.abs(v-candidate!.state[i]))),climateEqual=JSON.stringify(cpu.climate.snapshot())===JSON.stringify(candidate.climate.snapshot()),massResidual=totalMass(candidate.state,candidate.climate)-m,energyResidual=totalEnthalpy(candidate.state,candidate.climate)-h-external;
    check(stateError===0&&climateEqual,`${preset} ${backend} state mismatch`);check(Math.abs(massResidual)<1e-9&&Math.abs(energyResidual)<1e-5,`${preset} ${backend} budget mismatch`);
    const speciesResidual=species(candidate.climate.giant.mass).map((v,f)=>v-initialSpecies[f]);check(speciesResidual.every(v=>Math.abs(v)<1e-9),'Volatile inventory mismatch');
    const snapshot:Snapshot={version:8,preset:'coast',state:[...candidate.state],climate:candidate.climate.snapshot(),environment:p.environment,spin:p.spin,time:3,discoveries:[],supplied:0,removed:0};check(validSnapshot(snapshot,grid.count),'Deep snapshot rejected');
    const restored=new CpuSolver(grid,new Float32Array(snapshot.state));restored.climate.restore(JSON.parse(JSON.stringify(snapshot.climate)));restored.advance(.1,cmd,p.environment);await candidate.step(.1,cmd,p.environment);check(restored.state.every((v,i)=>v===candidate!.state[i])&&JSON.stringify(restored.climate.snapshot())===JSON.stringify(candidate.climate.snapshot()),'Resume mismatch');
    const g=candidate.climate.giant,clouds=Array.from({length:grid.count},(_,i)=>g.cloudOptics(i)),wind=Array.from({length:grid.count},(_,i)=>g.zonalWind(i));
    results.push({preset,backend,actual:candidate.backend,passed:true,stateError,climateEqual,massResidual,speciesResidual,energyResidual,resumeEqual:true,ammoniaCloud:clouds.reduce((a,c)=>a+c.ammonia,0),waterCloud:clouds.reduce((a,c)=>a+c.water,0),jetWest:Math.min(...wind),jetEast:Math.max(...wind)});out.textContent=JSON.stringify({running:true,results},null,2);
   }finally{candidate?.dispose();}
  }
 }
 out.textContent=JSON.stringify({passed:true,results},null,2);
}
run().catch(error=>{out.textContent=JSON.stringify({passed:false,error:String(error),results},null,2);console.error(error);});
