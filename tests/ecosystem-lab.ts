/** Real ecology and renderer, no application saves. */
import {PlanetView} from '../src/render/planet';
import {createSphere,nearestCell} from '../src/sim/sphere';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,seedPlanet,totals,totalMass} from '../src/sim/model';
import {GpuSolver} from '../src/sim/gpu';
import {WorkerSolver} from '../src/sim/workerSolver';
const grid=createSphere(4),state=seedPlanet(grid,'rock',22,'none'),environment={ambient:22,sunlight:.6,sun:[-.3,.8,-.7]},commands=new Float32Array(grid.count*COMMAND_STRIDE);
for(let i=0;i<grid.count;i++){const p=i*STRIDE,x=grid.directions[i*3];state[p+F.rock]=Math.max(0,(x>.16?2:8)-grid.geometry[i*4+3]);state[p+F.soil]=x>.16?0:3;state[p+F.water]=x>.16?5:.3;state[p+F.nitrogen]=.3;}
for(const [x,y,z,herb,carn] of [[-.14,.28,-1,1.4,0],[-.06,.48,-1,1,0],[-.38,.08,-1,1.2,0],[.08,.18,-1,1,.65],[-.50,.42,-1,1,.55]]){
 const cell=nearestCell(grid,x,y,z),p=cell*STRIDE;state[p+F.plant]=.7;state[p+F.herbivore]=herb;state[p+F.carnivore]=carn;
}
const solver=new CpuSolver(grid,state),view=await PlanetView.create(document.querySelector('canvas')!,grid,solver.state);view.setEnvironment(environment);view.setLayers(false,false);view.setSurfaceStyle(true,1,true);view.setSun(environment.sun);view.camera.alpha=-Math.PI/2;view.camera.beta=1.12;view.camera.radius=11.5;
let paused=false,clock=0,time=0,last=performance.now(),grazed=0,hunted=0,recordUntil=0,recorder:MediaRecorder|null=null;const initial=totalMass(state),output=document.querySelector('output')!;
view.engine.runRenderLoop(()=>{
 const now=performance.now(),dt=Math.min(.05,(now-last)/1000);last=now;
 if(!paused){clock+=dt;while(clock>=.1){clock-=.1;solver.advance(.1,commands,environment);time+=.1;for(let i=0;i<grid.count;i++){grazed+=solver.feedingCells[i*2];hunted+=solver.feedingCells[i*2+1];}view.update(solver.state,.1,environment);view.showFeeding(solver.feedingCells,.1);}}
 view.setMotion({time,paused,environment,spin:{angle:0,running:false,tilt:0,period:120}});view.animate(dt,1);view.setSun(environment.sun);view.scene.render();
 if(recorder&&now>=recordUntil){recorder.stop();recorder=null;}
 const stocks=totals(solver.state);output.textContent=JSON.stringify({paused,time:+time.toFixed(1),grazedKg:+grazed.toFixed(4),huntedKg:+hunted.toFixed(4),plantsKg:+stocks[F.plant].toFixed(4),grazersKg:+stocks[F.herbivore].toFixed(4),predatorsKg:+stocks[F.carnivore].toFixed(4),massErrorKg:totalMass(solver.state)-initial},null,2);
});
document.querySelector<HTMLButtonElement>('#pause')!.onclick=e=>{paused=!paused;(e.currentTarget as HTMLButtonElement).textContent=paused?'Resume':'Pause';};
document.querySelector<HTMLButtonElement>('#compare')!.onclick=async e=>{
 const button=e.currentTarget as HTMLButtonElement;button.disabled=true;const small=createSphere(1),s=seedPlanet(small,'rock',22,'none'),batch=new Float32Array(small.count*COMMAND_STRIDE),rows:unknown[]=[];
 for(let i=0;i<small.count;i++){const p=i*STRIDE;s[p+F.soil]=10;s[p+F.water]=.3;s[p+F.nitrogen]=.3;s[p+F.plant]=2;s[p+F.herbivore]=1;s[p+F.carnivore]=.4;}
 const cpu=new CpuSolver(small,s.slice());cpu.advance(.2,batch,environment);
 for(const backend of ['WebGPU','Worker CPU','Worker WebGPU']){
  const candidate=backend==='WebGPU'?await GpuSolver.create(small,s.slice()):await WorkerSolver.create(small,s.slice(),backend==='Worker CPU');
  if(!candidate){rows.push({backend,supported:false});continue;}
  try{await candidate.step(.2,batch,environment);let maxFeedingError=0;for(let i=0;i<cpu.feedingCells.length;i++)maxFeedingError=Math.max(maxFeedingError,Math.abs(cpu.feedingCells[i]-candidate.feedingCells[i]));const consumed=candidate.feedingCells.reduce((a,b)=>a+b,0);await candidate.step(0,batch,environment);rows.push({backend,actual:candidate.backend,maxFeedingError,consumed,pausedConsumption:candidate.feedingCells.reduce((a,b)=>a+b,0),passed:maxFeedingError<1e-5&&consumed>0&&candidate.feedingCells.every(v=>v===0)});}finally{candidate.dispose();}
 }
 document.querySelector('.panel p')!.textContent=JSON.stringify(rows);button.disabled=false;
};
document.querySelector<HTMLButtonElement>('#record')!.onclick=e=>{
 const button=e.currentTarget as HTMLButtonElement;button.disabled=true;const chunks:BlobPart[]=[],stream=view.canvas.captureStream(60),capture=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:10000000});
 capture.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};capture.onstop=()=>{const url=URL.createObjectURL(new Blob(chunks,{type:'video/webm'})),a=document.createElement('a');a.href=url;a.download='sandsphere-animals.webm';a.click();stream.getTracks().forEach(track=>track.stop());setTimeout(()=>URL.revokeObjectURL(url),10000);button.disabled=false;};
 recorder=capture;recordUntil=performance.now()+7000;paused=false;capture.start();
};
