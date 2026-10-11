import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import {Viewport} from '@babylonjs/core/Maths/math.viewport';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {PlanetView} from '../src/render/planet';
import type {SectionProjection} from '../src/render/sectionProjection';
import {CpuSolver,applyCommand,COMMAND_STRIDE,F,STRIDE,totalMass,type Environment} from '../src/sim/model';
import type {SphereGrid} from '../src/sim/sphere';
import {RADIUS} from '../src/sim/sphere';

const settle=()=>new Promise<void>(resolve=>{const t=performance.now();const frame=()=>performance.now()-t>700?resolve():requestAnimationFrame(frame);frame();});
/** Run on the paused, disposable fixture after the actual A/B drag and Open button. */
export async function verifySelectedSection(view:PlanetView,grid:SphereGrid,initial:Float32Array){
 const selected=view.sectionSelection.cells,allowed=new Set(selected),before=initial.slice(),engine=view.engine.constructor.name,scene=view.scene,canvas=view.canvas;
 const solver=new CpuSolver(grid,initial.slice()),e:Environment={ambient:22,sunlight:0,sun:[1,0,0],gravity:1,climate:false};
 view.setEnvironment(e);view.setClimate('none',solver.climate);view.update(solver.state,0,e);await settle();
 const internals=view as unknown as {root:TransformNode;sectionProjection:SectionProjection},projection=internals.sectionProjection,mesh=scene.getMeshByName('live material cross section')!,positions=mesh.getVerticesData('position')!,data=mesh.getVerticesData('sectionData')!;
 const screen=(p:Vector3)=>Vector3.Project(Vector3.TransformCoordinates(p,internals.root.computeWorldMatrix(true)),Matrix.Identity(),scene.getTransformMatrix(),new Viewport(0,0,canvas.clientWidth,canvas.clientHeight));
 const ids=view.visualStats().section.cellIds,ownerMatch=selected.length>0&&ids.length===selected.length&&ids.every(i=>allowed.has(i));
 let pickTests=0,pickMatches=0,subpixelSlivers=0;const mismatches:unknown[]=[];
 for(let t=0;t<data.length/12;t++)if(data[t*12+2]>0){const p=[0,1,2].map(k=>projection.forward(Vector3.FromArray(positions,t*9+k*3)));if(Vector3.Cross(p[1].subtract(p[0]),p[2].subtract(p[0])).lengthSquared()<1e-9)continue;const pixels=p.map(screen);if(Math.max(...pixels.map(v=>v.x))-Math.min(...pixels.map(v=>v.x))<.75){subpixelSlivers++;continue;}const pixel=screen(p[0].add(p[1]).add(p[2]).scale(1/3));if(pixel.x<0||pixel.x>canvas.clientWidth||pixel.y<0||pixel.y>canvas.clientHeight)continue;pickTests++;const hit=view.pick(pixel.x,pixel.y);if(hit?.index===data[t*12+1])pickMatches++;else mismatches.push({t,expected:data[t*12+1],actual:hit?.index,pixel:pixel.asArray(),points:p.map(v=>v.asArray())});}
 const airPixel=screen(projection.v.scale(RADIUS+projection.displayDepth(projection.stackDepth)+.3)),air=view.pick(airPixel.x,airPixel.y),commands=new Float32Array(grid.count*COMMAND_STRIDE),landedCells:number[]=[];
 let landed=0,escaped=0;const mass=totalMass(solver.state);
 if(air?.inAir&&air.emitter)view.emit(air.index,'sand',2,(cell,amount)=>{commands[cell*COMMAND_STRIDE+1]+=amount;landed+=amount;landedCells.push(cell);},air.direction,air.index,air.emitter,true);
 for(let step=0;step<120;step++){view.stepPhysics(1/30);solver.advance(1/30,commands,e);escaped+=solver.escapeCells.reduce((s,v)=>s+v,0);commands.fill(0);view.update(solver.state,1/30,e);}
 const budgetError=Math.abs(totalMass(solver.state)-mass+escaped-2),target=air?.index??selected[Math.floor(selected.length/2)],p=target*STRIDE,rock=solver.state[p+F.rock],preErase=solver.state.slice();
 commands[target*COMMAND_STRIDE+5]=.5;commands[target*COMMAND_STRIDE+7]=1;applyCommand(solver.state,target,commands);view.update(solver.state,0,e);
 const afterEditIds=view.visualStats().section.cellIds,editKeepsCells=afterEditIds.length===selected.length&&afterEditIds.every(i=>allowed.has(i));
 const erased=preErase[p+F.sand]-solver.state[p+F.sand],rockPreserved=solver.state[p+F.rock]===rock,edited=solver.state.slice();
 view.setSection(false);await settle();const globeExact=edited.every((v,i)=>v===solver.state[i]),selectionRetained=selected.every((v,i)=>v===view.sectionSelection.cells[i]);
 view.beginSectionSelection();view.setSection(true);await settle();const capAgain=view.visualStats().section.cellIds,sameCap=capAgain.length===selected.length&&capAgain.every(i=>allowed.has(i));
 const brushRestricted=view.sectionBrushCells(Array.from({length:grid.count},(_,i)=>i)).every(i=>allowed.has(i));
 const saved=JSON.parse(JSON.stringify({state:[...solver.state],climate:solver.climate.snapshot()})),resumed=new CpuSolver(grid,new Float32Array(saved.state));resumed.climate.restore(saved.climate);const resumeExact=resumed.state.every((v,i)=>v===solver.state[i]);
 commands.fill(0);for(let step=0;step<30;step++){solver.advance(1/30,commands,e);resumed.advance(1/30,commands,e);}const resumeContinues=resumed.state.every((v,i)=>v===solver.state[i]);
 const result={engine,selected,cap:ids,ownerMatch,pickTests,pickMatches,subpixelSlivers,mismatches,airOwner:air?.index,landed,landedCells,budgetError,erased,rockPreserved,editKeepsCells,globeExact,selectionRetained,sameCap,resumeExact,resumeContinues,brushRestricted,sameScene:scene===view.scene&&canvas===view.canvas,changed:!before.every((v,i)=>v===edited[i])};
 view.clearGrains();view.update(initial,0,e);
 return {...result,passed:ownerMatch&&pickTests>8&&pickTests===pickMatches&&landed===2&&landedCells.every(i=>allowed.has(i))&&budgetError<.005&&erased>0&&rockPreserved&&editKeepsCells&&globeExact&&selectionRetained&&sameCap&&brushRestricted&&resumeExact&&resumeContinues&&result.sameScene&&result.changed};
}

export async function verifyCellEndpointRotation(view:PlanetView,state:Float32Array){
 const before=view.sectionSelection;view.setSectionNavigation('rotate');
 for(let n=0;n<60;n++){view.turn(.006,0);view.animate(1/60);}
 view.update(state,0);await settle();const after=view.sectionSelection,cap=view.visualStats().section.cellIds;
 const slowRotationMovesCells=JSON.stringify(before.endCells)!==JSON.stringify(after.endCells),capMatches=cap.length===after.cells.length&&cap.every(i=>after.cells.includes(i));
 const endpointsPresent=!!after.endCells&&cap.includes(after.endCells.a)&&cap.includes(after.endCells.b);
 const wholeEndCells=after.windowHalfRange>after.halfRange!;
 return {passed:slowRotationMovesCells&&capMatches&&endpointsPresent&&wholeEndCells,slowRotationMovesCells,capMatches,endpointsPresent,wholeEndCells,before:before.endCells,after:after.endCells,cells:after.cells.length};
}
