/** Reproducible renderer benchmark; never reads or writes application saves. */
import {PlanetView} from '../src/render/planet';
import {createSphere,cellBrushWeights} from '../src/sim/sphere';
import {seedPlanet,DEFAULT_ENVIRONMENT} from '../src/sim/model';
import {PHYSICS_DT} from '../src/sim/clock';
import {verifyPowderEditing} from './powder-section-editing';

const grid=createSphere(4),state=seedPlanet(grid,'sand',22);
const canvas=document.querySelector('canvas')!,button=document.querySelector('button')!,output=document.querySelector('output')!;
const view=await PlanetView.create(canvas,grid,state);
view.setEnvironment(DEFAULT_ENVIRONMENT);view.setSpin(0,false,0);view.setLayers(false,false);view.orbitMode(false);
let measuring=false,ready=false;
document.querySelector<HTMLButtonElement>('#air-check')!.onclick=async e=>{
 const airButton=e.currentTarget as HTMLButtonElement;airButton.disabled=true;button.disabled=true;
 try{
  view.clearGrains();view.setSection(true,0);view.animate(1);view.scene.render();
  output.textContent=JSON.stringify(await verifyPowderEditing(view,grid,state),null,2);
 }catch(error){output.textContent=String(error);}finally{airButton.disabled=false;button.disabled=false;}
};
view.engine.runRenderLoop(()=>{if(!measuring){view.animate(1/60);view.scene.render();}if(!ready&&view.scene.isReady()){ready=true;button.disabled=false;output.textContent='준비 완료 · 저장 데이터와 분리된 모래 행성';}});
button.onclick=async()=>{
 measuring=true;button.disabled=true;view.clearGrains();
 const x=canvas.clientWidth/2,y=canvas.clientHeight/2,hit=view.pick(x,y);
 if(!hit)throw new Error('No surface at benchmark center');
 if(new URLSearchParams(location.search).get('section')==='1'){view.setSection(true,hit.index);view.animate(1);view.scene.render();}
 const cells=cellBrushWeights(grid,hit.index,5);
 let supplied=0,landed=0;
 const land=(_cell:number,mass:number)=>{landed+=mass;};
 const legacy=document.querySelector<HTMLInputElement>('#legacy')!.checked;
 const times:Record<string,number[]>={pick:[],physics:[],supply:[],animate:[],render:[]};
 const measure=(name:string,action:()=>void)=>{const start=performance.now();action();times[name].push(performance.now()-start);};
 // Warm the renderer and measure the same large brush for 120 fixed steps.
 for(let frame=0;frame<120;frame++){
  measure('pick',()=>{view.pick(x,y);});
  measure('physics',()=>{view.stepPhysics(PHYSICS_DT);});
  measure('supply',()=>{
    const amount=200*PHYSICS_DT;supplied+=amount;
    if(legacy)for(const {index,weight} of cells)view.emit(index,'sand',amount*weight,land,undefined,index,undefined,true);
    else view.supplySurface(cells,'sand',amount,land);
  });
  measure('animate',()=>view.animate(PHYSICS_DT));
  measure('render',()=>view.scene.render());
  await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
 }
 const summarize=(samples:number[])=>{const sorted=samples.slice(20).sort((a,b)=>a-b);return {meanMs:+(sorted.reduce((a,b)=>a+b,0)/sorted.length).toFixed(3),p95Ms:+sorted[Math.floor(sorted.length*.95)].toFixed(3)};};
 const inFlight=view.deposits().reduce((sum,g)=>sum+g.amount,0),escaped=view.takeEscapedGrains();
 const result={legacy,section:view.isSection,cells:cells.length,grains:view.deposits().length,supplyTraces:view.visualStats().supplyTraces,timings:Object.fromEntries(Object.entries(times).map(([name,samples])=>[name,summarize(samples)])),massError:Math.abs(supplied-landed-inFlight-escaped)};
 output.textContent=JSON.stringify(result,null,2);button.disabled=false;measuring=false;
};
