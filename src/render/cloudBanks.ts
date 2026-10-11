import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {Vector3,Vector4} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {SphereGrid} from '../sim/sphere';
import {F,STRIDE} from '../sim/model';
import {sectionShader} from './sectionClip';
import {CloudEnvelopeField,cloudComponents} from './cloudEnvelope';
import {CloudEnvelopeGeometry,CLOUD_RADIUS_GLSL} from './cloudEnvelopeGeometry';

import {CLOUD_PROFILES,type CloudStyle} from './cloudProfiles';
export type {CloudStyle} from './cloudProfiles';
const BLEND_SECONDS=.12;

/** Shared vertices form a connected upper/lower cloud envelope. Cloud banks
 * follow the simulated field rather than separate round template objects. */
export class CloudBanks {
 private field:CloudEnvelopeField;
 private mesh:Mesh;
 private material:ShaderMaterial;
 private geometry:CloudEnvelopeGeometry;
 private previousNormals:Float32Array;
 private nextNormals:Float32Array;
 private height=.65;
 private previous:Float32Array;
 private next:Float32Array;
 private blend=1;
 private initialized=false;
 private visible=true;
 private count=0;
 private cells=0;
 private mass=0;
 private connectedCells=0;
 private style:CloudStyle='gentle';
 private flatClouds=true;
 private cloudOpacity=.84;
 constructor(scene:Scene,root:TransformNode,private grid:SphereGrid){
  this.field=new CloudEnvelopeField(grid);this.geometry=new CloudEnvelopeGeometry(grid);
  const geometry=this.geometry;this.previous=new Float32Array(geometry.layers.length*4);this.next=new Float32Array(this.previous.length);
  this.previousNormals=new Float32Array(geometry.positions.length);this.nextNormals=new Float32Array(this.previousNormals.length);
  this.mesh=new Mesh('connected cloud envelope',scene);this.mesh.parent=root;this.mesh.isPickable=false;this.mesh.alwaysSelectAsActiveMesh=true;this.mesh.renderingGroupId=2;
  const data=new VertexData();data.positions=geometry.positions;data.indices=geometry.indices;data.applyToMesh(this.mesh);
  this.mesh.setVerticesData('cloudLayer',geometry.layers,false,1);this.mesh.setVerticesData('cloudLobe',geometry.lobes,true,1);this.mesh.setVerticesData('cloudPrevious',this.previous,true,4);this.mesh.setVerticesData('cloudNext',this.next,true,4);
  this.mesh.setVerticesData('cloudPreviousNormal',this.previousNormals,true,3);this.mesh.setVerticesData('cloudNextNormal',this.nextNormals,true,3);
  this.material=sectionShader(scene,'connected cloud bank light',{vertexSource:`precision highp float;
 attribute vec3 position;attribute float cloudLayer;attribute float cloudLobe;attribute vec4 cloudPrevious;attribute vec4 cloudNext;
 attribute vec3 cloudPreviousNormal;attribute vec3 cloudNextNormal;
 uniform mat4 world;uniform mat4 viewProjection;uniform float cloudBlend;uniform float cloudHeight;
 varying vec3 cloudPoint;varying vec3 cloudUp;varying vec3 cloudStock;varying vec3 cloudCenter;varying vec3 cloudNormal;varying float bankLobe;varying float cloudGround;
 ${CLOUD_RADIUS_GLSL}
 void main(){
  vec4 field=mix(cloudPrevious,cloudNext,cloudBlend);
  float mass=field.x+field.y,radius=cloudRadius(field.z,mass,cloudLobe,cloudLayer,cloudHeight);
  cloudPoint=(world*vec4(position*radius,1.0)).xyz;cloudUp=normalize(mat3(world)*position);
  cloudNormal=normalize(mat3(world)*mix(cloudPreviousNormal,cloudNextNormal,cloudBlend));bankLobe=cloudLobe;cloudGround=field.z*length(world[0].xyz);
  cloudCenter=world[3].xyz;
  cloudStock=vec3(mass*.70+field.w*.30,field.y/max(.000001,mass),cloudLayer);
  gl_Position=viewProjection*vec4(cloudPoint,1.0);
 }`,fragmentSource:`precision highp float;
 varying vec3 cloudPoint;varying vec3 cloudUp;varying vec3 cloudStock;varying vec3 cloudCenter;varying vec3 cloudNormal;varying float bankLobe;varying float cloudGround;
 uniform vec3 sunlight;uniform vec3 eye;uniform float cloudOpacity;uniform float cloudFaceting;uniform vec4 cloudShade;
 ${CLOUD_RADIUS_GLSL}
 void main(){
  // From outside, the far underside is behind the cloud volume. Drawing it
  // through the translucent top adds an artificial concentric dark rim.
  if(cloudStock.z<.5&&sectionHalfWidth>1000.0&&length(eye-cloudCenter)>length(cloudPoint-cloudCenter))discard;
  float mass=max(0.0,cloudStock.x);
  // The same continuous lobes shape height and density. Low stock stays
  // sparse; rising stock fills the gaps and joins the neighboring lobes.
  float cover=cloudCoverage(mass,bankLobe);
  float alpha=cloudOpacity*cover*(1.0-exp(-mass*cloudShade.w/max(.35,cover)));
  // Suppress the outer shell silhouette without changing local cloud stock.
  if(sectionHalfWidth>1000.0&&flatAmount<.001&&length(eye-cloudCenter)>cloudGround+.1){
   vec3 ray=normalize(cloudPoint-eye);
   float clearance=cloudGround-length(cross(eye-cloudCenter,ray));
   alpha*=mix(.08,1.0,smoothstep(-.04,.22,clearance))*smoothstep(.10,.55,dot(normalize(cloudUp),-ray));
  }
  if(alpha<.002)discard;
  vec3 up=normalize(cloudUp),normal=normalize(cloudNormal);if(dot(normal,up)<0.0)normal=-normal;
  vec3 face=normalize(cross(dFdx(cloudPoint),dFdy(cloudPoint)));if(dot(face,up)<0.0)face=-face;
  normal=normalize(mix(up,mix(normal,face,cloudFaceting),cloudShade.x));
  float day=smoothstep(-.12,.32,dot(up,sunlight)),diffuse=max(0.0,dot(normal,sunlight));
  float body=(1.0-exp(-mass*4.0))*(1.0-diffuse);
  float light=cloudShade.y+(1.0-cloudShade.y)*diffuse-cloudShade.z*body;
  float rim=pow(1.0-max(0.0,dot(normal,normalize(eye-cloudPoint))),3.0)*diffuse*.025;
  vec3 color=mix(vec3(.96,.97,.98),vec3(.92,.96,1.0),cloudStock.y);
  color=color*mix(.72,1.0,cloudStock.z)*light+rim;
  color*=vec3(.23,.29,.39)+vec3(.77,.71,.61)*day;
  gl_FragColor=vec4(color,alpha);
 }`},{attributes:['position','cloudLayer','cloudLobe','cloudPrevious','cloudNext','cloudPreviousNormal','cloudNextNormal'],uniforms:['world','viewProjection','cloudBlend','cloudHeight','cloudFaceting','cloudShape0','cloudShape1','cloudShade','sunlight','eye','cloudOpacity'],needAlphaBlending:true},'cloudPoint');
  this.material.backFaceCulling=true;this.material.disableDepthWrite=true;this.mesh.material=this.material;
  this.material.setFloat('cloudBlend',1);this.material.setFloat('cloudOpacity',this.cloudOpacity);this.material.setVector3('sunlight',Vector3.Right());this.updateProfile();this.mesh.setEnabled(false);
  this.material.onBindObservable.add(()=>{if(scene.activeCamera)this.material.setVector3('eye',scene.activeCamera.globalPosition);});
 }
 update(state:Float32Array,radii:Float32Array){
  this.mass=0;this.cells=0;for(let i=0;i<this.grid.count;i++){const m=Math.max(0,state[i*STRIDE+F.cloud])+Math.max(0,state[i*STRIDE+F.cloudIce]);this.mass+=m;if(m>1e-6)this.cells++;}
  const field=this.field.sample(state,radii),components=cloudComponents(this.grid,field);this.count=components.count;this.connectedCells=components.cells;
  for(let p=0;p<this.previous.length;p++)this.previous[p]+=(this.next[p]-this.previous[p])*this.blend;
  for(let p=0;p<this.previousNormals.length;p++)this.previousNormals[p]+=(this.nextNormals[p]-this.previousNormals[p])*this.blend;
  this.geometry.expand(field,this.next);this.geometry.normals(this.next,this.height,this.nextNormals);
  if(!this.initialized){this.previous.set(this.next);this.previousNormals.set(this.nextNormals);this.initialized=true;this.blend=1;}else this.blend=0;
  this.mesh.updateVerticesData('cloudPrevious',this.previous);this.mesh.updateVerticesData('cloudNext',this.next);this.mesh.updateVerticesData('cloudPreviousNormal',this.previousNormals);this.mesh.updateVerticesData('cloudNextNormal',this.nextNormals);this.material.setFloat('cloudBlend',this.blend);this.applyVisibility();
 }
 animate(dt:number){if(this.blend===1)return;this.blend=Math.min(1,this.blend+Math.max(0,dt)/BLEND_SECONDS);this.material.setFloat('cloudBlend',this.blend);if(this.blend===1)this.applyVisibility();}
 setSun(sun:readonly number[]){this.material.setVector3('sunlight',Vector3.FromArray(sun));}
 private applyVisibility(){const fading=this.blend<1&&this.previous.some((v,i)=>i%4<2&&v>1e-6);this.mesh.setEnabled(this.visible&&(this.mass>1e-6||fading));}
 private updateProfile(){
  const p=CLOUD_PROFILES[this.style];this.height=this.flatClouds||this.style==='stratus'?.65:1;
  this.material.setFloat('cloudHeight',this.height);this.material.setFloat('cloudFaceting',p.faceting);
  this.material.setVector4('cloudShape0',new Vector4(p.edge,p.variation,p.lower,p.upper));
  this.material.setVector4('cloudShape1',new Vector4(p.lift,p.base,p.gain,p.relief));
  this.material.setVector4('cloudShade',new Vector4(p.normal,p.light,p.shade,p.optical));
  if(this.geometry.setProfile(p))this.mesh.updateVerticesData('cloudLobe',this.geometry.lobes);
  if(this.initialized){this.geometry.normals(this.previous,this.height,this.previousNormals);this.geometry.normals(this.next,this.height,this.nextNormals);this.mesh.updateVerticesData('cloudPreviousNormal',this.previousNormals);this.mesh.updateVerticesData('cloudNextNormal',this.nextNormals);}
 }
 setStyle(style:CloudStyle){this.style=style;this.updateProfile();}
 setAppearance(flat:boolean,opacity:number){this.flatClouds=flat;this.cloudOpacity=Math.max(0,Math.min(1,opacity));this.material.setFloat('cloudOpacity',this.cloudOpacity);this.updateProfile();}
 setVisible(visible:boolean){this.visible=visible;this.applyVisibility();}
 stats(){return {cloudRenderer:'connected-cloud-envelope',cloudRegions:this.grid.count,cloudBanks:this.count,cloudCells:this.cells,cloudConnectedCells:this.connectedCells,cloudRenderedMass:this.mass,cloudStyle:this.style,cloudPieces:this.count,cloudDraws:this.mesh.isEnabled()?1:0,flatClouds:this.flatClouds,cloudOpacity:this.cloudOpacity};}
}
