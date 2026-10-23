import {AIR_RADIUS,AIR_SECONDS} from '../sim/layeredAtmosphere';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import type {LinesMesh} from '@babylonjs/core/Meshes/linesMesh';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color3} from '@babylonjs/core/Maths/math.color';
import type {Scene} from '@babylonjs/core/scene';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import type {SphereGrid} from '../sim/sphere';
import type {Environment} from '../sim/model';
import {climateColor,type WeatherClimate,type ClimateLayer} from '../sim/weatherClimate';
import {sectionShader} from './sectionClip';

/** Observation only: actual cell diagnostics and velocities. No material edits. */
export class ClimateLayers {
 private mesh:Mesh;private arrows:LinesMesh;private colors:Float32Array;private positions=new Float32Array(0);private indices=new Uint32Array(0);private arrowMaterial:ShaderMaterial;
 cellColors:Float32Array;layer:ClimateLayer='none';private arrowCount=0;
 constructor(private scene:Scene,private root:TransformNode,private grid:SphereGrid){
  this.cellColors=new Float32Array(grid.count*4);this.colors=new Float32Array(0);
  this.mesh=new Mesh('climate cell map',scene);this.mesh.parent=root;this.mesh.isPickable=false;this.mesh.alwaysSelectAsActiveMesh=true;this.mesh.renderingGroupId=2;
  this.mesh.material=sectionShader(scene,'climate observation',{vertexSource:`precision highp float;attribute vec3 position;attribute vec4 color;uniform mat4 worldViewProjection;varying vec4 tint;void main(){tint=color;gl_Position=worldViewProjection*vec4(position,1.0);}`,fragmentSource:`precision highp float;varying vec4 tint;void main(){gl_FragColor=tint;}`},{attributes:['position','color'],uniforms:['world','worldViewProjection'],needAlphaBlending:true});this.mesh.material.backFaceCulling=false;this.mesh.material.disableDepthWrite=true;this.mesh.setEnabled(false);
  this.arrowMaterial=sectionShader(scene,'climate flow directions',{vertexSource:'precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;void main(){gl_Position=worldViewProjection*vec4(position,1.0);}',fragmentSource:'precision highp float;void main(){gl_FragColor=vec4(1.0,.98,.8,1.0);}'},{attributes:['position'],uniforms:['world','worldViewProjection']});
  this.arrows=this.createArrows([[Vector3.Zero(),Vector3.Zero()]]);this.arrows.setEnabled(false);
 }
 private createArrows(lines:Vector3[][]){const arrows=MeshBuilder.CreateLineSystem('climate velocity arrows',{lines,updatable:true},this.scene);arrows.parent=this.root;arrows.material=this.arrowMaterial;arrows.color=new Color3(1,.98,.80);arrows.isPickable=false;arrows.alwaysSelectAsActiveMesh=true;arrows.renderingGroupId=3;return arrows;}
 update(s:Float32Array,e:Environment,c:WeatherClimate,terrain:Float32Array,water:Float32Array,owners:Uint32Array){
  const active=this.layer!=='none';this.mesh.setEnabled(active);this.arrows.setEnabled(active&&(this.layer==='wind'||this.layer==='jets'||this.layer==='currents'));if(!active){this.cellColors.fill(0);return;}
  for(let i=0;i<this.grid.count;i++)this.cellColors.set(climateColor(this.layer,s,i,e,c),i*4);
  const resize=this.positions.length!==terrain.length;
  if(resize){this.positions=new Float32Array(terrain.length);this.colors=new Float32Array(terrain.length/3*4);this.indices=Uint32Array.from({length:terrain.length/3},(_,i)=>i);}
  const positions=this.positions;let positionsChanged=resize,colorsChanged=resize;
  for(let v=0;v<terrain.length/3;v++){const p=v*3;let r=Math.max(Math.hypot(terrain[p],terrain[p+1],terrain[p+2]),Math.hypot(water[p],water[p+1],water[p+2]))+.025;const n=Vector3.FromArray(terrain,p).normalize();for(let k=0;k<3;k++){const value=Math.fround((k===0?n.x:k===1?n.y:n.z)*r);if(positions[p+k]!==value){positions[p+k]=value;positionsChanged=true;}}const owner=owners[Math.floor(v/3)];for(let k=0;k<4;k++){const value=this.cellColors[owner*4+k];if(this.colors[v*4+k]!==value){this.colors[v*4+k]=value;colorsChanged=true;}}}
  if(resize){const data=new VertexData();data.positions=positions;data.colors=this.colors;data.indices=this.indices;data.applyToMesh(this.mesh,true);}
  else {if(positionsChanged)this.mesh.updateVerticesData('position',positions,true);if(colorsChanged)this.mesh.updateVerticesData('color',this.colors);}
  if(this.layer==='wind'||this.layer==='jets'||this.layer==='currents'){
   const lines:Vector3[][]=[],vel=this.layer==='currents'?c.currents:c.wind,stride=Math.max(1,Math.ceil(this.grid.count/260));
   const radii=new Float32Array(this.grid.count);for(let v=0;v<terrain.length/3;v++){const p=v*3;radii[owners[Math.floor(v/3)]]=Math.max(radii[owners[Math.floor(v/3)]],Math.hypot(positions[p],positions[p+1],positions[p+2]));}
   for(let i=0;i<this.grid.count;i+=stride){const vector=Vector3.FromArray(vel,i*3),speed=vector.length(),n=Vector3.FromArray(this.grid.directions,i*3);if(speed*c.air.radiusMeters/AIR_SECONDS<.001)continue;const center=n.scale(radii[i]+.04),t=vector.normalize(),length=Math.min(.32,.05+speed*c.air.radiusMeters/AIR_SECONDS*(this.layer!=='currents'?.0027:.135)),end=center.add(t.scale(length)),side=Vector3.Cross(n,t).scale(length*.22);lines.push([center,end],[end.subtract(t.scale(length*.3)).add(side),end,end.subtract(t.scale(length*.3)).subtract(side)]);}
   if(lines.length){if(lines.length!==this.arrowCount){this.arrows.dispose();this.arrows=this.createArrows(lines);}else MeshBuilder.CreateLineSystem('climate velocity arrows',{lines,instance:this.arrows},this.scene);this.arrowCount=lines.length;}else this.arrows.setEnabled(false);
  }
 }
 stats(){return {layer:this.layer,arrows:this.arrows.isEnabled()?this.arrowCount/2:0,cells:this.layer==='none'?0:this.grid.count};}
}
