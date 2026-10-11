import './ui/cloudComparison.css';
import {PlanetView} from './render/planet';
import type {CloudStyle} from './render/cloudProfiles';
import {createSphere} from './sim/sphere';
import {F,STRIDE,seedWorld,totals,type Environment} from './sim/model';
import {orbitalEnvironment} from './sim/orbit';
import {loadRecord,upgradeSnapshot} from './sim/storage';
import {validSystem} from './sim/system';
import {currentLocale,setupLocalization,translatePhrase} from './ui/i18n';

setupLocalization({selector:'#cloud-language',root:'body',title:{ko:'Sandsphere · 구름 3안 비교',en:'Sandsphere · Compare three cloud styles'}});

const grid=createSphere(4),styles:CloudStyle[]=['stratus','cumulus','faceted'],views:PlanetView[]=[];
const status=document.querySelector<HTMLOutputElement>('#status')!,main=document.querySelector<HTMLElement>('main')!;
const air=document.querySelector<HTMLInputElement>('#air')!;
let master=0,saved:{state:Float32Array;environment:Environment;name:string}|null=null;
let source='mixed',ready=false;
function fixture(kind:string){
 const state=seedWorld(grid);
 for(let i=0;i<grid.count;i++){
  const [x,y,z]=grid.directions.subarray(i*3,i*3+3),p=i*STRIDE;
  const mass=kind==='dense'?.6:Math.max(0,(Math.sin(x*5+y*7)+Math.cos(z*7-x*3))*.16+.06)*(kind==='thin'?.35:1);
  state[p+F.cloud]=mass;state[p+F.cloudIce]=mass*.15;
 }
 return state;
}
function data(){return source==='saved'&&saved?saved:{state:fixture(source),environment:orbitalEnvironment(1),name:({mixed:'지역별 구름',thin:'적은 구름',dense:'많은 구름'} as Record<string,string>)[source]};}
function update(){
 const current=data(),stock=totals(current.state),mass=stock[F.cloud]+stock[F.cloudIce];
 for(let i=0;i<views.length;i++){
  const view=views[i];view.setEnvironment(current.environment);view.update(current.state,0,current.environment);view.setSpin(0,false,0);view.setTime(30);
  view.setSun([.7,.45,-.55]);view.setCloudAppearance(true,.84);view.setCloudStyle(styles[i]);view.setAxisVisible(false);view.setLayers(air.checked,true);view.setSurfaceStyle(true,1,true);view.animate(.2,0);
 }
 document.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.source===source)));
 const name=document.createElement('span');name.textContent=source==='saved'?current.name:translatePhrase(current.name);name.translate=source!=='saved';
 status.replaceChildren(name, currentLocale()==='en'?` · Cloud water and ice ${mass.toFixed(1)} kg · Simulation paused`:` · 구름 물·얼음 ${mass.toFixed(1)} kg · 계산 정지`);
}
function reset(){for(const view of views){view.home();view.camera.radius=17;view.camera.alpha=-1.01;view.camera.beta=1.17;}master=0;}
function focus(style?:string){if(style)main.dataset.focus=style;else delete main.dataset.focus;document.querySelector<HTMLButtonElement>('#all')!.hidden=!style;}
async function start(){
 try{
  const record=await loadRecord('latest-system');
  if(validSystem(record,grid.count)){const planet=record.planets.find(p=>p.id===record.activeId)!,snapshot=upgradeSnapshot(planet.snapshot,grid.count);saved={state:new Float32Array(snapshot.state),environment:{...snapshot.environment},name:planet.name};}
 }catch{ /* The fixture comparison remains available if there is no local save. */ }
 // Create contexts sequentially; they all receive independent copies of the same stock.
 for(let i=0;i<styles.length;i++){
  const canvas=document.querySelector<HTMLCanvasElement>(`[data-look=${styles[i]}] canvas`)!;
  const view=await PlanetView.create(canvas,grid,new Float32Array(data().state));views.push(view);view.orbitMode(true);view.scene.particlesEnabled=false;
  view.canvas.tabIndex=0;view.canvas.addEventListener('pointerdown',()=>master=i);view.canvas.addEventListener('wheel',()=>master=i,{passive:true});view.canvas.addEventListener('focus',()=>master=i);
  view.engine.runRenderLoop(()=>{
   if(!ready||document.hidden||view.canvas.clientWidth===0)return;
   if(i!==master){const camera=views[master].camera;view.camera.inertialAlphaOffset=0;view.camera.inertialBetaOffset=0;view.camera.inertialRadiusOffset=0;view.camera.alpha=camera.alpha;view.camera.beta=camera.beta;view.camera.radius=camera.radius;}
   view.animate(0,0);view.scene.render();
  });
 }
 update();reset();ready=true;
 await Promise.all(views.map(view=>new Promise<void>(resolve=>view.onReady(resolve))));
 document.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input').forEach(b=>b.disabled=false);
 document.querySelector<HTMLButtonElement>('[data-source=saved]')!.disabled=!saved;
}
window.addEventListener('sandsphere-language-change',update);
document.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(b=>b.onclick=()=>{source=b.dataset.source!;update();});
document.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach(b=>b.onclick=()=>focus(b.dataset.focus));
document.querySelector<HTMLButtonElement>('#all')!.onclick=()=>focus();document.querySelector<HTMLButtonElement>('#reset')!.onclick=reset;air.onchange=()=>update();
window.addEventListener('pagehide',()=>views.forEach(v=>v.dispose()),{once:true});
void start().catch(error=>{console.error(error);status.textContent='비교 화면을 준비하지 못했습니다. 새로고침해 주세요.';});
if(import.meta.env.DEV)Object.assign(window,{cloudComparison:{stats:()=>({ready,source,styles:views.map(v=>v.visualStats().cloudStyle),masses:views.map(v=>v.visualStats().cloudRenderedMass),cameras:views.map(v=>[v.camera.alpha,v.camera.beta,v.camera.radius])})}});
