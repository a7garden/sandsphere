/** Real application mesh refresh, including wet coasts, atmosphere and forests. No saves. */
import {PlanetView} from '../src/render/planet';
import {createSphere,cellBrushWeights} from '../src/sim/sphere';
import {F,STRIDE,seedWorld} from '../src/sim/model';
const grid=createSphere(4),state=seedWorld(grid),environment={ambient:22,sunlight:1,sun:[-.5,.7,-.6],gravity:1};
for(let i=0;i<grid.count;i++){const p=i*STRIDE;state[p+F.soil]=2;state[p+F.plant]=state[p+F.water]<.2?.4:0;state[p+F.cloud]=.12;}
// A local, ignored source snapshot can be supplied for a before/after audit.
const referenceUrl=new URLSearchParams(location.search).get('reference')==='1'?'/artifacts/surface-performance/planet-before.ts':null;
const Renderer=referenceUrl?(await import(/* @vite-ignore */referenceUrl)).PlanetView:PlanetView;
const view:PlanetView=await Renderer.create(document.querySelector('canvas')!,grid,state);
view.setSurfaceStyle(true,1,true);view.setEnvironment(environment);view.setCloudStyle('stratus');view.setSpin(0,false,0);
const button=document.querySelector('button')!,output=document.querySelector('output')!;
let measuring=false,ready=false;view.engine.runRenderLoop(()=>{if(!measuring){view.animate(1/60);view.scene.render();}if(!ready&&view.scene.isReady()){ready=true;button.disabled=false;}});
button.onclick=async()=>{
 measuring=true;button.disabled=true;const update:number[]=[],render:number[]=[],frame:number[]=[],pour=document.querySelector<HTMLInputElement>('#pour')!.checked,cells=cellBrushWeights(grid,100,5);let last=performance.now();
 for(let n=0;n<90;n++){
  // Temperature changes exercise appearance without changing terrain geometry.
  state[(n%grid.count)*STRIDE+F.temperature]+=.001;
  if(pour)for(const {index,weight} of cells)state[index*STRIDE+F.sand]+=80/30*weight;
  const start=performance.now();view.update(state,1/15,environment);update.push(performance.now()-start);
  view.animate(1/60);const draw=performance.now();view.scene.render();render.push(performance.now()-draw);
  await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const now=performance.now();frame.push(now-last);last=now;
 }
 const summary=(all:number[])=>{const a=all.slice(10).sort((a,b)=>a-b);return {meanMs:+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(3),p95Ms:+a[Math.floor(a.length*.95)].toFixed(3)};};
 output.textContent=JSON.stringify({reference:!!referenceUrl,pouring:pour,cells:grid.count,refresh:summary(update),render:summary(render),frame:summary(frame),longFrames:frame.slice(10).filter(t=>t>50).length},null,2);measuring=false;button.disabled=false;
};
