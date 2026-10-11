import {PlanetView} from '../src/render/planet';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,seedWorld,CpuSolver} from '../src/sim/model';
import {SectionSelectionControls,sectionSelectionMarkup} from '../src/ui/sectionSelection';
import {verifySelectedSection,verifySectionLifecycle} from './section-selection-browser';
const grid=createSphere(3),state=seedWorld(grid);
for(let i=0;i<grid.count;i++){const p=i*STRIDE;state[p+F.temperature]=22;state[p+F.rock]=2;state[p+F.sand]=8;state[p+F.soil]=0;state[p+F.water]=0;}
const view=await PlanetView.create(document.querySelector('canvas')!,grid,state),solver=new CpuSolver(grid,state.slice());
view.setLayers(false,false);view.setSpin(0,false);view.setSun([.7,.4,-.6]);view.setClimate('none',solver.climate);
document.getElementById('selection')!.innerHTML=sectionSelectionMarkup();const controls=new SectionSelectionControls(view,document.querySelector('main')!);view.onSectionChange=()=>controls.refresh();
document.getElementById('select')!.onclick=()=>view.beginSectionSelection();document.getElementById('globe')!.onclick=()=>view.setSection(false);
let result:unknown=null;document.getElementById('verify')!.onclick=async()=>{result=await verifySelectedSection(view,grid,state);document.getElementById('result')!.textContent=JSON.stringify(result);};
const lifecycle=document.createElement('button');lifecycle.textContent='회전·구면 복귀 검증';document.querySelector('.controls')!.append(lifecycle);
lifecycle.onclick=async()=>{lifecycle.disabled=true;try{result=await verifySectionLifecycle(view);document.getElementById('result')!.textContent=JSON.stringify(result);}finally{lifecycle.disabled=false;}};
let previous=performance.now();view.engine.runRenderLoop(()=>{const t=performance.now();view.animate((t-previous)/1000);previous=t;view.scene.render();controls.update();});
view.beginSectionSelection();document.getElementById('result')!.textContent='A·B를 드래그하고 단면을 연 뒤 검증하세요.';
Object.assign(window,{selectionLab:{view,grid,state,solver,result:()=>result,verify:()=>verifySelectedSection(view,grid,state)}});
