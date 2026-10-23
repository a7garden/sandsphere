import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import type {LinesMesh} from '@babylonjs/core/Meshes/linesMesh';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {RADIUS} from '../sim/sphere';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {Ray} from '@babylonjs/core/Culling/ray';
import type {SectionProjection} from './sectionProjection';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {SphereGrid} from '../sim/sphere';
import {buildSectionMesh,type SectionSamples} from './sectionGeometry';
import {sectionShader} from './sectionClip';
import type {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {PRECIPITATION_COLORS} from './precipitation';
import {POWDER_COLOR_GLSL} from './sectionPowder';
import type {SectionWindow} from './sectionArc';
import {PHYSICS_DT} from '../sim/clock';
import {F,STRIDE} from '../sim/model';
import {precipitationSample} from './precipitation';

export class SectionView {
  readonly mesh:Mesh;private baseline:LinesMesh;private flat=false;private owners:number[]=[];private physicalPositions:Vector3[]=[];private flatPositions:Vector3[]=[];private projection?:SectionProjection;private visible=false;private projectionStamp:number[]=[];
  private climateColors:Float32Array|null=null;
  private temperatureSamples:number[]=[];
  private readingData=new Float32Array(0);
  private snowData=new Float32Array(0);
  private climateData=new Float32Array(0);
  private precipitation:Float32Array;private precipitationDt=PHYSICS_DT;private showPrecipitation=false;
  constructor(scene:Scene,root:TransformNode,private grid:SphereGrid){
    this.baseline=MeshBuilder.CreateLines('surface profile datum',{points:Array.from({length:65},()=>Vector3.Zero()),updatable:true},scene);this.baseline.parent=root;this.baseline.color=new Color3(.38,.43,.45);this.baseline.alpha=.65;this.baseline.isPickable=false;this.baseline.setEnabled(false);
    this.precipitation=new Float32Array(grid.count*2);this.mesh=new Mesh('live material cross section',scene);this.mesh.parent=root;this.mesh.alwaysSelectAsActiveMesh=true;
    this.mesh.material=sectionShader(scene,'section minerals and water',{vertexSource:`precision highp float;
attribute vec3 position;attribute vec4 color;attribute vec4 climateColor;attribute vec4 sectionData;attribute float snowFraction;attribute vec4 powder0;attribute vec4 powder1;attribute vec4 powder2;uniform mat4 world;uniform mat4 worldViewProjection;
varying vec4 mix0;varying vec4 mix1;varying vec4 mix2;varying vec4 climateTint;varying vec3 point;varying vec4 tint;varying vec4 cell;varying float frozenPrecipitation;
void main(){mix0=powder0;mix1=powder1;mix2=powder2;climateTint=climateColor;point=position;tint=color;cell=sectionData;frozenPrecipitation=snowFraction;gl_Position=worldViewProjection*vec4(position,1.0);}`,
    fragmentSource:`precision highp float;varying vec4 mix0;varying vec4 mix1;varying vec4 mix2;varying vec4 climateTint;varying vec3 point;varying vec4 tint;varying vec4 cell;varying float frozenPrecipitation;uniform float surfaceTime;uniform float powderSize;uniform float powderDetail;
${POWDER_COLOR_GLSL}
float grain(vec3 p){return fract(sin(dot(floor(p*92.0),vec3(12.9898,78.233,31.27))+cell.y*19.17)*43758.5453);}
void main(){if(flatAmount>0.0&&cell.z<.5)discard;float fleck=grain(point);vec3 color=tint.rgb*(.88+.18*fleck);
if(flatAmount>.999&&cell.z>.5){
vec3 local=(flatInverse*vec4(sectionWorldPosition,1.0)).xyz;
vec3 displayed=flatLocal(local);vec2 pos=vec2(dot(displayed,flatU),dot(displayed,flatV))/powderSize;
// Stagger the grains and soften their silhouette, without drawing a false cell grid.
pos.x+=.5*mod(floor(pos.y),2.0);
vec2 tile=floor(pos);float r=fract(sin(dot(tile,vec2(12.9898,78.233))+cell.y*19.17)*43758.5453);
vec2 center=vec2(.5)+.12*vec2(sin(r*61.0),cos(r*47.0));
float edge=length((fract(pos)-center)*vec2(1.0,.88));
// World-anchored grains retain their material identity while zooming. Fixed
// feathering avoids derivatives after non-uniform section clipping on WebGPU.
float grainCoverage=1.0-smoothstep(.30,.58,edge);
color=mix(tint.rgb,powderColor(r)*(.94+.10*r),grainCoverage*powderDetail);
// Liquid has a continuous surface; it must not inherit the solid grain pattern.
if(cell.z>1.5)color=tint.rgb*(.97+.03*sin(displayed.y*6.0));
}
// Neutral, static foundation texture. It carries no simulated heat or layers.
if(cell.z<.5){float relief=.5+.5*sin(point.x*7.0+sin(point.y*5.0))*sin(point.y*9.0+point.z*3.0);color=tint.rgb*(.94+.035*fleck+.06*relief);}
float hot=clamp((cell.x-525.0)/1100.0,0.0,.9);if(cell.z>.5)color=mix(color,vec3(1,.30,.06),pow(hot,.8)*.85);
vec3 precipitationColor=mix(vec3(${PRECIPITATION_COLORS.rain.join(',')}),vec3(${PRECIPITATION_COLORS.snow.join(',')}),frozenPrecipitation);
color=mix(color,climateTint.rgb,climateTint.a);color=mix(color,precipitationColor,cell.w*.55);gl_FragColor=vec4(color,1.0);}`},
    {attributes:['position','color','climateColor','sectionData','snowFraction','powder0','powder1','powder2'],uniforms:['world','worldViewProjection','surfaceTime','powderSize','powderDetail']});
    this.setPowderSize(.02);this.mesh.material.backFaceCulling=false;this.mesh.setEnabled(false);
  }
  update(terrain:Float32Array,water:Float32Array,owners:Uint32Array,state:Float32Array,normal:Vector3,width:number,samples?:SectionSamples,hideBedrock=false,window?:SectionWindow){
    const result=buildSectionMesh(terrain,water,owners,state,this.grid,normal,width,this.showPrecipitation?this.precipitation:undefined,this.precipitationDt,samples,hideBedrock,window,hideBedrock);
    this.mesh.position.copyFrom(normal.scale(window?-width+.0001:0));this.baseline.position.copyFrom(this.mesh.position);
    this.projectionStamp=[];this.owners=result.owners;this.temperatureSamples=result.temperatureSamples;this.readingData=new Float32Array(result.data);this.snowData=new Float32Array(result.snowFractions);this.physicalPositions=Array.from({length:result.positions.length/3},(_,i)=>Vector3.FromArray(result.positions,i*3));if(!result.indices.length){this.mesh.setEnabled(false);return result;}const data=new VertexData();data.positions=result.positions;data.normals=result.normals;data.colors=result.colors;data.indices=result.indices;data.applyToMesh(this.mesh,true);this.mesh.setVerticesData('sectionData',this.readingData,true,4);this.mesh.setVerticesData('snowFraction',this.snowData,true,1);for(let c=0;c<3;c++){const values=[];for(let v=0;v<result.positions.length/3;v++)values.push(...result.powders.slice(v*12+c*4,v*12+c*4+4));this.mesh.setVerticesData('powder'+c,values,true,4);}this.setClimateColors(this.climateColors);
    this.mesh.setEnabled(this.visible&&result.indices.length>0);return result;
  }
  /** Temperature and completed precipitation steps do not change cap geometry. */
  updateReadings(state:Float32Array){
    let changed=false,snowChanged=false;
    for(let t=0;t<this.owners.length;t++){
      const owner=this.owners[t],sample=this.temperatureSamples[t];
      const temperature=sample>=0?state[sample*STRIDE+F.temperature]:18;
      const rain=owner>=0&&this.showPrecipitation?precipitationSample(this.precipitation[owner*2],this.precipitation[owner*2+1],this.precipitationDt):{intensity:0,snowFraction:0};
      for(let k=0;k<3;k++){
        const v=t*3+k,p=v*4;
        if(this.readingData[p]!==Math.fround(temperature)||this.readingData[p+3]!==Math.fround(rain.intensity)){this.readingData[p]=temperature;this.readingData[p+3]=rain.intensity;changed=true;}
        if(this.snowData[v]!==Math.fround(rain.snowFraction)){this.snowData[v]=rain.snowFraction;snowChanged=true;}
      }
    }
    if(changed)this.mesh.updateVerticesData('sectionData',this.readingData);
    if(snowChanged)this.mesh.updateVerticesData('snowFraction',this.snowData);
  }
  setClimateColors(colors:Float32Array|null){
    this.climateColors=colors;const length=this.owners.length*3*4,resize=this.climateData.length!==length;
    if(resize)this.climateData=new Float32Array(length);
    let changed=resize;
    for(let t=0;t<this.owners.length;t++)for(let k=0;k<3;k++)for(let c=0;c<4;c++){
      const owner=this.owners[t],p=(t*3+k)*4+c,value=colors&&owner>=0?colors[owner*4+c]:0;
      if(this.climateData[p]!==value){this.climateData[p]=value;changed=true;}
    }
    if(length){if(resize||!this.mesh.isVerticesDataPresent('climateColor'))this.mesh.setVerticesData('climateColor',this.climateData,true,4);else if(changed)this.mesh.updateVerticesData('climateColor',this.climateData);}
  }
  setVisible(visible:boolean){this.visible=visible;this.mesh.setEnabled(visible&&this.owners.length>0);this.baseline.setEnabled(visible&&this.flat);}
  setPrecipitation(precipitation:Float32Array,dt:number){if(dt>0){this.precipitation.set(precipitation);this.precipitationDt=dt;}}
  clearPrecipitation(){this.precipitation.fill(0);this.precipitationDt=PHYSICS_DT;}
  showRain(visible:boolean){this.showPrecipitation=visible;}
  setTime(time:number){(this.mesh.material as ShaderMaterial).setFloat('surfaceTime',time);}
  updateProjection(projection:SectionProjection){
    const stamp=[...projection.u.asArray(),...projection.v.asArray(),...projection.normal.asArray(),projection.heightScale,projection.stackDepth,projection.halfRange,Number(projection.amount>0)];
    if(stamp.length===this.projectionStamp.length&&stamp.every((v,i)=>v===this.projectionStamp[i]))return;this.projectionStamp=stamp;this.projection=projection;this.flatPositions=this.physicalPositions.map(p=>projection.forward(p));this.flat=projection.amount>0;
    const z=this.physicalPositions.length?Vector3.Dot(this.physicalPositions[0],projection.normal):0,points=Array.from({length:65},(_,i)=>projection.backward(projection.u.scale(RADIUS*projection.halfRange*(i/32-1)).add(projection.v.scale(RADIUS)).add(projection.normal.scale(z-.00005))));
    MeshBuilder.CreateLines('surface profile datum',{points,instance:this.baseline},this.mesh.getScene());this.baseline.setEnabled(this.visible&&this.flat);
  }
  setPowderSize(size:number,detail=1){const material=this.mesh.material as ShaderMaterial;material.setFloat('powderSize',size);material.setFloat('powderDetail',detail);}
  profileDepth(projection:SectionProjection){let depth=0;for(let i=0;i<this.physicalPositions.length;i++){const p=this.physicalPositions[i];if(this.owners[Math.floor(i/3)]<0||Math.abs(projection.angle(p))>projection.halfRange)continue;depth=Math.max(depth,Math.hypot(Vector3.Dot(p,projection.u),Vector3.Dot(p,projection.v))-projection.base(projection.angle(p)));}return depth;}
  pickFlat(ray:Ray){let distance=Infinity,owner=-1;for(let i=0;i<this.owners.length;i++){if(this.owners[i]<0)continue;const hit=ray.intersectsTriangle(this.flatPositions[i*3],this.flatPositions[i*3+1],this.flatPositions[i*3+2]);if(hit&&hit.bu!==null&&hit.bv!==null&&hit.distance<distance&&hit.distance<=ray.length){const source=this.physicalPositions[i*3].scale(hit.bu).add(this.physicalPositions[i*3+1].scale(hit.bv)).add(this.physicalPositions[i*3+2].scale(1-hit.bu-hit.bv));if(this.projection?.contains(source)){distance=hit.distance;owner=this.owners[i];}}}return owner;}
  get cellIds(){return [...new Set(this.owners.filter(i=>i>=0))].sort((a,b)=>a-b);}
  columnOwner(x:number){
    if(!this.projection)return -1;
    for(let i=0;i<this.owners.length;i++)if(this.owners[i]>=0){const values=[0,1,2].map(k=>Vector3.Dot(this.flatPositions[i*3+k],this.projection!.u));if(x>=Math.min(...values)-1e-7&&x<=Math.max(...values)+1e-7)return this.owners[i];}
    return -1;
  }
  owner(face:number){return this.owners[face]??-1;}
  stats(){const owners=this.projection?.amount===1?this.owners.filter((owner,i)=>owner>=0&&this.projection!.contains(this.physicalPositions[i*3].add(this.physicalPositions[i*3+1]).add(this.physicalPositions[i*3+2]).scale(1/3))&&Vector3.Cross(this.flatPositions[i*3+1].subtract(this.flatPositions[i*3]),this.flatPositions[i*3+2].subtract(this.flatPositions[i*3])).lengthSquared()>1e-10):this.owners;return {visible:this.mesh.isEnabled(),triangles:owners.length,cells:new Set(owners.filter(i=>i>=0)).size};}
}
