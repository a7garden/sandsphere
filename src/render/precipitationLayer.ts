import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import type {Scene} from '@babylonjs/core/scene';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {sectionShader} from './sectionClip';

import {PRECIPITATION_THRESHOLD as THRESHOLD,PRECIPITATION_COLORS,precipitationOpacity,precipitationSample} from './precipitation';
export {PRECIPITATION_COLORS,precipitationOpacity} from './precipitation';

/** A diagnostic map of the latest solver step, independent of cloud visibility. */
export class PrecipitationLayer {
  private mesh:Mesh;
  private colors:Float32Array;
  private positions:Float32Array;
  private precipitation:Float32Array;
  private surface:Float32Array|null=null;
  private enabled=false;
  private inSystem=false;
  private rainCells=0;
  private snowCells=0;
  private cells=0;
  private stepSeconds=1/30;
  private intensityRange=[0,0];
  constructor(scene:Scene,root:TransformNode,private owners:Uint32Array,cellCount:number){
    this.positions=new Float32Array(owners.length*9);
    this.colors=new Float32Array(owners.length*12);
    this.precipitation=new Float32Array(cellCount*2);
    this.mesh=new Mesh('precipitation regions',scene);this.mesh.parent=root;
    this.mesh.isPickable=false;this.mesh.useVertexColors=true;this.mesh.hasVertexAlpha=true;
    // Draw the diagnostic tint above clouds. Clip the hidden hemisphere in the
    // shader because this group deliberately does not use cloud/terrain depth.
    this.mesh.renderingGroupId=3;scene.setRenderingAutoClearDepthStencil(3,true,true,true);
    const material=sectionShader(scene,'precipitation map',{vertexSource:`precision highp float;
attribute vec3 position;attribute vec4 color;uniform mat4 world;uniform mat4 worldViewProjection;
varying vec3 point;varying vec3 center;varying vec4 tint;
void main(){point=(world*vec4(position,1.0)).xyz;center=world[3].xyz;tint=color;gl_Position=worldViewProjection*vec4(position,1.0);}`,
      fragmentSource:`precision highp float;
uniform vec3 eye;varying vec3 point;varying vec3 center;varying vec4 tint;
void main(){if(tint.a<0.01||(sectionHalfWidth>100.0&&dot(normalize(point-center),normalize(eye-point))<=0.0))discard;gl_FragColor=tint;}`,
    },{attributes:['position','color'],uniforms:['world','worldViewProjection','eye'],needAlphaBlending:true});
    material.backFaceCulling=true;material.disableDepthWrite=true;
    material.onBindObservable.add(()=>{if(scene.activeCamera)material.setVector3('eye',scene.activeCamera.globalPosition);});
    this.mesh.material=material;
    const data=new VertexData();data.positions=this.positions;data.colors=this.colors;
    data.indices=Uint32Array.from({length:owners.length*3},(_,i)=>i);data.applyToMesh(this.mesh,true);
    this.mesh.setEnabled(false);
  }
  updateSurface(surface:Float32Array){
    this.surface=surface;
    if(this.enabled&&!this.inSystem)this.uploadSurface();
  }
  private uploadSurface(){
    if(!this.surface)return;
    for(let i=0;i<this.positions.length;i++)this.positions[i]=this.surface[i]*1.001;
    this.mesh.updateVerticesData(VertexBuffer.PositionKind,this.positions,true);
  }
  update(precipitation:Float32Array,dt=1/30){
    if(dt<=0)return;
    this.stepSeconds=dt;this.intensityRange=[Infinity,0];
    this.precipitation.set(precipitation);this.rainCells=0;this.snowCells=0;this.cells=0;
    for(let i=0;i<precipitation.length;i+=2){
      const rain=precipitation[i]>THRESHOLD,snow=precipitation[i+1]>THRESHOLD;
      if(rain)this.rainCells++;if(snow)this.snowCells++;if(rain||snow){this.cells++;const opacity=precipitationOpacity(((rain?precipitation[i]:0)+(snow?precipitation[i+1]:0))/dt);this.intensityRange[0]=Math.min(this.intensityRange[0],opacity);this.intensityRange[1]=Math.max(this.intensityRange[1],opacity);}
    }
    if(!this.cells)this.intensityRange=[0,0];
    if(this.enabled&&!this.inSystem)this.uploadColors();
    this.syncVisibility();
  }
  private uploadColors(){
    for(let triangle=0;triangle<this.owners.length;triangle++){
      const cell=this.owners[triangle],rain=this.precipitation[cell*2]>THRESHOLD?this.precipitation[cell*2]:0,snow=this.precipitation[cell*2+1]>THRESHOLD?this.precipitation[cell*2+1]:0;
      const sample=precipitationSample(rain,snow,this.stepSeconds),frozen=sample.snowFraction;
      for(let corner=0;corner<3;corner++){
        const offset=triangle*12+corner*4;
        for(let c=0;c<3;c++)this.colors[offset+c]=PRECIPITATION_COLORS.rain[c]*(1-frozen)+PRECIPITATION_COLORS.snow[c]*frozen;
        this.colors[offset+3]=sample.intensity;
      }
    }
    this.mesh.updateVerticesData(VertexBuffer.ColorKind,this.colors);
  }
  private syncVisibility(){this.mesh.setEnabled(this.enabled&&!this.inSystem&&this.cells>0);}
  setVisible(enabled:boolean){this.enabled=enabled;if(enabled&&!this.inSystem){this.uploadSurface();this.uploadColors();}this.syncVisibility();}
  setInSystem(inSystem:boolean){this.inSystem=inSystem;if(!inSystem&&this.enabled){this.uploadSurface();this.uploadColors();}this.syncVisibility();}
  clear(){this.precipitation.fill(0);this.rainCells=0;this.snowCells=0;this.cells=0;this.intensityRange=[0,0];this.syncVisibility();}
  stats(){return {enabled:this.enabled,visible:this.mesh.isEnabled(),rainCells:this.rainCells,snowCells:this.snowCells,highlightedCells:this.cells,intensityRange:[...this.intensityRange]};}
}
