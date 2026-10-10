import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import {RawTexture} from '@babylonjs/core/Materials/Textures/rawTexture';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {Constants} from '@babylonjs/core/Engines/constants';
import type {Scene} from '@babylonjs/core/scene';
import type {SectionMeshData} from './sectionGeometry';
import {RADIUS} from '../sim/sphere';

export const FOUNDATION_SAMPLES=512;
/** A display transform only. The solver, stock, gravity and contacts stay spherical. */
export class SectionProjection {
  amount=0;halfRange=.45;u=Vector3.Right();v=Vector3.Up();normal=Vector3.Forward();
  world=Matrix.Identity();inverse=Matrix.Identity();
  readonly bases=new Float32Array(FOUNDATION_SAMPLES).fill(RADIUS);
  private pixels=new Float32Array(FOUNDATION_SAMPLES*4);
  readonly texture:RawTexture;
  constructor(scene:Scene){
    this.texture=new RawTexture(this.pixels,FOUNDATION_SAMPLES,1,Constants.TEXTUREFORMAT_RGBA,scene,false,false,Texture.NEAREST_SAMPLINGMODE,Constants.TEXTURETYPE_FLOAT);
    this.texture.wrapU=Texture.CLAMP_ADDRESSMODE;this.texture.wrapV=Texture.CLAMP_ADDRESSMODE;this.upload();
  }
  configure(u:Vector3,v:Vector3,normal:Vector3,world:Matrix,amount:number,halfRange:number){this.u.copyFrom(u);this.v.copyFrom(v);this.normal.copyFrom(normal);this.world.copyFrom(world);this.inverse.copyFrom(world).invert();this.amount=amount;this.halfRange=halfRange;}
  angle(p:Vector3){return Math.atan2(Vector3.Dot(p,this.u),Vector3.Dot(p,this.v));}
  base(angle:number){const x=Math.max(0,Math.min(FOUNDATION_SAMPLES-1,(angle/Math.PI/2+.5)*(FOUNDATION_SAMPLES-1))),i=Math.floor(x);return this.bases[i]+(this.bases[Math.min(i+1,FOUNDATION_SAMPLES-1)]-this.bases[i])*(x-i);}
  /** The cut's shared foundation endpoints define a continuous, horizontal datum. */
  updateFoundation(cap:SectionMeshData){
    const points:{angle:number;radius:number}[]=[];
    for(let t=0;t<cap.owners.length;t++)if(cap.owners[t]<0)for(const k of [1,2]){const p=Vector3.FromArray(cap.positions,t*9+k*3);points.push({angle:this.angle(p),radius:Math.hypot(Vector3.Dot(p,this.u),Vector3.Dot(p,this.v))});}
    points.sort((a,b)=>a.angle-b.angle);if(!points.length)return;
    const extended=[{...points[points.length-1],angle:points[points.length-1].angle-Math.PI*2},...points,{...points[0],angle:points[0].angle+Math.PI*2}];let j=0;
    for(let i=0;i<FOUNDATION_SAMPLES;i++){const a=(i/(FOUNDATION_SAMPLES-1)-.5)*Math.PI*2;while(j+1<extended.length-1&&extended[j+1].angle<a)j++;const left=extended[j],right=extended[j+1],f=(a-left.angle)/Math.max(1e-10,right.angle-left.angle);this.bases[i]=left.radius+(right.radius-left.radius)*Math.max(0,Math.min(1,f));}
    this.upload();
  }
  private upload(){for(let i=0;i<FOUNDATION_SAMPLES;i++)this.pixels[i*4]=this.bases[i];this.texture.update(this.pixels);}
  forward(p:Vector3){const angle=this.angle(p),r=Math.hypot(Vector3.Dot(p,this.u),Vector3.Dot(p,this.v));return this.u.scale(RADIUS*angle).add(this.v.scale(RADIUS+r-this.base(angle))).add(this.normal.scale(Vector3.Dot(p,this.normal)));}
  backward(p:Vector3){const angle=Vector3.Dot(p,this.u)/RADIUS,r=Vector3.Dot(p,this.v)-RADIUS+this.base(angle);return this.u.scale(Math.sin(angle)*r).add(this.v.scale(Math.cos(angle)*r)).add(this.normal.scale(Vector3.Dot(p,this.normal)));}
  contains(p:Vector3){const a=this.angle(p);return Math.abs(a)<=this.halfRange&&Math.hypot(Vector3.Dot(p,this.u),Vector3.Dot(p,this.v))>=this.base(a)-.003;}
  displayWorld(p:Vector3){const local=Vector3.TransformCoordinates(p,this.inverse);return Vector3.TransformCoordinates(Vector3.Lerp(local,this.forward(local),this.amount),this.world);}
}

