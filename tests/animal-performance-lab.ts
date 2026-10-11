/** Disposable scene; one render per engine frame, no application saves. */
import {Engine} from '@babylonjs/core/Engines/engine';
import {WebGPUEngine} from '@babylonjs/core/Engines/webgpuEngine';
import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {SceneInstrumentation} from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import {LandAnimals} from '../src/render/animals';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE} from '../src/sim/model';
const query=new URLSearchParams(location.search),canvas=document.querySelector('canvas')!;
let engine:Engine|WebGPUEngine;
if(query.get('cpu')!=='1'&&await WebGPUEngine.IsSupportedAsync){const gpu=new WebGPUEngine(canvas,{antialias:true});await gpu.initAsync();engine=gpu;}else engine=new Engine(canvas,true);
const scene=new Scene(engine),root=new TransformNode('animals',scene),grid=createSphere(4),state=new Float32Array(grid.count*STRIDE),radii=new Float32Array(grid.count).fill(5);
new ArcRotateCamera('camera',-Math.PI/2,1.1,11,Vector3.Zero(),scene);new HemisphericLight('light',new Vector3(.5,1,-.7),scene);
for(let i=0;i<grid.count;i++){const p=i*STRIDE;state[p+F.temperature]=22;state[p+F.soil]=2;state[p+F.water]=.025;state[p+F.plant]=.2;state[p+F.herbivore]=.3;state[p+F.carnivore]=.2;}
const reference=query.get('reference')==='1',source='/artifacts/animal-tokens/animals-before.ts';
const Animals=reference?(await import(/* @vite-ignore */source)).LandAnimals:LandAnimals,animals=new Animals(scene,root,grid);animals.update(state,radii);
const instrument=new SceneInstrumentation(scene),button=document.querySelector('button')!,output=document.querySelector('output')!;
const summary=(values:number[])=>{const a=values.slice(20).sort((a,b)=>a-b);return {meanMs:+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(3),p95Ms:+a[Math.floor(a.length*.95)].toFixed(3)};};
let measurement:{paused:boolean;n:number;previous:number;cpu:number[];render:number[];frames:number[];draws:number[];rows:unknown[]}|null=null,ready=false,last=performance.now();
engine.runRenderLoop(()=>{
 const now=performance.now(),dt=Math.min(.05,(now-last)/1000);last=now;
 const m=measurement,start=performance.now();animals.animate(dt,m?.paused?0:1);const cpu=performance.now()-start,draw=performance.now();scene.render();
 if(!ready&&scene.isReady()){ready=true;button.disabled=false;output.textContent='Ready · rounded ivory seeds and coral wedges';}
 if(!m)return;
 m.cpu.push(cpu);m.render.push(performance.now()-draw);m.frames.push(now-m.previous);m.previous=now;m.draws.push(instrument.drawCallsCounter.current);m.n++;
 if(m.n<150)return;
 m.rows.push({paused:m.paused,cpu:summary(m.cpu),render:summary(m.render),frame:summary(m.frames),drawCalls:Math.max(...m.draws),longFrames:m.frames.slice(20).filter(t=>t>50).length});
 if(!m.paused){m.paused=true;m.n=0;m.cpu=[];m.render=[];m.frames=[];m.draws=[];return;}
 output.textContent=JSON.stringify({reference,renderer:engine.constructor.name,cells:grid.count,meshes:scene.meshes.map(mesh=>({name:mesh.name,instances:(mesh as Mesh).thinInstanceCount,triangles:mesh.getTotalIndices()/3})),rows:m.rows},null,2);measurement=null;button.disabled=false;
});
button.onclick=()=>{button.disabled=true;output.textContent='Measuring 150 moving frames, then 150 paused frames…';measurement={paused:false,n:0,previous:performance.now(),cpu:[],render:[],frames:[],draws:[],rows:[]};};
addEventListener('resize',()=>engine.resize());
