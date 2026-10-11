import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import {Viewport} from '@babylonjs/core/Maths/math.viewport';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {PlanetView} from '../src/render/planet';
import type {SectionProjection} from '../src/render/sectionProjection';
import {CpuSolver,applyCommand,COMMAND_STRIDE,F,STRIDE,totalMass,type Environment} from '../src/sim/model';
import {RADIUS,type SphereGrid} from '../src/sim/sphere';
/** Paused, disposable browser fixture: real pointer → physical falling → command → render. */
export async function verifyPowderEditing(view:PlanetView,grid:SphereGrid,initial:Float32Array){
 const solver=new CpuSolver(grid,initial.slice()),e:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:false};
 view.setEnvironment(e);view.setClimate('none',solver.climate);view.update(solver.state,0,e);view.frameSection('surface');view.setSectionMagnification(4);
 await new Promise<void>(resolve=>{const start=performance.now();function frame(){if(performance.now()-start>650)resolve();else requestAnimationFrame(frame);}frame();});
 const internals=view as unknown as {root:TransformNode;sectionProjection:SectionProjection},projection=internals.sectionProjection;
 const flat=projection.v.scale(RADIUS+projection.displayDepth(projection.stackDepth)+.3),world=Vector3.TransformCoordinates(flat,internals.root.getWorldMatrix());
 const pixel=Vector3.Project(world,Matrix.Identity(),view.scene.getTransformMatrix(),new Viewport(0,0,view.canvas.clientWidth,view.canvas.clientHeight)),pick=view.pick(pixel.x,pixel.y);
 if(!pick?.inAir||!pick.emitter)return {passed:false,reason:'air supply target unavailable'};
 const commands=new Float32Array(grid.count*COMMAND_STRIDE),mass=totalMass(solver.state);let landed=0;
 view.emit(pick.index,'sand',2,(i,amount)=>{commands[i*COMMAND_STRIDE+1]+=amount;landed+=amount;},pick.direction,pick.index,pick.emitter,true);
 let escaped=0;for(let n=0;n<120;n++){view.stepPhysics(1/30);solver.advance(1/30,commands,e);escaped+=solver.escapeCells.reduce((sum,v)=>sum+v,0);commands.fill(0);view.update(solver.state,1/30,e);}
 const suppliedMass=totalMass(solver.state)-mass,massBudgetError=Math.abs(suppliedMass+escaped-2),stock=solver.state.slice(),owner=pick.index,rock=solver.state[owner*STRIDE+F.rock];
 commands[owner*COMMAND_STRIDE+5]=.5;commands[owner*COMMAND_STRIDE+7]=1;applyCommand(solver.state,owner,commands);view.update(solver.state,0,e);
 const erased=totalMass(stock)-totalMass(solver.state),rockPreserved=solver.state[owner*STRIDE+F.rock]===rock;
 const mesh=view.scene.getMeshByName('live material cross section')!,data=mesh.getVerticesData('powder0')??[],rendered=mesh.isEnabled()&&data.length>0&&data.every(Number.isFinite);
 const result={passed:landed===2&&massBudgetError<.005&&erased>0&&rockPreserved&&rendered,landed,suppliedMass,escaped,massBudgetError,erased,rockPreserved,rendered,grainsLeft:view.deposits().filter(g=>g.amount>0).length};
 view.clearGrains();view.update(initial,0,e);return result;
}

export async function verifySurfaceEraseGpu(){
 const {GpuSolver}=await import('../src/sim/gpu'),{createSphere}=await import('../src/sim/sphere'),grid=createSphere(1),s=new Float32Array(grid.count*STRIDE);
 for(let i=0;i<grid.count;i++){const p=i*STRIDE;s[p+F.temperature]=22;s[p+F.rock]=8;s[p+F.sand]=4;s[p+F.water]=2;s[p+F.nitrogen]=.3;s[p+F.cloud]=.1;s[p+F.seed]=.02;}
 const cpu=new CpuSolver(grid,s.slice()),gpu=await GpuSolver.create(grid,s.slice());if(!gpu)return {supported:false};
 try{const commands=new Float32Array(grid.count*COMMAND_STRIDE);for(let i=0;i<grid.count;i++){commands[i*COMMAND_STRIDE+5]=.5;commands[i*COMMAND_STRIDE+7]=1;}
 const e={ambient:22,sunlight:0,sun:[1,0,0],gravity:1,climate:false};cpu.advance(1/30,commands,e);await gpu.step(1/30,commands,e);
 let maxTemperatureError=0,maxMassError=0;for(let i=0;i<s.length;i++){const d=Math.abs(cpu.state[i]-gpu.state[i]);if(i%STRIDE===F.temperature)maxTemperatureError=Math.max(maxTemperatureError,d);else maxMassError=Math.max(maxMassError,d);}
 const saved=JSON.parse(JSON.stringify({state:[...gpu.state],climate:gpu.climate.snapshot()})),resumed=new CpuSolver(grid,new Float32Array(saved.state));resumed.climate.restore(saved.climate);
 const resumeExact=resumed.state.every((v,i)=>v===gpu.state[i]),empty=new Float32Array(commands.length);let maxResumeError=0;
 for(let step=0;step<30;step++){resumed.advance(1/30,empty,e);await gpu.step(1/30,empty,e);for(let i=0;i<s.length;i++)maxResumeError=Math.max(maxResumeError,Math.abs(resumed.state[i]-gpu.state[i]));}
 const rockPreserved=gpu.state.every((v,i)=>i%STRIDE!==F.rock||v===8),result={supported:true,maxTemperatureError,maxMassError,rockPreserved,massError:Math.abs(totalMass(resumed.state)-totalMass(gpu.state)),resumeExact,maxResumeError};
 return {...result,passed:resumeExact&&maxResumeError<.003&&rockPreserved&&maxTemperatureError<.003&&maxMassError<1e-5&&result.massError<.005};
 }finally{gpu.dispose();}
}
