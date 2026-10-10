/** Local visual regression fixture, isolated from the application's saves. */
import type {CloudStyle} from '../src/render/cloudBanks';
import {PlanetView} from '../src/render/planet';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,seedPlanet,seedWorld,totals} from '../src/sim/model';
import {orbitalEnvironment} from '../src/sim/orbit';
const grid=createSphere(4),environment=orbitalEnvironment(1);
const kinds=['모래','점토','식생','구름','해안','빙결','풍경'] as const;
let cloudStyle:CloudStyle='faceted',cloudPreset='translucent';
let selected:string='풍경',faceted=true,hexagonal=true,blended=1,refinement=0;
function fixture(kind:string){
 const s=kind==='구름'||kind==='해안'||kind==='빙결'||kind==='풍경'?seedWorld(grid):seedPlanet(grid,kind==='점토'?'clay':kind==='식생'?'rock':'sand',22);
 for(let i=0;i<grid.count;i++){
  const p=i*STRIDE,x=grid.directions[i*3],y=grid.directions[i*3+1],z=grid.directions[i*3+2];
  if(kind==='빙결'){s[p+F.ice]=s[p+F.water];s[p+F.water]=0;s[p+F.temperature]=-20;}
  if(kind==='식생'){
   const cover=Math.max(0,Math.min(1,(Math.sin(x*5+y*3)+Math.sin(z*4-x*3))*.36+.5));
   s[p+F.soil]=3;s[p+F.plant]=cover*1.4;s[p+F.water]=.025;
  }
  if(kind==='풍경'&&s[p+F.water]<.025){const cover=Math.max(0,Math.sin(x*5+y*3)+Math.cos(z*6-x*2));s[p+F.soil]=cover*1.5;s[p+F.plant]=cover*.8;}
  if(kind==='구름'||kind==='풍경'){
   const cloud=Math.max(0,(Math.sin(x*5+y*7)+Math.cos(z*7-x*3))*.16+.06);
   s[p+F.cloud]=cloud;s[p+F.cloudIce]=cloud*.15;
  }
 }
 return s;
}
let view=await PlanetView.create(document.querySelector('canvas')!,grid,fixture(selected));
function show(kind:string){selected=kind;document.querySelector('output')!.textContent=kind+' · 검수 장면';view.setEnvironment(environment);view.setSpin(0,false,0);view.update(fixture(kind),0,environment);view.setSun([.7,.45,-.55]);const clouds=(document.querySelector('#lab-clouds') as HTMLInputElement).checked;view.setLayers(kind==='구름'||kind==='풍경',clouds);view.setSurfaceStyle(faceted,blended,hexagonal);view.setCloudStyle(cloudStyle);view.setCloudAppearance(cloudPreset!=='original',cloudPreset==='translucent'?.84:1);view.home();view.camera.radius=17.0;view.setTime(30);document.querySelectorAll('nav[aria-label="재질 비교"] button').forEach(b=>b.setAttribute('aria-pressed',String(b.textContent===kind)));}
for(const name of kinds){const button=document.createElement('button');button.textContent=name;button.onclick=()=>show(name);document.querySelector('nav[aria-label="재질 비교"]')!.append(button);}
function style(){
 view.setSurfaceStyle(faceted,blended,hexagonal);
 document.querySelectorAll<HTMLButtonElement>('[data-surface]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.surface===(hexagonal?'hexagonal':faceted?'faceted':'smooth'))));
 document.querySelectorAll<HTMLButtonElement>('[data-boundary]').forEach(b=>b.setAttribute('aria-pressed',String(({sharp:0,soft:.28,blend:1}[b.dataset.boundary!]===blended))));
}
document.querySelectorAll<HTMLButtonElement>('[data-surface]').forEach(b=>b.onclick=()=>{hexagonal=b.dataset.surface==='hexagonal';faceted=b.dataset.surface!=='smooth';style();});
document.querySelectorAll<HTMLButtonElement>('[data-boundary]').forEach(b=>b.onclick=()=>{blended={sharp:0,soft:.28,blend:1}[b.dataset.boundary!]!;style();});
document.querySelectorAll<HTMLButtonElement>('[data-cloud-style]').forEach(button=>button.onclick=()=>{
 cloudStyle=button.dataset.cloudStyle as CloudStyle;view.setCloudStyle(cloudStyle);
 (document.querySelector('#lab-clouds') as HTMLInputElement).checked=true;view.setLayers(selected==='구름'||selected==='풍경',true);
 document.querySelectorAll<HTMLButtonElement>('[data-cloud-style]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cloudStyle===cloudStyle)));
});
document.querySelectorAll<HTMLButtonElement>('[data-cloud-preset]').forEach(button=>button.onclick=()=>{
 cloudPreset=button.dataset.cloudPreset!;cloudStyle='faceted';view.setCloudStyle(cloudStyle);view.setCloudAppearance(cloudPreset!=='original',cloudPreset==='translucent'?.84:1);
 (document.querySelector('#lab-clouds') as HTMLInputElement).checked=true;view.setLayers(selected==='구름'||selected==='풍경',true);
 document.querySelectorAll<HTMLButtonElement>('[data-cloud-style]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cloudStyle===cloudStyle)));
 document.querySelectorAll<HTMLButtonElement>('[data-cloud-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cloudPreset===cloudPreset)));
});
document.querySelector<HTMLInputElement>('#lab-clouds')!.onchange=e=>view.setLayers(selected==='구름'||selected==='풍경',(e.target as HTMLInputElement).checked);
show(selected);style();
function startRendering(){
 const active=view;
 let frames=0,last=performance.now();active.engine.runRenderLoop(()=>{active.animate(1/60);active.scene.render();frames++;if(performance.now()-last>1000){document.querySelector('output')!.textContent=selected+' · '+active.visualStats().renderTiles.toLocaleString()+' 타일 · '+Math.round(frames*1000/(performance.now()-last))+' fps · '+active.engine.constructor.name;frames=0;last=performance.now();}});
}
function sizeUI(){document.querySelectorAll<HTMLButtonElement>('[data-refinement]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.refinement)===refinement)));}
document.querySelectorAll<HTMLButtonElement>('[data-refinement]').forEach(button=>button.onclick=async()=>{
 const next=Number(button.dataset.refinement);if(next===refinement)return;
 const camera=[view.camera.alpha,view.camera.beta,view.camera.radius];
 document.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input').forEach(b=>b.disabled=true);
 document.querySelector('output')!.textContent='표시용 타일 생성 중…';
 async function rebuild(level:number){
  view.dispose();const canvas=document.querySelector('canvas')!,replacement=canvas.cloneNode() as HTMLCanvasElement;canvas.replaceWith(replacement);
  view=await PlanetView.create(replacement,grid,fixture(selected),level);refinement=level;show(selected);style();
  [view.camera.alpha,view.camera.beta,view.camera.radius]=camera;startRendering();
 }
 try{await rebuild(next);}catch(error){console.error('Tile refinement failed',error);await rebuild(0);}
 finally{sizeUI();document.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input').forEach(b=>b.disabled=false);}
});
startRendering();

Object.assign(window,{renderLab:{setSun:(direction:[number,number,number])=>view.setSun(direction),stats:()=>({selected,faceted,hexagonal,blended,refinement,camera:[view.camera.alpha,view.camera.beta,view.camera.radius],visual:view.visualStats(),meshNames:view.scene.meshes.map(m=>m.name),engine:view.engine.constructor.name,sceneReady:view.scene.isReady(),totals:[...totals(fixture(selected))]})}});
