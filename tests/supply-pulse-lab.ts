/** Disposable visual/performance fixture; never touches application saves. */
import {PlanetView} from '../src/render/planet';
import {createSphere,cellBrushWeights} from '../src/sim/sphere';
import {seedWorld,type SurfaceMaterial} from '../src/sim/model';
import {SceneInstrumentation} from '@babylonjs/core/Instrumentation/sceneInstrumentation';
const grid=createSphere(4),state=seedWorld(grid),canvas=document.querySelector('canvas')!,view=await PlanetView.create(canvas,grid,state);
view.setSurfaceStyle(true,1,true);view.setLayers(false,false);view.setSpin(0,false);view.setSun([.6,.7,-.7]);view.orbitMode(false);
const instrument=new SceneInstrumentation(view.scene),button=document.querySelector('button')!,output=document.querySelector('output')!,checkbox=document.querySelector<HTMLInputElement>('#supply')!,material=document.querySelector('select')!;
const cells=cellBrushWeights(grid,view.pick(canvas.clientWidth/2,canvas.clientHeight/2)!.index,5);
const emit=()=>view.supplySurface(cells,material.value as SurfaceMaterial,200/30,()=>{});
const summary=(values:number[])=>{const a=values.slice(10).sort((a,b)=>a-b);return {meanMs:+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(3),p95Ms:+a[Math.floor(a.length*.95)].toFixed(3)};};
type Row={effect:boolean;cpu:ReturnType<typeof summary>;render:ReturnType<typeof summary>;frame:ReturnType<typeof summary>;drawCalls:number;longFrames:number};
type Measurement={stage:0|1|2;n:number;previous:number;cpu:number[];render:number[];frame:number[];draws:number[];rows:Row[];meshes:number;fadeUploads:number};
let measuring:Measurement|null=null,ready=false,clock=0,last=performance.now();
// Render exactly once inside the engine's frame: WebGPU swap-chain textures
// cannot be reused by an async benchmark that draws outside this render loop.
view.engine.runRenderLoop(()=>{
 const now=performance.now(),dt=Math.min(.05,(now-last)/1000);last=now;clock+=dt;
 const m=measuring,start=performance.now();
 if(m){if(m.stage===1&&m.n%2===0)emit();view.animate(1/60);m.cpu.push(performance.now()-start);}
 else{if(checkbox.checked&&clock>=1/30){emit();clock=0;}view.animate(dt);}
 const draw=performance.now();view.scene.render();
 if(!ready&&view.scene.isReady()){ready=true;button.disabled=false;output.textContent='91-cell brush · no falling particles';}
 if(!m)return;
 m.render.push(performance.now()-draw);m.frame.push(now-m.previous);m.previous=now;m.draws.push(instrument.drawCallsCounter.current);m.n++;
 if(m.stage===2&&m.n>=20){
  const faded=view.visualStats().supplyPulse;
  output.textContent=JSON.stringify({renderer:view.engine.constructor.name,cells:cells.length,rows:m.rows,extraMeshes:view.scene.meshes.length-m.meshes,grains:view.deposits().length,fadedCells:faded.activeCells,fadeUploads:faded.uploads-m.fadeUploads,textureBytes:faded.bytes},null,2);
  measuring=null;button.disabled=false;clock=0;
 }else if(m.stage<2&&m.n>=100){
  m.rows.push({effect:m.stage===1,cpu:summary(m.cpu),render:summary(m.render),frame:summary(m.frame),drawCalls:Math.max(...m.draws),longFrames:m.frame.slice(10).filter(t=>t>50).length});
  m.stage=m.stage===0?1:2;m.n=0;m.cpu=[];m.render=[];m.frame=[];m.draws=[];
  if(m.stage===1)view.clearGrains();else m.fadeUploads=view.visualStats().supplyPulse.uploads;
 }
});
button.onclick=()=>{
 button.disabled=true;view.clearGrains();output.textContent='Comparing idle and continuous 91-cell supply...';
 measuring={stage:0,n:0,previous:performance.now(),cpu:[],render:[],frame:[],draws:[],rows:[],meshes:view.scene.meshes.length,fadeUploads:0};
};
