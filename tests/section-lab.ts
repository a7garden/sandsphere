import {atmosphereState,atmosphereReadout} from '../src/sim/atmosphere';
/** Browser/GPU fixture with no connection to application saves. */
import {PlanetView} from '../src/render/planet';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,seedWorld,totalMass,totalEnthalpy,type SurfaceMaterial} from '../src/sim/model';
import {GpuSolver} from '../src/sim/gpu';
import {createSphere} from '../src/sim/sphere';
import {vaporCapacity} from '../src/sim/model';
import {PHYSICS_DT,SimulationClock} from '../src/sim/clock';
import type {CloudStyle} from '../src/render/cloudBanks';
const grid=createSphere(3),e={ambient:20,sunlight:0,sun:[1,0,0],gravity:1},s=seedWorld(grid);
for(let i=0;i<grid.count;i++){
 const p=i*STRIDE,y=grid.directions[i*3+1],x=grid.directions[i*3];s[p+F.cloud]=.3+.1*Math.sin(x*8);s[p+F.cloudIce]=y<0?.08:0;
 s[p+F.soil]=2;s[p+F.plant]=Math.max(0,y)*1.4;s[p+F.herbivore]=.15;s[p+F.carnivore]=.04;s[p+F.water]+=1;
 if(y<-.5){s[p+F.ice]=2;s[p+F.water]=0;s[p+F.temperature]=-10;}
 if(y>.7){s[p+F.sand]=2;s[p+F.clay]=3;s[p+F.temperature]=950;}
 if(x>.9){s[p+F.molten]=3;s[p+F.temperature]=1600;}
}
const solver=new CpuSolver(grid,s),commands=new Float32Array(grid.count*COMMAND_STRIDE),clock=new SimulationClock();
const view=await PlanetView.create(document.querySelector('canvas')!,grid,s);view.setEnvironment(e);view.setSpin(0,false,0);view.setSun([.7,.4,-.6]);view.setSurfaceStyle(true,1,true);view.setLayers(true,true);view.setCloudStyle('faceted');
let paused=new URLSearchParams(location.search).get('paused')==='1',time=0,poured=0,rain=false,style=0,angle=0,width=.22;
view.setSection(true,0);
const node=(id:string)=>document.getElementById(id) as HTMLButtonElement;
if(paused)node('pause').textContent='시간 재개';
node('section').onclick=()=>view.setSection(!view.isSection);
node('pause').onclick=()=>{paused=!paused;node('pause').textContent=paused?'시간 재개':'시간 정지';};
node('rain').onclick=()=>{rain=!rain;view.setPrecipitationLayer(rain);};
node('angle').onclick=()=>view.setSectionAngle(angle+=30);
node('width').onclick=()=>view.setSectionWidth(width=width===.22?.7:.22);
node('style').onclick=()=>view.setCloudStyle((['faceted','cumulus','stratus'] as CloudStyle[])[++style%3]);
node('pour').onclick=()=>{for(const material of ['sand','water','clay','salt','soil','ice','plant','herbivore','carnivore','iron','glass','ceramic'] as SurfaceMaterial[]){poured+=2;view.emit(0,material,2,(i,mass)=>{const field=material==='sand'?1:material==='water'?0:material==='clay'?2:material==='salt'?3:({soil:15,ice:12,plant:16,herbivore:17,carnivore:18,iron:19,glass:14,ceramic:13} as Record<string,number>)[material];commands[i*COMMAND_STRIDE+field]+=mass;},[...grid.directions.slice(0,3)],0,[...grid.directions.slice(0,3)].map(v=>v*8));}};
node('meteor').onclick=()=>void view.meteor([...grid.directions.slice(0,3)]);
node('p2').onclick=()=>{
 e.gravity=1;
 solver.state.fill(0);commands.fill(0);time=0;clock.reset();
 for(let i=0;i<grid.count;i++){const p=i*STRIDE,y=grid.directions[i*3+1],hot=y>.25,s=solver.state;
  s[p+F.temperature]=hot?1900:y<-.6?-20:22;s[p+F.nitrogen]=.3;
  if(hot)s[p+F.glass]=8;
  else if(y<-.6)s[p+F.ice]=4;
  else {s[p+F.soil]=8;s[p+F.water]=.3;s[p+F.plant]=2;s[p+F.herbivore]=.2;s[p+F.cloud]=.2;s[p+F.vapor]=vaporCapacity(s,i,10,e);}
 }
 view.update(solver.state,1,e);view.setTime(time);paused=false;node('pause').textContent='시간 정지';
};
node('p3').onclick=()=>{
 solver.state.fill(0);commands.fill(0);time=0;clock.reset();e.gravity=.01;
 for(let i=0;i<grid.count;i++){const p=i*STRIDE,y=grid.directions[i*3+1];solver.state[p+F.rock]=8;solver.state[p+F.temperature]=y>.3?300:20;solver.state[p+F.methane]=3;solver.state[p+F.nitrogen]=.3;}
 view.update(solver.state,1,e);view.setTime(0);paused=false;node('pause').textContent='시간 정지';
};
let previous=performance.now();
view.engine.runRenderLoop(()=>{
 const now=performance.now(),real=(now-previous)/1000;previous=now;
 if(!paused){clock.add(real,1);for(let n=clock.take();n>0;n--){view.stepPhysics(PHYSICS_DT);solver.advance(PHYSICS_DT,commands,e);commands.fill(0);time+=PHYSICS_DT;view.setTime(time);view.update(solver.state,PHYSICS_DT,e);view.showRain(solver.precipitatedCells,PHYSICS_DT);view.showEscape(solver.escapeCells);}}
 view.animate(real);view.scene.render();
 if(!node('verify').disabled)document.querySelector('output')!.textContent=`${paused?'정지':'실시간'} · ${time.toFixed(2)}초 · ${view.engine.constructor.name} · ${view.visualStats().section.cells} 셀 단면 · ${view.visualStats().grains} 공급 입자\n${atmosphereReadout(atmosphereState(solver.state,e)).height} · ${atmosphereReadout(atmosphereState(solver.state,e)).regime}\n최근 손실 ${solver.escapeCells.reduce((a,b)=>a+b,0).toFixed(4)} kg · 외부 열 ${solver.energyChanges.reduce((a,b,i)=>a+(i%4===0?b:0),0).toFixed(3)} kJ · 탈출 열 ${solver.energyChanges.reduce((a,b,i)=>a+(i%4===2?b:0),0).toFixed(3)} kJ`;
});
async function verifyGpu(){
 const g=createSphere(1);for(let i=0;i<g.count;i++)g.geometry[i*4+3]=0;
 const cases=[{name:'paused no-op',t:-10.713238,values:{water:10,dissolved:.36,clay:12,firing:29}}, {name:'concentrated brine',t:-10,values:{water:10,dissolved:.36}}, {name:'100C evaporation',t:100,values:{water:10}}, {name:'clay firing',t:1000,values:{clay:10,firing:29.99}}, {name:'silica melting',t:1750,values:{sand:10}}, {name:'glass cooling',t:1300,values:{molten:10}}, {name:'cold precipitation',t:-10,values:{cloud:2}}, {name:'brine precipitation',t:-1,values:{cloud:2,water:10,dissolved:.36}},
 {name:'thin pressure boiling',t:90,values:{water:10,nitrogen:.15},gravity:1},
 {name:'high pressure liquid',t:110,values:{water:10,nitrogen:.6},gravity:1},
 {name:'surface sublimation',t:-20,values:{ice:10,nitrogen:.3},gravity:1},
 {name:'upper cloud melting',t:12.5,values:{cloudIce:.09,nitrogen:.3,vapor:.0015},gravity:1},
 {name:'glass reheating',t:1900,values:{glass:10,nitrogen:.3},gravity:1},
 {name:'viscous silica transport',t:1800,values:{nitrogen:.3},gravity:1,localized:'molten'},
 {name:'consumer fatal heat',t:1000,values:{soil:10,plant:5,herbivore:2,carnivore:1,water:.3,nitrogen:.3},gravity:1},
 {name:'cloud shaded ecology',t:22,values:{soil:10,plant:5,herbivore:2,carnivore:1,water:.3,nitrogen:.3,cloud:.1},gravity:1,sunlight:.4},
 {name:'weak gravity methane',t:20,values:{rock:8,methane:3,nitrogen:.3},gravity:.01},
 {name:'hot weak gravity mixture',t:750,values:{rock:8,methane:3,nitrogen:.3,carbonDioxide:.3},gravity:.03},
 {name:'external bath cooling',t:300,ambient:20,values:{rock:8},gravity:1},
 {name:'iron heat conduction',t:20,values:{iron:4,nitrogen:.3},gravity:1,localized:'temperature'}];
 const result=[];
 for(const fixture of cases){
  const state=new Float32Array(g.count*STRIDE);for(let i=0;i<g.count;i++){state[i*STRIDE+F.temperature]=fixture.t;for(const [name,mass] of Object.entries(fixture.values))state[i*STRIDE+F[name as keyof typeof F]]=mass!;}
  if('localized' in fixture)state[F[fixture.localized as keyof typeof F]]=fixture.localized==='temperature'?300:10;
  const cpu=new CpuSolver(g,state.slice()),gpu=await GpuSolver.create(g,state.slice());if(!gpu)return {supported:false};
  const env={ambient:fixture.ambient??fixture.t,sunlight:fixture.sunlight??0,sun:[1,0,0],gravity:fixture.gravity??3},empty=new Float32Array(g.count*COMMAND_STRIDE);let cpuQ=0,gpuQ=0;
  for(let k=0;k<30;k++){const dt=fixture.name==='paused no-op'?0:PHYSICS_DT;cpu.advance(dt,empty,env);await gpu.step(dt,empty,env);cpuQ+=cpu.energyChanges.reduce((a,b)=>a+b,0);gpuQ+=gpu.energyChanges.reduce((a,b)=>a+b,0);}
  let error=0,errorField='none',maxTemperatureError=0,maxMassRelativeError=0,maxFiringError=0;
  for(let i=0;i<state.length;i++){
   const delta=Math.abs(cpu.state[i]-gpu.state[i]),field=i%STRIDE;
   if(delta>error){error=delta;errorField=Object.keys(F).find(name=>F[name as keyof typeof F]===field)!;}
   if(field===F.temperature)maxTemperatureError=Math.max(maxTemperatureError,delta);
   else if(field===F.firing)maxFiringError=Math.max(maxFiringError,delta);
   else maxMassRelativeError=Math.max(maxMassRelativeError,delta/Math.max(1,Math.abs(cpu.state[i])));
  }
  result.push({name:fixture.name,maxError:error,errorField,maxTemperatureError,maxMassRelativeError,maxFiringError,finite:cpu.state.every(Number.isFinite)&&gpu.state.every(Number.isFinite),massError:totalMass(gpu.state)-totalMass(cpu.state),cpuEnergyResidual:totalEnthalpy(cpu.state)-totalEnthalpy(state)-cpuQ,gpuEnergyResidual:totalEnthalpy(gpu.state)-totalEnthalpy(state)-gpuQ,initialEnergy:totalEnthalpy(state),initialMass:totalMass(state),changedSlots:fixture.name==='paused no-op'?gpu.state.filter((v,i)=>v!==state[i]).length:undefined});gpu.dispose();
 }
 const tolerances={temperature:.003,firing:.0001,massCellRelative:1e-5,massRelative:1e-6,energyRelative:1e-5};
 const checked=result.map(row=>({...row,passed:row.finite&&row.maxTemperatureError<=tolerances.temperature&&row.maxFiringError<=tolerances.firing&&row.maxMassRelativeError<=tolerances.massCellRelative&&Math.abs(row.massError)/Math.max(1,row.initialMass)<=tolerances.massRelative&&Math.abs(row.gpuEnergyResidual)/Math.max(1,Math.abs(row.initialEnergy))<=tolerances.energyRelative&&(row.name!=='paused no-op'||row.changedSlots===0&&row.gpuEnergyResidual===0)}));
 return {supported:true,passed:checked.every(row=>row.passed),tolerances,cases:checked};
}
node('verify').onclick=async()=>{node('verify').disabled=true;try{const result=await verifyGpu();document.querySelector('output')!.textContent=JSON.stringify(result,null,2);}finally{node('verify').disabled=false;}};
Object.assign(window,{sectionLab:{verifyGpu,stats:()=>({time,paused,poured,mass:totalMass(solver.state),energy:totalEnthalpy(solver.state),atmosphere:atmosphereState(solver.state,e),latestEscape:solver.escapeCells.reduce((a,b)=>a+b,0),latestEnergy:[0,1,2,3].map(k=>solver.energyChanges.reduce((a,b,i)=>a+(i%4===k?b:0),0)),visual:view.visualStats(),ready:view.scene.isReady(),pick:(x:number,y:number)=>view.pick(x,y)}),state:()=>solver.state.slice(),totals:()=>Object.fromEntries(['water','ice','vapor','cloud','cloudIce','glass','molten','plant','herbivore'].map(name=>[name,solver.state.reduce((sum,v,i)=>sum+(i%STRIDE===F[name as keyof typeof F]?v:0),0)])),view}});
