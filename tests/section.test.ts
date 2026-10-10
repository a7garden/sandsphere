import {describe,it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {ParticleSystem} from '@babylonjs/core/Particles/particleSystem';
import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import {SectionCamera} from '../src/render/sectionCamera';
import {triangleSection,buildSectionMesh} from '../src/render/sectionGeometry';
import {columnGeometry} from '../src/render/columnGeometry';
import {advanceFalling,physicalContact,type FallingGrain} from '../src/sim/falling';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,seedWorld,totalMass,totalEnthalpy} from '../src/sim/model';
import {PHYSICS_DT,SimulationClock} from '../src/sim/clock';
import {updateSectionClip} from '../src/render/sectionClip';
import {SimulationRandom} from '../src/sim/random';
describe('continuous section of the same physical world',()=>{
 it('clips ordinary materials and particle systems even before clip properties are initialized',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('world',scene),emitter=new Mesh('emitter',scene);emitter.parent=root;
  emitter.material=new StandardMaterial('material',scene);const particles=new ParticleSystem('gas',10,scene);particles.emitter=emitter;
  root.rotation.y=Math.PI/2;updateSectionClip(scene,root,Vector3.Forward(),.3);
  expect(particles.clipPlane).toBe(emitter.material.clipPlane);expect(particles.clipPlane2).toBe(emitter.material.clipPlane2);
  expect(particles.clipPlane!.normal.x).toBeCloseTo(1);expect(particles.clipPlane!.d).toBe(-.3);
  updateSectionClip(scene,root,Vector3.Forward(),1e6);expect(particles.clipPlane!.d).toBe(-1e6);scene.dispose();engine.dispose();
 });
 it('intersects the rendered triangle exactly, including an edge on the plane',()=>{
  const points=[new Vector3(0,0,-1),new Vector3(2,0,1),new Vector3(0,2,1)];
  const hits=triangleSection(points,Vector3.Forward(),0);
  expect(hits.map(p=>p.asArray())).toEqual([[1,0,0],[0,1,0]]);
  expect(triangleSection([new Vector3(0,0,0),new Vector3(1,0,0),new Vector3(0,1,1)],Vector3.Forward(),0)).toHaveLength(2);
 });
 it('preserves cell ownership and stock, and keeps the fixed core uneditable',()=>{
  const grid=createSphere(1),state=seedWorld(grid),before=state.slice();state[F.sand]=10;const expected=state.slice();
  const terrain=new Float32Array([5,0,-1,5,1,1,5,-1,1]),water=new Float32Array(18),owners=new Uint32Array([0]);
  const cap=buildSectionMesh(terrain,water,owners,state,grid,Vector3.Forward(),.22);
  expect(cap.owners).toEqual([-1,0,0]);expect(state).toEqual(expected);
  for(let i=2;i<cap.positions.length;i+=3)expect(cap.positions[i]).toBeCloseTo(-.2199,6);
  expect(before.length).toBe(state.length);expect(cap.positions.every(Number.isFinite)).toBe(true);
 });
 it('maps refined render samples to real cells without inventing a simulation cell',()=>{
  const grid=createSphere(1),sample=grid.count,state=new Float32Array((sample+1)*STRIDE);state[sample*STRIDE+F.temperature]=950;state[sample*STRIDE+F.clay]=10;
  const samples={cellOwners:new Uint32Array(sample+1),baseHeights:new Float32Array(sample+1),solidRadii:new Float32Array(sample+1),mobileWater:new Float32Array(sample+1)};
  samples.cellOwners[sample]=3;samples.baseHeights[sample]=2;samples.solidRadii[sample]=5.1;samples.mobileWater[sample]=1;
  const cap=buildSectionMesh(new Float32Array([5,0,-1,5,1,1,5,-1,1]),new Float32Array([5.2,0,-1,5.2,1,1,5.2,-1,1,0,0,0,0,0,0,0,0,0]),new Uint32Array([sample]),state,grid,Vector3.Forward(),.22,undefined,1/30,samples);
  expect(cap.positions.every(Number.isFinite)).toBe(true);expect(cap.colors.every(Number.isFinite)).toBe(true);
  expect(cap.owners).toEqual([-1,3,3,3,3]);expect(cap.data.filter((_,i)=>i%4===0).slice(3)).toEqual(Array(12).fill(950));
 });
 it('represents ice as solid and soil water as retained liquid, without a second ice surface',()=>{
  const grid=createSphere(1),state=new Float32Array(grid.count*STRIDE);state[F.ice]=2;state[F.soil]=2;state[F.water]=.2;
  const column=columnGeometry(state,0,grid);expect(column.water).toBe(0);expect(column.retained).toBeCloseTo(.2);
  expect(column.waterRadius).toBe(column.solidRadius);expect(column.physicalContact).toBe(physicalContact(state,0,grid));
 });
 it('joins the foundation across different cell owners using shared edge heights',()=>{
  const grid=createSphere(1),state=seedWorld(grid),before=state.slice();
  const vertices=[new Vector3(6,0,-1),new Vector3(6,1,1),new Vector3(6,-1,1),new Vector3(6,-2,-1)];
  const terrain=Float32Array.from([0,1,2,0,2,3].flatMap(i=>vertices[i].asArray()));
  const samples={cellOwners:new Uint32Array([0,1,2,3]),baseHeights:new Float32Array([0,8,2,6]),solidRadii:new Float32Array(4),mobileWater:new Float32Array(4),triangleVertices:new Uint32Array([0,1,2,0,2,3])};
  const cap=buildSectionMesh(terrain,new Float32Array(36),new Uint32Array([0,1]),state,grid,Vector3.Forward(),.22,undefined,1/30,samples);
  // Fan 1's last endpoint and fan 2's first endpoint sit on the shared edge.
  expect(cap.positions.slice(6,9)).toEqual(cap.positions.slice(30,33));
  expect(cap.owners).toEqual([-1,0,0,-1,1,1]);expect(state).toEqual(before);
  expect(Math.hypot(...cap.positions.slice(3,6))).not.toBeCloseTo(Math.hypot(...cap.positions.slice(6,9)),5);
 });
 it('places the water bed on the actual sloping terrain cut, not a constant cell radius',()=>{
  const grid=createSphere(1),state=seedWorld(grid);state[F.water]=2;
  const terrain=new Float32Array([5,0,-1,6,1,1,4,-1,1]),water=new Float32Array([5.5,0,-1,6.5,1,1,4.5,-1,1,0,0,0,0,0,0,0,0,0]);
  const cap=buildSectionMesh(terrain,water,new Uint32Array([0]),state,grid,Vector3.Forward(),.22);
  const hits=triangleSection([0,1,2].map(k=>Vector3.FromArray(terrain,k*3)),Vector3.Forward(),-.2199);
  const a=hits[0],edge=hits[1].subtract(a);
  for(const position of [cap.positions.slice(27,30),cap.positions.slice(42,45)]){
   const bed=Vector3.FromArray(position),relative=bed.subtract(a);
   expect(Vector3.Cross(relative,edge).length()).toBeLessThan(1e-6);
   expect(Vector3.Dot(relative,edge)/edge.lengthSquared()).toBeGreaterThanOrEqual(-1e-6);
   expect(Vector3.Dot(relative,edge)/edge.lengthSquared()).toBeLessThanOrEqual(1+1e-6);
  }
 });
 it('frames a selected surface, rotates both axes through the poles, and keeps pan separate',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('world',scene),camera=new ArcRotateCamera('camera',-1,1.17,16,Vector3.Zero(),scene);
  root.rotation.set(.4,.8,-.3);camera.getViewMatrix();const position=camera.position.clone(),target=camera.target.clone(),controller=new SectionCamera(camera,root,true);
  controller.toggle(true,Vector3.Down(),5.7);controller.update(.5);
  expect(camera.target.length()).toBeCloseTo(5.55);expect(controller.viewScale).toBeLessThan(.5);
  const normal=controller.normal.clone();controller.rotate(.5,.6);controller.update(.1);
  expect(Vector3.Distance(normal,controller.normal)).toBeGreaterThan(.2);expect(controller.angleDegrees).not.toBe(0);expect(controller.tiltDegrees).not.toBe(0);
  for(let i=0;i<1000;i++)controller.rotate(.1,.08);
  expect(controller.u.length()).toBeCloseTo(1,6);expect(controller.v.length()).toBeCloseTo(1,6);expect(Math.abs(Vector3.Dot(controller.u,controller.v))).toBeLessThan(1e-6);
  const rotated=controller.normal.clone();controller.move(.3,.4);controller.update(.1);expect(controller.normal).toEqual(rotated);
  controller.frame('whole');controller.update(.1);expect(camera.target.length()).toBeLessThan(1e-6);const wholeScale=controller.viewScale;
  controller.home();controller.update(.1);expect(camera.target.length()).toBeCloseTo(5.55);expect(controller.viewScale).toBeLessThan(wholeScale);
  controller.toggle(false,Vector3.Up());controller.update(.5);expect(Vector3.Distance(camera.position,position)).toBeLessThan(1e-5);expect(Vector3.Distance(camera.target,target)).toBeLessThan(1e-5);
  scene.dispose();engine.dispose();
 });
 it('animates surface/whole framing continuously and reverses a partial exit',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('world',scene),camera=new ArcRotateCamera('camera',-1,1.17,16,Vector3.Zero(),scene);
  camera.getViewMatrix();const controller=new SectionCamera(camera,root,false);controller.toggle(true,Vector3.Up(),5.6);controller.update(.5);
  const localTarget=camera.target.clone(),scale=controller.viewScale;controller.frame('whole');controller.update(0);expect(camera.target).toEqual(localTarget);expect(controller.viewScale).toBe(scale);
  controller.update(.06);expect(camera.target.length()).toBeLessThan(localTarget.length());expect(camera.target.length()).toBeGreaterThan(0);
  controller.toggle(false,Vector3.Up());controller.update(.12);const midway=camera.position.clone();controller.toggle(true,Vector3.Right());controller.update(0);expect(camera.position).toEqual(midway);
  controller.update(.5);expect(controller.amount).toBe(1);expect([...camera.getProjectionMatrix().m].every(Number.isFinite)).toBe(true);
  scene.dispose();engine.dispose();
 });
 for(const reduced of [false,true])it(`reverses the camera without resetting stock; reduced motion=${reduced}`,()=>{
  const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('world',scene),camera=new ArcRotateCamera('camera',-1,1.17,16,Vector3.Zero(),scene);
  camera.getViewMatrix();const position=camera.position.clone(),projection=camera.getProjectionMatrix().clone();
  const grid=createSphere(1),state=seedWorld(grid),mass=totalMass(state),energy=totalEnthalpy(state),controller=new SectionCamera(camera,root,reduced);
  controller.toggle(true,Vector3.Up());controller.update(.12);const intermediate=camera.position.clone();
  controller.toggle(false,Vector3.Up());controller.update(0);
  if(!reduced)expect(Vector3.Distance(camera.position,intermediate)).toBeLessThan(1e-5);
  controller.update(.5);expect(controller.active).toBe(false);expect(Vector3.Distance(camera.position,position)).toBeLessThan(1e-5);
  expect(camera.getProjectionMatrix().equalsWithEpsilon(projection,1e-5)).toBe(true);
  controller.toggle(true,new Vector3(0,-1,0));controller.update(.5);
  expect(Math.abs(Vector3.Dot(controller.u,controller.v))).toBeLessThan(1e-6);expect(controller.normal.length()).toBeCloseTo(1);
  expect([...camera.getProjectionMatrix().asArray()].every(Number.isFinite)).toBe(true);
  expect(Math.abs(camera.getProjectionMatrix().determinant())).toBeGreaterThan(1e-8);
  expect(camera.getProjectionMatrix().m[15]).toBe(1);expect(camera.getProjectionMatrix().m[11]).toBe(0);
  controller.zoom(.3);controller.move(.1,-.1);controller.setAngle(180);controller.update(.1);
  expect(totalMass(state)).toBe(mass);expect(totalEnthalpy(state)).toBe(energy);scene.dispose();engine.dispose();
 });
 it('moves supply only on the common clock and deposits its exact mass once',()=>{
  const grid=createSphere(1),state=seedWorld(grid),direction=Vector3.FromArray(grid.directions),landings:number[]=[];
  const grains:FallingGrain[]=[{position:direction.scale(physicalContact(state,0,grid)+.2),velocity:Vector3.Zero(),index:0,material:'sand',amount:3,size:1,age:0,spin:0,land:(_,mass)=>landings.push(mass)}];
  const start=grains[0].position.clone();for(let n=0;n<120;n++)advanceFalling(grains,grid,state,0,{ambient:20,sunlight:0,sun:[1,0,0],gravity:1});
  expect(grains[0].position).toEqual(start);expect(landings).toEqual([]);
  for(let n=0;n<120;n++)advanceFalling(grains,grid,state,PHYSICS_DT,{ambient:20,sunlight:0,sun:[1,0,0],gravity:1});
  expect(landings).toEqual([3]);expect(grains).toHaveLength(0);
 });
 it('produces identical supply, contacts and cell states at 15, 30 and 144 render frames per second',()=>{
  const grid=createSphere(1),initial=seedWorld(grid),e={ambient:20,sunlight:0,sun:[1,0,0],gravity:1};
  const run=(fps:number)=>{
   const solver=new CpuSolver(grid,initial.slice()),clock=new SimulationClock(),random=new SimulationRandom(),grains:FallingGrain[]=[],commands=new Float32Array(grid.count*COMMAND_STRIDE);let steps=0;
   for(let frame=0;frame<fps;frame++){
    for(let j=0;j<frame%7;j++)Math.random(); // Decorative rendering consumes a different number of random samples.
    clock.add(1/fps,1);
    for(let n=clock.take();n>0;n--){
     const direction=Vector3.FromArray(grid.directions),position=direction.scale(physicalContact(solver.state,0,grid)+.12+random.next()*.04);
     grains.push({position,velocity:Vector3.Zero(),index:0,material:'sand',amount:1,size:1,age:0,spin:0,land:(i,mass)=>commands[i*COMMAND_STRIDE+1]+=mass});
     advanceFalling(grains,grid,solver.state,PHYSICS_DT,e);solver.advance(PHYSICS_DT,commands,e);commands.fill(0);steps++;
    }
   }
   return {steps,state:solver.state,positions:grains.map(g=>g.position.asArray()),stock:totalMass(solver.state)+grains.reduce((sum,g)=>sum+g.amount,0)};
  };
  const baseline=run(30);expect(baseline.steps).toBe(30);expect(baseline.stock-totalMass(initial)).toBeCloseTo(30,3);
  expect(run(15)).toEqual(baseline);expect(run(144)).toEqual(baseline);
 });
});
