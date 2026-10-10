import {Viewport} from '@babylonjs/core/Maths/math.viewport';
import {Matrix,Quaternion} from '@babylonjs/core/Maths/math.vector';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {Vector3,Color3} from '@babylonjs/core/Maths/math';
import type {Scene} from '@babylonjs/core/scene';
import type {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {RADIUS,type SphereGrid} from '../sim/sphere';
import {F,STRIDE} from '../sim/model';
import type {PlanetRecord} from '../sim/system';
import {columnGeometry,columnColor,MATERIAL_COLORS} from './columnGeometry';
import {OrbitDisplay} from './orbitDisplay';

export const orbitPosition=(p:PlanetRecord)=>{const e=p.snapshot.environment,r=(e.orbitDistance??1)*30,a=e.orbitAngle??0;return new Vector3(-Math.cos(a)*r,0,Math.sin(a)*r);};
export class SystemScene {
 private meshes:Mesh[]=[];
 private locations=new Map<string,Vector3>();
 private origin=Vector3.Zero();
 private records:PlanetRecord[]=[];
 private selectedId='';
 private displays=new Map<string,OrbitDisplay>();
 private surfaces=new Map<string,{mesh:Mesh;positions:Float32Array;colors:Float32Array;nextPositions:Float32Array;nextColors:Float32Array;blend:number;time:number}>();
 private refresh=0;
 private flight:{from:Vector3;to:Vector3;r0:number;r1:number;b0:number;b1:number;a0:number;a1:number;t:number;resolve:()=>void;anchor?:string}|null=null;
 active=false;
 constructor(private scene:Scene,private camera:ArcRotateCamera,private grid:SphereGrid){}
 rebuild(planets:PlanetRecord[],activeId:string){
  this.clear();this.active=true;const selected=planets.find(p=>p.id===activeId)!;const origin=orbitPosition(selected);this.origin=origin;this.records=planets;this.selectedId=activeId;
  for(const p of planets){
   const position=orbitPosition(p).subtract(origin);this.locations.set(p.id,position);
   const r=(p.snapshot.environment.orbitDistance??1)*30;
   const track=MeshBuilder.CreateLines('orbit '+p.id,{points:Array.from({length:161},(_,i)=>new Vector3(Math.cos(i/160*Math.PI*2)*r,0,Math.sin(i/160*Math.PI*2)*r))},this.scene);
   track.position=origin.negate();track.metadata={orbit:true};track.color=new Color3(.21,.25,.28);track.alpha=.45;track.isPickable=false;this.meshes.push(track);
   const mesh=new Mesh(p.name,this.scene),positions=new Float32Array(this.grid.count*3),colors=new Float32Array(this.grid.count*4);
   this.writeSurface(p,positions,colors);
   const nextPositions=positions.slice(),nextColors=colors.slice();
   const vd=new VertexData();vd.positions=positions;vd.normals=this.grid.directions;vd.colors=colors;vd.indices=this.grid.indices;vd.applyToMesh(mesh,true);mesh.setVerticesData('nextPosition',nextPositions,true,3);mesh.setVerticesData('nextColor',nextColors,true,4);mesh.useVertexColors=true;mesh.position=position;mesh.metadata={planetId:p.id};
   // Keep the actual relief and material map. Distant planets need diffuse
   // illumination, but no per-cell reflections, clouds, waves or particle passes.
   const material=new ShaderMaterial('orbital surface',this.scene,{vertexSource:`precision highp float;attribute vec3 position;attribute vec3 nextPosition;attribute vec3 normal;attribute vec4 color;attribute vec4 nextColor;uniform float snapshotBlend;uniform mat4 world;uniform mat4 worldViewProjection;varying vec3 n;varying vec3 p;varying vec3 c;void main(){vec3 surface=mix(position,nextPosition,snapshotBlend);n=mat3(world)*normal;p=(world*vec4(surface,1)).xyz;c=mix(color,nextColor,snapshotBlend).rgb;gl_Position=worldViewProjection*vec4(surface,1);}`,fragmentSource:`precision highp float;varying vec3 n;varying vec3 p;varying vec3 c;uniform vec3 star;void main(){float light=max(0.,dot(normalize(n),normalize(star-p)));gl_FragColor=vec4(c*(vec3(.12,.16,.21)+vec3(.95,.91,.80)*light),1);}`},{attributes:['position','nextPosition','normal','color','nextColor'],uniforms:['world','worldViewProjection','star','snapshotBlend']});
   material.setVector3('star',origin.negate());material.setFloat('snapshotBlend',1);mesh.material=material;this.meshes.push(mesh);
   this.surfaces.set(p.id,{mesh,positions,colors,nextPositions,nextColors,blend:1,time:p.snapshot.time});this.displays.set(p.id,new OrbitDisplay(p.snapshot));
  }
  return origin.negate();
 }
 fly(target:Vector3,radius:number,beta:number=this.camera.beta,alpha:number=this.camera.alpha,anchor?:string){
  this.flight?.resolve();this.camera.inertialAlphaOffset=0;this.camera.inertialBetaOffset=0;this.camera.inertialRadiusOffset=0;
  return new Promise<void>(resolve=>this.flight={from:this.camera.target.clone(),to:target,r0:this.camera.radius,r1:radius,b0:this.camera.beta,b1:beta,a0:this.camera.alpha,a1:alpha,t:0,resolve,anchor});
 }
 private writeSurface(p:PlanetRecord,positions:Float32Array,colors:Float32Array){
  const s=new Float32Array(p.snapshot.state);
  for(let i=0;i<this.grid.count;i++){
   const column=columnGeometry(s,i,this.grid),base=columnColor(s,i),q=i*STRIDE,water=Math.min(1,column.water*4),plant=Math.min(1,s[q+F.plant]*.7)*(1-water);
   for(let c=0;c<3;c++){positions[i*3+c]=this.grid.directions[i*3+c]*Math.max(RADIUS-.4,column.waterRadius);colors[i*4+c]=(base[c]*(1-plant)+MATERIAL_COLORS.plant[c]*plant)*(1-water)+MATERIAL_COLORS.water[c]*water;}
   colors[i*4+3]=1;
  }
 }
 update(dt:number,speed=1){
  if(this.active){
   for(const p of this.records)this.displays.get(p.id)!.update(p.snapshot,dt,speed);
   const position=(p:PlanetRecord)=>{const a=this.displays.get(p.id)!.angle,r=(p.snapshot.environment.orbitDistance??1)*30;return new Vector3(-Math.cos(a)*r,0,Math.sin(a)*r);};
   const selected=this.records.find(p=>p.id===this.selectedId)!,origin=position(selected),delta=this.origin.subtract(origin);
   for(const p of this.records)this.locations.set(p.id,position(p).subtract(origin));
   this.refresh+=dt;const upload=this.refresh>=1;if(upload)this.refresh%=1;
   for(const p of this.records){const surface=this.surfaces.get(p.id)!,m=surface.mesh,material=m.material as ShaderMaterial;
    m.position=this.locations.get(p.id)!;m.rotationQuaternion=Quaternion.RotationAxis(Vector3.Forward(),(p.snapshot.spin?.tilt??0)*Math.PI/180).multiply(Quaternion.RotationAxis(Vector3.Up(),this.displays.get(p.id)!.spin));material.setVector3('star',origin.negate());
    if(upload&&p.snapshot.time!==surface.time){surface.positions.set(surface.nextPositions);surface.colors.set(surface.nextColors);this.writeSurface(p,surface.nextPositions,surface.nextColors);m.updateVerticesData(VertexBuffer.PositionKind,surface.positions);m.updateVerticesData(VertexBuffer.ColorKind,surface.colors);m.updateVerticesData('nextPosition',surface.nextPositions);m.updateVerticesData('nextColor',surface.nextColors);surface.blend=0;surface.time=p.snapshot.time;}
    surface.blend=Math.min(1,surface.blend+dt/.35);material.setFloat('snapshotBlend',surface.blend);
   }
   for(const m of this.meshes)if(m.metadata?.orbit)m.position=origin.negate();
   if(this.flight?.anchor)this.flight.to=this.flight.anchor==='star'?origin.negate():this.destination(this.flight.anchor);
   else if(!this.flight){const {alpha,beta,radius}=this.camera;this.camera.setTarget(this.camera.target.add(delta));this.camera.alpha=alpha;this.camera.beta=beta;this.camera.radius=radius;}
   this.origin=origin;
  }
  const f=this.flight;if(!f)return;f.t=Math.min(1,f.t+dt/(matchMedia('(prefers-reduced-motion: reduce)').matches?.12:1.25));
  const t=f.t*f.t*(3-2*f.t);this.camera.setTarget(Vector3.Lerp(f.from,f.to,t));this.camera.radius=f.r0+(f.r1-f.r0)*t;this.camera.beta=f.b0+(f.b1-f.b0)*t;this.camera.alpha=f.a0+(f.a1-f.a0)*t;
  if(f.t===1){this.flight=null;f.resolve();}
 }
 labels(width:number,height:number){return [...this.locations].map(([id,position])=>{const p=Vector3.Project(position,Matrix.Identity(),this.scene.getTransformMatrix(),new Viewport(0,0,width,height));return {id,x:p.x,y:p.y,z:p.z};});}
 destination(id:string){return this.locations.get(id)?.clone()??Vector3.Zero();}
 get starPosition(){return this.origin.negate();}
 stats(){return {active:this.active,planets:this.surfaces.size,surfaceRefreshHz:1};}
 clear(){this.flight?.resolve();this.flight=null;for(const m of this.meshes)m.dispose(false,true);this.meshes=[];this.locations.clear();this.surfaces.clear();this.displays.clear();this.refresh=0;this.active=false;}
}
