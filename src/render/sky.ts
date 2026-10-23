import {smokeColumn} from './smokeField';
import type {LayeredAtmosphere} from '../sim/layeredAtmosphere';
import {CLOUD_DISPLAY_SCALE} from '../sim/layeredAtmosphere';
import {CloudBanks,type CloudStyle} from './cloudBanks';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {RawTexture} from '@babylonjs/core/Materials/Textures/rawTexture';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {Constants} from '@babylonjs/core/Engines/constants';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color3} from '@babylonjs/core/Maths/math.color';
import type {Scene} from '@babylonjs/core/scene';
import type {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {SphereGrid} from '../sim/sphere';
import {F,STRIDE,type Environment} from '../sim/model';
import type {AtmosphereState} from '../sim/atmosphere';
import {atmosphereOptics} from '../sim/optics';
import type {DeepAtmosphere} from '../sim/deepAtmosphere';
import {sectionShader} from './sectionClip';

const WIDTH=128,HEIGHT=64;
const vertexSource=`precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
uniform float outerRadius;
varying vec3 vLocalPosition;
void main(){vLocalPosition=position*outerRadius;gl_Position=worldViewProjection*vec4(position,1.0);}`;
const fragmentSource=`precision highp float;
varying vec3 vLocalPosition;
uniform vec3 cameraLocal;
uniform mat4 sectionWorldToLocal;uniform mat4 sectionLocalToWorld;
uniform vec3 sunLocal;
uniform vec3 airColor;
uniform float outerRadius;
uniform float surfaceRadius;
uniform float cloudRadius;
uniform float cloudInnerRadius;
uniform float cloudTime;
uniform float rotationRate;
uniform float airHeight;
uniform float airOpacity;
uniform float showAir;
uniform float showClouds;
uniform float blackSpace;
uniform sampler2D densityMap;
uniform sampler2D smokeMap;
vec2 sphereHit(vec3 origin,vec3 ray,float radius){float b=dot(origin,ray);float h=b*b-dot(origin,origin)+radius*radius;if(h<0.0)return vec2(-1.0);h=sqrt(h);return vec2(-b-h,-b+h);}
vec4 column(vec3 p){vec3 n=normalize(p);return texture2DLodEXT(densityMap,vec2(atan(n.z,n.x)/6.2831853+.5,acos(clamp(n.y,-1.0,1.0))/3.14159265),0.0);}
float groundAt(vec4 stock){return (stock.b*65280.0+stock.a*255.0)/65535.0*12.0;}
void main(){
 bool outside=length(cameraLocal)>outerRadius;
 if((outside&&!gl_FrontFacing)||(!outside&&gl_FrontFacing))discard;
 vec3 origin=(sectionWorldToLocal*vec4(sectionRayOrigin(),1.0)).xyz;
 vec3 ray=normalize((sectionWorldToLocal*vec4(sectionRayDirection(),0.0)).xyz);vec2 bounds=sphereHit(origin,ray,outerRadius);
 float start=max(0.0,bounds.x),end=bounds.y;
 vec2 groundHit=sphereHit(origin,ray,surfaceRadius-.08);if(sectionHalfWidth>surfaceRadius&&groundHit.x>0.0)end=min(end,groundHit.x);
 vec2 slab=sectionInterval(sectionRayOrigin(),sectionRayDirection(),vec2(start,end));start=slab.x;end=slab.y;
 if(end<=start)discard;
 // Only the atmospheric veil is integrated here; the connected cloud envelope uses solver stock.
 vec3 result=vec3(0.0);float trans=1.0;
 for(int i=0;i<12;i++){
  float stepAir=(end-start)/12.0;vec3 p=origin+ray*(start+(float(i)+.5)*stepAir);vec4 stock=column(p);
  float height=length(p)-groundAt(stock);float daylight=dot(normalize(p),sunLocal);float lit=.06+.94*smoothstep(-.18,.65,daylight);
  float opacity=height<0.0||!sectionInside((sectionLocalToWorld*vec4(p,1.0)).xyz)?0.0:1.0-exp(-showAir*airOpacity*exp(-height/max(.08,airHeight*.20))*stepAir*.72);
  float sunset=pow(max(0.0,1.0-abs(daylight)*4.0),3.0);
  vec3 scatter=mix(airColor,vec3(.85,.49,.26),sunset*.18);
  result+=trans*opacity*scatter*(.18+.82*lit);trans*=1.0-opacity;
  vec3 normal=normalize(p);vec2 uv=vec2(atan(normal.z,normal.x)/6.2831853+.5,acos(clamp(normal.y,-1.0,1.0))/3.14159265);
  vec2 smoke=texture2DLodEXT(smokeMap,uv,0.0).rg;
  float profile=exp(-pow((height-smoke.g)/.10,2.0));
  float smokeAlpha=height<0.0||!sectionInside((sectionLocalToWorld*vec4(p,1.0)).xyz)?0.0:1.0-exp(-showAir*smoke.r*profile*stepAir*30.0);
  result+=trans*smokeAlpha*vec3(.17,.14,.12)*(.30+.70*lit);trans*=1.0-smokeAlpha;
 }
 float alpha=1.0-trans;if(alpha<.003)discard;
 gl_FragColor=vec4(result/max(.0001,alpha),alpha);
}`;

/** The texture carries conserved cloud stock for shade and terrain height for the air veil. */
export class SkyLayers {
  private mesh:Mesh;
  private banks:CloudBanks;
  private material:ShaderMaterial;
  private texture:RawTexture;
  private smokeTexture:RawTexture;
  private smokePixels=new Uint8Array(WIDTH*HEIGHT*4);
  private smokeStock=0;
  private pixels=new Uint8Array(WIDTH*HEIGHT*4);
  private samples=new Uint32Array(WIDTH*HEIGHT*3);
  private weights=new Float32Array(WIDTH*HEIGHT*3);
  private atmosphereVisible=true;
  private cloudsVisible=true;
  private sun=Vector3.Right();
  private cloudStock=0;
  private deep=false;
  constructor(private scene:Scene,private root:TransformNode,private grid:SphereGrid) {
    this.banks=new CloudBanks(scene,root,grid);
    // Cache three nearby columns per texel, including the longitude seam.
    for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
      const theta=(y+.5)/HEIGHT*Math.PI,phi=((x+.5)/WIDTH-.5)*Math.PI*2;
      const nx=Math.sin(theta)*Math.cos(phi),ny=Math.cos(theta),nz=Math.sin(theta)*Math.sin(phi);
      const near=[-2,-2,-2],indices=[0,0,0];
      for(let i=0;i<grid.count;i++){
        const dot=nx*grid.directions[i*3]+ny*grid.directions[i*3+1]+nz*grid.directions[i*3+2];
        for(let k=0;k<3;k++)if(dot>near[k]){for(let l=2;l>k;l--){near[l]=near[l-1];indices[l]=indices[l-1];}near[k]=dot;indices[k]=i;break;}
      }
      const w=near.map(dot=>1/Math.max(1e-5,1-dot)),sum=w.reduce((a,b)=>a+b,0),p=(y*WIDTH+x)*3;
      this.samples.set(indices,p);this.weights.set(w.map(v=>v/sum),p);
    }
    this.texture=new RawTexture(this.pixels,WIDTH,HEIGHT,Constants.TEXTUREFORMAT_RGBA,scene,false,false,Texture.BILINEAR_SAMPLINGMODE,Constants.TEXTURETYPE_UNSIGNED_BYTE);
    this.smokeTexture=new RawTexture(this.smokePixels,WIDTH,HEIGHT,Constants.TEXTUREFORMAT_RGBA,scene,false,false,Texture.BILINEAR_SAMPLINGMODE,Constants.TEXTURETYPE_UNSIGNED_BYTE);
    this.smokeTexture.wrapU=Texture.WRAP_ADDRESSMODE;this.smokeTexture.wrapV=Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapU=Texture.WRAP_ADDRESSMODE;this.texture.wrapV=Texture.CLAMP_ADDRESSMODE;
    this.material=sectionShader(scene,'atmospheric scattering',{vertexSource,fragmentSource},{attributes:['position'],uniforms:['worldViewProjection','outerRadius','surfaceRadius','cloudRadius','cloudInnerRadius','cloudTime','rotationRate','cameraLocal','sunLocal','airColor','airHeight','airOpacity','showAir','showClouds','blackSpace','sectionWorldToLocal','sectionLocalToWorld'],samplers:['densityMap','smokeMap'],needAlphaBlending:true},'(world*vec4(position,1.0)).xyz',false);
    // Rays stop at the modeled ground, including when the camera is inside the outer shell.
    this.material.backFaceCulling=false;this.material.disableDepthWrite=true;this.material.depthFunction=Constants.ALWAYS;this.material.alphaMode=Constants.ALPHA_COMBINE;
    this.material.setTexture('smokeMap',this.smokeTexture);this.material.setTexture('densityMap',this.texture);this.material.setFloat('outerRadius',7);this.material.setFloat('surfaceRadius',5.4);this.material.setFloat('airHeight',.5);this.material.setFloat('airOpacity',0);this.material.setColor3('airColor',new Color3(.3,.6,.9));this.setVisible(true,true);this.setSpace(true);
    this.mesh=MeshBuilder.CreateSphere('atmospheric veil',{diameter:2,segments:64},scene);
    this.mesh.material=this.material;this.mesh.parent=root;this.mesh.isPickable=false;this.mesh.alwaysSelectAsActiveMesh=true;this.mesh.renderingGroupId=1;
    this.mesh.onBeforeRenderObservable.add(()=>{
      const inverse=root.getWorldMatrix().clone().invert();
      this.material.setMatrix('sectionWorldToLocal',inverse);this.material.setMatrix('sectionLocalToWorld',root.getWorldMatrix());
      this.material.setVector3('cameraLocal',Vector3.TransformCoordinates(scene.activeCamera!.globalPosition,inverse));
      this.material.setVector3('sunLocal',Vector3.TransformNormal(this.sun,inverse).normalize());
    });
  }
  update(state:Float32Array,radii:Float32Array,info:AtmosphereState,e:Environment,atmosphereRadius:number,giant?:DeepAtmosphere,air?:LayeredAtmosphere) {
    this.deep=!!info.deep;
    let mean=0,max=0,min=Infinity;this.cloudStock=0;
    for(let i=0;i<this.grid.count;i++){mean+=radii[i];max=Math.max(max,radii[i]);min=Math.min(min,radii[i]);this.cloudStock+=state[i*STRIDE+F.cloud]+state[i*STRIDE+F.cloudIce]+state[i*STRIDE+F.ammoniaCloud]+state[i*STRIDE+F.ammoniaIce];}
    const projected=this.deep&&giant?Array.from({length:this.grid.count},(_,i)=>-Math.expm1(-giant.cloudOptics(i).ammoniaOpticalDepth*.065)):null;
    const smoke=Array.from({length:this.grid.count},(_,i)=>smokeColumn(state,i,e.climate&&!this.deep?air:undefined));this.smokeStock=smoke.reduce((sum,c)=>sum+c.mass,0);
    mean/=this.grid.count;
    for(let p=0;p<WIDTH*HEIGHT;p++){
      let cloud=0,ice=0,ground=0,smokeOpacity=0,smokeHeight=0;
      for(let k=0;k<3;k++){const i=this.samples[p*3+k],w=this.weights[p*3+k];cloud+=state[i*STRIDE+F.cloud]*w;ice+=state[i*STRIDE+F.cloudIce]*w;ground+=radii[i]*w;smokeOpacity+=smoke[i].opacity*w;smokeHeight+=smoke[i].height*w;}
      this.smokePixels[p*4]=Math.round(smokeOpacity*255);this.smokePixels[p*4+1]=Math.round(smokeHeight*255);
      this.pixels[p*4]=projected?Math.round(255*[0,1,2].reduce((a,k)=>a+projected[this.samples[p*3+k]]*this.weights[p*3+k],0)):Math.round((1-Math.exp(-cloud*6*(e.climate?CLOUD_DISPLAY_SCALE:1)))*255);this.pixels[p*4+1]=projected?0:Math.round((1-Math.exp(-ice*6*(e.climate?CLOUD_DISPLAY_SCALE:1)))*255);const encoded=Math.round(Math.min(1,ground/12)*65535);this.pixels[p*4+2]=encoded>>8;this.pixels[p*4+3]=encoded&255;
    }
    this.texture.update(this.pixels);this.smokeTexture.update(this.smokePixels);
    const outer=Math.max(max+.82,atmosphereRadius),optics=atmosphereOptics(info,e);
    this.mesh.scaling.setAll(outer);this.material.setFloat('outerRadius',outer);this.material.setFloat('surfaceRadius',mean);this.material.setFloat('cloudRadius',max+.30);this.material.setFloat('cloudInnerRadius',min+.04);
    this.material.setFloat('rotationRate',e.rotationRate??0);this.material.setFloat('airHeight',Math.max(.08,atmosphereRadius-mean));this.material.setFloat('airOpacity',optics.opacity);this.material.setColor3('airColor',Color3.FromArray(optics.color));
    if(!this.deep)this.banks.update(state,radii,!!e.climate);this.banks.setVisible(this.cloudsVisible&&!this.deep);this.mesh.setEnabled(this.atmosphereVisible&&(info.mass>.01||this.smokeStock>0));
  }
  get densityTexture(){return this.texture;}
  setCloudAppearance(flat:boolean,opacity:number){this.banks.setAppearance(flat,opacity);}
  setCloudStyle(style:CloudStyle){this.banks.setStyle(style);}
  animate(dt:number){this.banks.animate(dt);}
  setTime(time:number){this.material.setFloat('cloudTime',time);}
  setSun(sun:readonly number[]){this.sun.copyFromFloats(sun[0],sun[1],sun[2]);this.banks.setSun(sun);}
  setVisible(atmosphere:boolean,clouds:boolean){this.atmosphereVisible=atmosphere;this.cloudsVisible=clouds;this.material.setFloat('showAir',atmosphere?1:0);this.material.setFloat('showClouds',clouds?1:0);this.banks.setVisible(clouds&&!this.deep);if(this.mesh)this.mesh.setEnabled(atmosphere);}
  setSpace(black:boolean){this.material.setFloat('blackSpace',black?1:0);}
  stats(){return {...this.banks.stats(),...(this.deep?{cloudRenderer:'giant-optical-columns',cloudRenderedMass:this.cloudStock,cloudDraws:0}:{}),smokeRenderedMass:this.smokeStock,cloudVolumeMass:this.cloudStock,layers:{atmosphere:this.atmosphereVisible,clouds:this.cloudsVisible}};}
}
