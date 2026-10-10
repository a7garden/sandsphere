import type {PlanetView} from '../src/render/planet';
import type {SphereGrid} from '../src/sim/sphere';
import {PHYSICS_DT} from '../src/sim/clock';

/** Run in the paused section-lab browser fixture, against its real GPU meshes. */
export async function verifySectionPrecipitation(view:PlanetView,grid:SphereGrid,state:()=>Float32Array){
 const initial=state(),canvas=view.engine.getRenderingCanvas();
 const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
 const draw=async()=>{await frame();await frame();};
 const cap=()=>view.scene.getMeshByName('live material cross section')!;
 const values=()=>({data:Array.from(cap().getVerticesData('sectionData')!),snow:Array.from(cap().getVerticesData('snowFraction')!)});
 const phases=new Float32Array(grid.count*2);
 for(let i=0;i<grid.count;i++)phases[i*2+(i%2)]=.005;
 view.setPrecipitationLayer(true);view.showRain(phases,PHYSICS_DT);view.update(state(),0);await draw();
 const phase=values(),rainVertices=phase.snow.filter((f,i)=>f===0&&phase.data[i*4+3]>0).length,snowVertices=phase.snow.filter((f,i)=>f===1&&phase.data[i*4+3]>0).length;
 view.showRain(new Float32Array(phases.length),0);view.update(state(),0);await draw();
 const paused=values(),pausedRetained=JSON.stringify(phase)===JSON.stringify(paused);
 view.clearPrecipitation();view.update(state(),0);await draw();
 const cleared=values(),clearZero=cleared.data.every((v,i)=>i%4!==3||v===0)&&cleared.snow.every(v=>v===0)&&view.precipitationStats().highlightedCells===0;
 view.setPrecipitationLayer(false);view.showRain(phases,PHYSICS_DT);view.clearPrecipitation();view.update(state(),0);view.setPrecipitationLayer(true);await draw();
 const hidden=values(),hiddenClearZero=hidden.data.every((v,i)=>i%4!==3||v===0)&&hidden.snow.every(v=>v===0)&&view.precipitationStats().highlightedCells===0;
 view.setSection(false);for(let i=0;i<120&&view.visualStats().section.amount>0;i++)await frame();
 const globeReached=view.visualStats().section.amount===0;
 view.setSection(true,0);for(let i=0;i<120&&view.visualStats().section.amount<1;i++)await frame();
 const sectionReached=view.visualStats().section.amount===1,sameCanvas=view.engine.getRenderingCanvas()===canvas,stateUnchanged=state().every((v,i)=>v===initial[i]),ready=view.scene.isReady();
 return {passed:rainVertices>0&&snowVertices>0&&pausedRetained&&clearZero&&hiddenClearZero&&globeReached&&sectionReached&&sameCanvas&&stateUnchanged&&ready,rainVertices,snowVertices,pausedRetained,clearZero,hiddenClearZero,globeReached,sectionReached,sameCanvas,stateUnchanged,ready};
}
