import {describe,it,expect,vi} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {createSphere} from '../src/sim/sphere';
import {seedPlanet,type Snapshot} from '../src/sim/model';
import {orbitalEnvironment} from '../src/sim/orbit';
import {SystemScene} from '../src/render/system';
import {OrbitDisplay} from '../src/render/orbitDisplay';
import {columnGeometry} from '../src/render/columnGeometry';

const grid=createSphere(1);
function snapshot():Snapshot{return {version:1,preset:'coast',planet:{primary:'sand'},state:[...seedPlanet(grid,'sand',18)],time:0,environment:{...orbitalEnvironment(1),orbitAngle:0},supplied:0,removed:0,discoveries:[],paused:false,spin:{angle:0,running:true,period:120,tilt:23.5}};}

describe('solar-system display',()=>{
 it('smooths coarse orbital updates and wraparound without editing the simulation',()=>{
  const s=snapshot(),display=new OrbitDisplay(s);s.time=.2;s.environment.orbitAngle=.1;
  const before=structuredClone(s);display.update(s,1/60,1);
  expect(display.angle).toBeGreaterThan(0);expect(display.angle).toBeLessThan(.05);expect(s).toEqual(before);
  s.environment.orbitAngle=Math.PI*2-.01;const wrapped=new OrbitDisplay(s);s.environment.orbitAngle=.01;s.time+=.2;wrapped.update(s,1/60,1);
  expect(Math.abs(wrapped.angle-(Math.PI*2-.01))).toBeLessThan(.02);
 });
 it('predicts continuously between samples but leaves paused planets still',()=>{
  const s=snapshot(),display=new OrbitDisplay(s);
  for(let i=0;i<12;i++)display.update(s,1/60,4);
  expect(display.angle).toBeGreaterThan(.005);expect(display.spin).toBeGreaterThan(display.angle);
  s.paused=true;const paused=new OrbitDisplay(s);for(let i=0;i<120;i++)paused.update(s,1/60,4);
  expect(paused.angle).toBe(0);expect(paused.spin).toBe(0);expect(s.time).toBe(0);
 });
 it('keeps constant angular velocity across 200 ms snapshot boundaries',()=>{
  const s=snapshot(),display=new OrbitDisplay(s),steps:number[]=[],spinSteps:number[]=[],rate=Math.PI*2/240;
  for(let frame=1;frame<=120;frame++){
   if(frame%12===0){s.time=frame/60;s.environment.orbitAngle=s.time*rate;s.spin!.angle=s.time*Math.PI*2/120;}
   const angle=display.angle,spin=display.spin;display.update(s,1/60,1);steps.push(display.angle-angle);spinSteps.push(display.spin-spin);
  }
  expect(Math.max(...steps)-Math.min(...steps)).toBeLessThan(1e-8);
  expect(Math.max(...spinSteps)-Math.min(...spinSteps)).toBeLessThan(1e-8);
 });
 it('gives every planet a pickable overview surface with its real relief, including the active planet',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),camera=new ArcRotateCamera('camera',0,1,18,Vector3.Zero(),scene),system=new SystemScene(scene,camera,grid);
  const planets=[{id:'planet-a',name:'Sand',snapshot:snapshot()},{id:'planet-b',name:'Ice',snapshot:snapshot()}],before=structuredClone(planets);
  system.rebuild(planets,'planet-a');
  for(const p of planets){const mesh=scene.meshes.find(m=>m.metadata?.planetId===p.id)!;expect(mesh.isPickable).toBe(true);const positions=mesh.getVerticesData('position')!;expect(Math.hypot(...positions.slice(0,3))).toBeCloseTo(columnGeometry(new Float32Array(p.snapshot.state),0,grid).waterRadius,5);}
  expect(planets).toEqual(before);system.clear();expect(scene.meshes).toHaveLength(0);scene.dispose();engine.dispose();
 });
 it('coalesces surface uploads and resolves interrupted flights',async()=>{
  vi.stubGlobal('matchMedia',()=>({matches:false}));
  const engine=new NullEngine(),scene=new Scene(engine),camera=new ArcRotateCamera('camera',0,1,18,Vector3.Zero(),scene),system=new SystemScene(scene,camera,grid),p={id:'planet-a',name:'Sand',snapshot:snapshot()};
  try{system.rebuild([p],p.id);const mesh=scene.meshes.find(m=>m.metadata?.planetId===p.id)!,uploads=vi.spyOn(mesh,'updateVerticesData');p.snapshot.time=1;
   for(let i=0;i<30;i++)system.update(1/60);expect(uploads).not.toHaveBeenCalled();
   for(let i=0;i<31;i++)system.update(1/60);expect(uploads).toHaveBeenCalledTimes(4);
   const flight=system.fly(Vector3.Zero(),145);system.clear();await flight;expect(system.active).toBe(false);
  }finally{scene.dispose();engine.dispose();vi.unstubAllGlobals();}
 });
});
