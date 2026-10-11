import {describe,it,expect,vi} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import {SectionProjection} from '../src/render/sectionProjection';
import {buildSectionMesh} from '../src/render/sectionGeometry';
import {altitude,columnColor,MATERIAL_COLORS} from '../src/render/columnGeometry';
import {RADIUS,createSphere} from '../src/sim/sphere';
import {F,STRIDE,seedWorld,totalMass,totalEnthalpy} from '../src/sim/model';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {sectionShader,setSectionProjection} from '../src/render/sectionClip';
import {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {SectionCamera} from '../src/render/sectionCamera';

describe('unfolded live section',()=>{
 it('restores orbit angles after a rotated section returns to the same globe position',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),camera=new ArcRotateCamera('camera',-1.01,1.17,18,Vector3.Zero(),scene),root=new TransformNode('root',scene),section=new SectionCamera(camera,root,false);
  camera.getViewMatrix(true);const before=camera.position.clone();section.toggle(true,Vector3.Up(),RADIUS);section.setAngle(73);section.setTilt(-48);
  section.update(1);camera.getViewMatrix(true);section.toggle(false,Vector3.Up());section.update(1);camera.getViewMatrix(true);
  expect(Vector3.Distance(before,camera.position)).toBeLessThan(1e-4);expect(camera.upVector.equalsWithEpsilon(Vector3.Up(),1e-7)).toBe(true);
  scene.dispose();engine.dispose();
 });
 it('waits for the shared foundation texture before the first globe draw',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),projection=new SectionProjection(scene);
  setSectionProjection(scene,projection);
  const material=sectionShader(scene,'texture readiness',{vertexSource:'precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;void main(){gl_Position=worldViewProjection*vec4(position,1.0);}',fragmentSource:'precision highp float;void main(){gl_FragColor=vec4(1.0);}'},{attributes:['position'],uniforms:['worldViewProjection']});
  const mesh=MeshBuilder.CreateSphere('globe',{},scene);mesh.material=material;
  expect(material.hasTexture(projection.texture)).toBe(true);
  expect(material.getActiveTextures()).toContain(projection.texture);
  const pending=vi.spyOn(projection.texture,'isReady').mockReturnValue(false);
  expect(material.isReady(mesh)).toBe(false);
  pending.mockRestore();scene.dispose();engine.dispose();
 });
 it('round trips air and material positions at rotated cuts including both poles',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),projection=new SectionProjection(scene);
  for(const v of [Vector3.Up(),Vector3.Down(),new Vector3(.3,.8,.4).normalize()]){
   const u=Vector3.Cross(Math.abs(v.y)>.9?Vector3.Right():Vector3.Up(),v).normalize(),normal=Vector3.Cross(u,v),world=Matrix.RotationYawPitchRoll(.7,.4,-.3);
   projection.configure(u,v,normal,world,1,.8);
   for(const angle of [-.75,-.2,0,.15,.75])for(const height of [0,.2,1.2])for(const z of [-.22,0,.22]){
    const p=u.scale(Math.sin(angle)*(RADIUS+height)).add(v.scale(Math.cos(angle)*(RADIUS+height))).add(normal.scale(z)),flat=projection.forward(p);
    expect(Vector3.Distance(projection.backward(flat),p)).toBeLessThan(1e-6);
    expect(Vector3.Dot(flat,u)).toBeCloseTo(RADIUS*angle,6);expect(Vector3.Dot(flat,v)).toBeCloseTo(RADIUS+height,6);
    const physicalWorld=Vector3.TransformCoordinates(p,world);expect(Vector3.Distance(projection.displayWorld(physicalWorld),Vector3.TransformCoordinates(flat,world))).toBeLessThan(1e-5);
   }
  }
  scene.dispose();engine.dispose();
 });
 it('hides foundation and out-of-range material without touching stocks or enthalpy',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),projection=new SectionProjection(scene),grid=createSphere(1),state=seedWorld(grid),before=state.slice(),mass=totalMass(state),enthalpy=totalEnthalpy(state);
  projection.configure(Vector3.Right(),Vector3.Up(),Vector3.Forward(),Matrix.Identity(),1,.3);
  expect(projection.contains(new Vector3(0,RADIUS-.1,0))).toBe(false);expect(projection.contains(new Vector3(0,RADIUS+.1,0))).toBe(true);
  expect(projection.contains(new Vector3(Math.sin(.4)*6,Math.cos(.4)*6,0))).toBe(false);
  const cap=buildSectionMesh(new Float32Array([-1,6,-1,1,6,1,-1,6,1]),new Float32Array(18),new Uint32Array([0]),state,grid,Vector3.Forward(),.22);
  projection.updateFoundation(cap);expect([...projection.bases].every(Number.isFinite)).toBe(true);expect(state).toEqual(before);expect(totalMass(state)).toBe(mass);expect(totalEnthalpy(state)).toBe(enthalpy);
  scene.dispose();engine.dispose();
 });
 it('removes curved baseline and preserves vertical thickness with a varying foundation',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),projection=new SectionProjection(scene);
  for(let i=0;i<projection.bases.length;i++)projection.bases[i]=RADIUS+.15*Math.sin(i/projection.bases.length*Math.PI*2);
  for(let angle=-.7;angle<.7;angle+=.05){const baseline=projection.base(angle),radial=new Vector3(Math.sin(angle),Math.cos(angle),0),bottom=projection.forward(radial.scale(baseline)),top=projection.forward(radial.scale(baseline+.32));
   expect(bottom.y).toBeCloseTo(RADIUS,6);expect(top.y-bottom.y).toBeCloseTo(.32,6);expect(top.x).toBeCloseTo(bottom.x,6);
  }
  scene.dispose();engine.dispose();
 });
 it('hides rock stock itself while preserving editable overburden and its color',()=>{
  const grid=createSphere(1),state=new Float32Array(grid.count*STRIDE);state[F.rock]=8;
  const radius=RADIUS+altitude(grid.geometry[3]+8),terrain=Float32Array.from([new Vector3(-1,5,-1),new Vector3(1,5,1),new Vector3(-1,5,1)].flatMap(p=>p.normalize().scale(radius).asArray()));
  const cap=buildSectionMesh(terrain,new Float32Array(18),new Uint32Array([0]),state,grid,Vector3.Forward(),.22,undefined,1/30,undefined,true);
  for(let t=1;t<3;t++){const a=Vector3.FromArray(cap.positions,t*9),b=Vector3.FromArray(cap.positions,t*9+3),c=Vector3.FromArray(cap.positions,t*9+6);expect(Vector3.Cross(b.subtract(a),c.subtract(a)).length()).toBeLessThan(1e-6);}
  state[F.sand]=20;const color=columnColor(state,0,true);for(let c=0;c<3;c++)expect(Math.abs(color[c]-MATERIAL_COLORS.sand[c])).toBeLessThan(.001);
  expect(state[F.rock]).toBe(8);
 });
 it('magnifies only the editable stack and round trips materials and air over a varying rotated foundation',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),p=new SectionProjection(scene);
  const v=new Vector3(.3,.8,.4).normalize(),u=Vector3.Cross(Vector3.Up(),v).normalize(),n=Vector3.Cross(u,v);
  p.configure(u,v,n,Matrix.RotationY(.7),1,.8);p.stackDepth=.3;
  for(let i=0;i<p.bases.length;i++)p.bases[i]=RADIUS+.12*Math.sin(i/p.bases.length*Math.PI*2);
  for(const scale of [1,4,16,64]){p.heightScale=scale;for(const a of [-.7,0,.7])for(const h of [0,.1,.3,.3001,.9]){
   const source=u.scale(Math.sin(a)*(p.base(a)+h)).add(v.scale(Math.cos(a)*(p.base(a)+h))).add(n.scale(.2)),display=p.forward(source);
   expect(Vector3.Distance(p.backward(display),source)).toBeLessThan(1e-6);
   expect(Vector3.Dot(display,v)-RADIUS).toBeCloseTo(Math.min(h,.3)*scale+Math.max(0,h-.3),5);
  }}
  p.heightScale=16;expect(p.displayDepth(.8)-p.displayDepth(.3)).toBeCloseTo(.5);scene.dispose();engine.dispose();
 });
 it('maps a straight display depth ray to a straight physical cut ray',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),projection=new SectionProjection(scene),a=projection.backward(new Vector3(.9,RADIUS+.5,-.22)),b=projection.backward(new Vector3(.9,RADIUS+.5,.22));
  expect(a.x).toBeCloseTo(b.x,7);expect(a.y).toBeCloseTo(b.y,7);expect(b.z-a.z).toBeCloseTo(.44,7);
  scene.dispose();engine.dispose();
 });
});