export const FLAT_UNIFORMS=['flatAmount','flatHalfRange','flatU','flatV','flatNormal','flatWorld','flatInverse','flatViewProjection'];
export const FLAT_GLSL=`
#define flatSample(s,uv) texture2DLodEXT(s,uv,0.0)
uniform float flatAmount;uniform float flatHalfRange;uniform vec3 flatU;uniform vec3 flatV;uniform vec3 flatNormal;
uniform mat4 flatWorld;uniform mat4 flatInverse;uniform mat4 flatViewProjection;uniform sampler2D flatFoundation;
float flatAngle(vec3 p){return atan(dot(p,flatU),dot(p,flatV));}
float flatBase(float a){float x=clamp((a/6.283185307+.5)*511.0,0.0,511.0),i=floor(x);return mix(flatSample(flatFoundation,vec2((i+.5)/512.0,.5)).r,flatSample(flatFoundation,vec2((min(i+1.0,511.0)+.5)/512.0,.5)).r,x-i);}
vec3 flatLocal(vec3 p){float a=flatAngle(p);return flatU*(${RADIUS}*a)+flatV*(${RADIUS}+length(vec2(dot(p,flatU),dot(p,flatV)))-flatBase(a))+flatNormal*dot(p,flatNormal);}
vec3 flatPhysical(vec3 p){float a=dot(p,flatU)/${RADIUS},r=dot(p,flatV)-${RADIUS}+flatBase(a);return (flatU*sin(a)+flatV*cos(a))*r+flatNormal*dot(p,flatNormal);}
vec3 flatWorldPosition(vec3 p){vec3 q=(flatInverse*vec4(p,1.0)).xyz;return (flatWorld*vec4(mix(q,flatLocal(q),flatAmount),1.0)).xyz;}
bool flatInside(vec3 p){if(flatAmount<.999)return true;vec3 q=(flatInverse*vec4(p,1.0)).xyz;float a=flatAngle(q);return abs(a)<=flatHalfRange&&length(vec2(dot(q,flatU),dot(q,flatV)))>=flatBase(a)-.003;}
`;
export const FLAT_VERTEX_GLSL=FLAT_GLSL.replace('#define flatSample(s,uv) texture2DLodEXT(s,uv,0.0)','#define flatSample(s,uv) texture2D(s,uv)');
// Shared by ShaderMaterial, ordinary/instanced materials and particle effects.
export function bindFlat(effect:{setFloat:(n:string,v:number)=>unknown;setVector3:(n:string,v:Vector3)=>unknown;setMatrix:(n:string,v:Matrix)=>unknown;setTexture:(n:string,v:RawTexture)=>unknown},projection:SectionProjection,scene:Scene){
  effect.setFloat('flatAmount',projection.amount);effect.setFloat('flatHalfRange',projection.halfRange);effect.setVector3('flatU',projection.u);effect.setVector3('flatV',projection.v);effect.setVector3('flatNormal',projection.normal);effect.setMatrix('flatWorld',projection.world);effect.setMatrix('flatInverse',projection.inverse);effect.setMatrix('flatViewProjection',scene.getTransformMatrix());effect.setTexture('flatFoundation',projection.texture);
}
