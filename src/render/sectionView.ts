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
import {PHYSICS_DT} from '../sim/clock';

export class SectionView {
  readonly mesh:Mesh;private baseline:LinesMesh;private flat=false;private owners:number[]=[];private physicalPositions:Vector3[]=[];private flatPositions:Vector3[]=[];private projection?:SectionProjection;private visible=false;
  private climateColors:Float32Array|null=null;
  private precipitation:Float32Array;private precipitationDt=PHYSICS_DT;private showPrecipitation=false;
  constructor(scene:Scene,root:TransformNode,private grid:SphereGrid){
    this.baseline=MeshBuilder.CreateLines('surface profile datum',{points:Array.from({length:65},()=>Vector3.Zero()),updatable:true},scene);this.baseline.parent=root;this.baseline.color=new Color3(.47,.60,.65);this.baseline.isPickable=false;this.baseline.setEnabled(false);
    this.precipitation=new Float32Array(grid.count*2);this.mesh=new Mesh('live material cross section',scene);this.mesh.parent=root;this.mesh.alwaysSelectAsActiveMesh=true;
    this.mesh.material=sectionShader(scene,'section minerals and water',{vertexSource:`precision highp float;
attribute vec3 position;attribute vec3 normal;attribute vec4 color;attribute vec4 climateColor;attribute vec4 sectionData;attribute float snowFraction;uniform mat4 world;uniform mat4 worldViewProjection;
varying vec4 climateTint;varying vec3 point;varying vec4 tint;varying vec4 cell;varying float frozenPrecipitation;
void main(){climateTint=climateColor;point=position;tint=color;cell=sectionData;frozenPrecipitation=snowFraction;gl_Position=worldViewProjection*vec4(position,1.0);}`,
    fragmentSource:`precision highp float;varying vec4 climateTint;varying vec3 point;varying vec4 tint;varying vec4 cell;varying float frozenPrecipitation;uniform float surfaceTime;
float grain(vec3 p){return fract(sin(dot(floor(p*92.0),vec3(12.9898,78.233,31.27))+cell.y*19.17)*43758.5453);}
void main(){if(flatAmount>0.0&&cell.z<.5)discard;float fleck=grain(point);vec3 color=tint.rgb*(.88+.18*fleck);
// Neutral, static foundation texture. It carries no simulated heat or layers.
if(cell.z<.5){float relief=.5+.5*sin(point.x*7.0+sin(point.y*5.0))*sin(point.y*9.0+point.z*3.0);color=tint.rgb*(.94+.035*fleck+.06*relief);}
if(cell.z>1.5)color=tint.rgb*(.85+.15*sin(point.y*44.0+point.x*21.0+surfaceTime*1.5));
float hot=clamp((cell.x-45.0)/900.0,0.0,.9);if(cell.z>.5)color=mix(color,vec3(1,.30,.06),pow(hot,.65)*.85);
vec3 precipitationColor=mix(vec3(${PRECIPITATION_COLORS.rain.join(',')}),vec3(${PRECIPITATION_COLORS.snow.join(',')}),frozenPrecipitation);
color=mix(color,climateTint.rgb,climateTint.a);color=mix(color,precipitationColor,cell.w*.55);gl_FragColor=vec4(color,1.0);}`},
    {attributes:['position','normal','color','climateColor','sectionData','snowFraction'],uniforms:['world','worldViewProjection','surfaceTime']});
    this.mesh.material.backFaceCulling=false;this.mesh.setEnabled(false);
  }
  update(terrain:Float32Array,water:Float32Array,owners:Uint32Array,state:Float32Array,normal:Vector3,width:number,samples?:SectionSamples,hideBedrock=false){
    const result=buildSectionMesh(terrain,water,owners,state,this.grid,normal,width,this.showPrecipitation?this.precipitation:undefined,this.precipitationDt,samples,hideBedrock);
    this.owners=result.owners;this.physicalPositions=Array.from({length:result.positions.length/3},(_,i)=>Vector3.FromArray(result.positions,i*3));if(!result.indices.length){this.mesh.setEnabled(false);return result;}const data=new VertexData();data.positions=result.positions;data.normals=result.normals;data.colors=result.colors;data.indices=result.indices;data.applyToMesh(this.mesh,true);this.mesh.setVerticesData('sectionData',result.data,true,4);this.mesh.setVerticesData('snowFraction',result.snowFractions,true,1);this.setClimateColors(this.climateColors);
    this.mesh.setEnabled(this.visible&&result.indices.length>0);return result;
  }
  setClimateColors(colors:Float32Array|null){this.climateColors=colors;const data=new Float32Array(this.owners.length*3*4);if(colors)for(let t=0;t<this.owners.length;t++){const owner=this.owners[t];if(owner>=0)for(let k=0;k<3;k++)data.set(colors.subarray(owner*4,owner*4+4),(t*3+k)*4);}if(data.length)this.mesh.setVerticesData('climateColor',data,true,4);}
  setVisible(visible:boolean){this.visible=visible;this.mesh.setEnabled(visible&&this.owners.length>0);this.baseline.setEnabled(visible&&this.flat);}
  setPrecipitation(precipitation:Float32Array,dt:number){if(dt>0){this.precipitation.set(precipitation);this.precipitationDt=dt;}}
  clearPrecipitation(){this.precipitation.fill(0);this.precipitationDt=PHYSICS_DT;}
  showRain(visible:boolean){this.showPrecipitation=visible;}
  setTime(time:number){(this.mesh.material as ShaderMaterial).setFloat('surfaceTime',time);}
  updateProjection(projection:SectionProjection){this.projection=projection;this.flatPositions=this.physicalPositions.map(p=>projection.forward(p));this.flat=projection.amount>0;
    const z=this.physicalPositions.length?Vector3.Dot(this.physicalPositions[0],projection.normal):0,points=Array.from({length:65},(_,i)=>projection.backward(projection.u.scale(RADIUS*projection.halfRange*(i/32-1)).add(projection.v.scale(RADIUS)).add(projection.normal.scale(z-.00005))));
    MeshBuilder.CreateLines('surface profile datum',{points,instance:this.baseline},this.mesh.getScene());this.baseline.setEnabled(this.visible&&this.flat);
  }
  pickFlat(ray:Ray){let distance=Infinity,owner=-1;for(let i=0;i<this.owners.length;i++){if(this.owners[i]<0)continue;const hit=ray.intersectsTriangle(this.flatPositions[i*3],this.flatPositions[i*3+1],this.flatPositions[i*3+2]);if(hit&&hit.bu!==null&&hit.bv!==null&&hit.distance<distance&&hit.distance<=ray.length){const source=this.physicalPositions[i*3].scale(hit.bu).add(this.physicalPositions[i*3+1].scale(hit.bv)).add(this.physicalPositions[i*3+2].scale(1-hit.bu-hit.bv));if(this.projection?.contains(source)){distance=hit.distance;owner=this.owners[i];}}}return owner;}
  owner(face:number){return this.owners[face]??-1;}
  stats(){const owners=this.projection?.amount===1?this.owners.filter((owner,i)=>owner>=0&&this.projection!.contains(this.physicalPositions[i*3].add(this.physicalPositions[i*3+1]).add(this.physicalPositions[i*3+2]).scale(1/3))&&Vector3.Cross(this.flatPositions[i*3+1].subtract(this.flatPositions[i*3]),this.flatPositions[i*3+2].subtract(this.flatPositions[i*3])).lengthSquared()>1e-10):this.owners;return {visible:this.mesh.isEnabled(),triangles:owners.length,cells:new Set(owners.filter(i=>i>=0)).size};}
}
