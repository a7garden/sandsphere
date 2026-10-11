import {CpuSolver,COMMAND_FIELD,COMMAND_STRIDE,F,STRIDE,seedPlanet,totalMass,type Solver} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {GpuSolver} from '../src/sim/gpu';
import {WorkerSolver} from '../src/sim/workerSolver';
const button=document.querySelector('button')!,output=document.querySelector('output')!;
button.onclick=async()=>{
 button.disabled=true;output.textContent='Checking paused supply with and without layered climate...';const rows=[];
 try{
  for(const climate of [false,true])for(const backend of ['CPU','WebGPU','Worker CPU','Worker WebGPU']){
   const grid=createSphere(2),state=seedPlanet(grid,'rock',20,'none'),commands=new Float32Array(grid.count*COMMAND_STRIDE);
   state[F.water]=3;state[STRIDE+F.water]=.3;state[STRIDE+F.soil]=10;
   for(const cell of [0,1]){commands[cell*COMMAND_STRIDE+COMMAND_FIELD.herbivore]=2;commands[cell*COMMAND_STRIDE+COMMAND_FIELD.carnivore]=3;}
   let solver:Solver|null=null;
   try{
    solver=backend==='CPU'?new CpuSolver(grid,state.slice()):backend==='WebGPU'?await GpuSolver.create(grid,state.slice()):await WorkerSolver.create(grid,state.slice(),backend==='Worker CPU');
    if(!solver){rows.push({backend,climate,supported:false});continue;}
    await solver.step(0,commands,{ambient:20,sunlight:0,sun:[1,0,0],climate});
    const s=solver.state,massError=totalMass(s)-totalMass(state)-10;
    rows.push({backend:solver.backend,requested:backend,climate,seaAlive:s[F.herbivore]+s[F.carnivore],seaOrganic:s[F.soil],landAlive:s[STRIDE+F.herbivore]+s[STRIDE+F.carnivore],massError,passed:s[F.herbivore]===0&&s[F.carnivore]===0&&s[F.soil]===5&&s[STRIDE+F.herbivore]===2&&s[STRIDE+F.carnivore]===3&&Math.abs(massError)<.0001});
   }finally{solver?.dispose();}
  }
  output.textContent=JSON.stringify({passed:rows.every(r=>!('passed' in r)||r.passed),rows},null,2);
 }catch(error){output.textContent=String(error);}finally{button.disabled=false;}
};
