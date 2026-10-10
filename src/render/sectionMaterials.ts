import {MaterialPluginBase} from '@babylonjs/core/Materials/materialPluginBase';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import type {UniformBuffer} from '@babylonjs/core/Materials/uniformBuffer';
import type {SubMesh} from '@babylonjs/core/Meshes/subMesh';
import {LinesMesh} from '@babylonjs/core/Meshes/linesMesh';
import {ParticleSystem} from '@babylonjs/core/Particles/particleSystem';
import {ShaderStore} from '@babylonjs/core/Engines/shaderStore';
import {particlesVertexShader} from '@babylonjs/core/Shaders/particles.vertex';
import {particlesPixelShader} from '@babylonjs/core/Shaders/particles.fragment';
import type {Scene} from '@babylonjs/core/scene';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {FLAT_GLSL,FLAT_VERTEX_GLSL,FLAT_UNIFORMS,bindFlat,type SectionProjection} from './sectionProjection';
import {sectionShader} from './sectionClip';

class FlatMaterial extends MaterialPluginBase {
  constructor(material:StandardMaterial,private projection:SectionProjection,private scene:Scene){super(material,'live flat section',200,{},true,false);this.registerForExtraEvents=true;this._enable(true);}
  getUniforms(){return {externalUniforms:FLAT_UNIFORMS};}
  getSamplers(names:string[]){names.push('flatFoundation');}
  hardBindForSubMesh(_buffer:UniformBuffer,_scene:Scene,_engine:unknown,subMesh:SubMesh){const effect=subMesh.effect;if(effect)bindFlat(effect,this.projection,this.scene);}
  getCustomCode(type:string):Record<string,string>{return type==='vertex'?{CUSTOM_VERTEX_DEFINITIONS:FLAT_VERTEX_GLSL+'\nvarying vec3 flatSource;',CUSTOM_VERTEX_UPDATE_WORLDPOS:'flatSource=worldPos.xyz;',CUSTOM_VERTEX_MAIN_END:'if(flatAmount>0.0)gl_Position=flatViewProjection*vec4(flatWorldPosition(flatSource),1.0);'}:{CUSTOM_FRAGMENT_DEFINITIONS:FLAT_GLSL+'\nvarying vec3 flatSource;',CUSTOM_FRAGMENT_MAIN_BEGIN:'if(!flatInside(flatSource))discard;'};}
}
/** Install on root descendants only: orbital objects keep their own coordinates. */
export class SectionMaterials {
  private attached=new WeakSet<object>();
  constructor(private scene:Scene,private root:TransformNode,private projection:SectionProjection){}
  update(){
    for(const mesh of this.scene.meshes){if(!mesh.isDescendantOf(this.root))continue;mesh.alwaysSelectAsActiveMesh=true;
      const material=mesh.material;if(material instanceof StandardMaterial&&!this.attached.has(material)){new FlatMaterial(material,this.projection,this.scene);this.attached.add(material);}
      else if(mesh instanceof LinesMesh&&material instanceof ShaderMaterial&&!this.attached.has(mesh)){
        const vertexColor=mesh.useVertexColor;
        const next=sectionShader(this.scene,'flat '+mesh.name,{vertexSource:`precision highp float;attribute vec3 position;${vertexColor?'attribute vec4 color;varying vec4 tint;':''}uniform mat4 worldViewProjection;void main(){${vertexColor?'tint=color;':''}gl_Position=worldViewProjection*vec4(position,1.0);}`,fragmentSource:`precision highp float;${vertexColor?'varying vec4 tint;':'uniform vec4 color;'}void main(){gl_FragColor=${vertexColor?'tint':'color'};}`},{attributes:vertexColor?['position','color']:['position'],uniforms:['worldViewProjection','color'],needAlphaBlending:true});
        mesh.material=next;material.dispose();this.attached.add(mesh);
      }
    }
    for(const system of this.scene.particleSystems){if(!(system instanceof ParticleSystem)||this.attached.has(system))continue;const emitter=system.emitter as TransformNode|null;if(!emitter||typeof emitter.isDescendantOf!=='function'||!emitter.isDescendantOf(this.root))continue;
      const name='flatParticles';
      ShaderStore.ShadersStore[name+'VertexShader']=particlesVertexShader.shader.replace('#define CUSTOM_VERTEX_DEFINITIONS',FLAT_VERTEX_GLSL+'\nvarying vec3 flatSource;').replace('#define CUSTOM_VERTEX_MAIN_END','flatSource=vPositionW;if(flatAmount>0.0)gl_Position=projection*view*vec4(flatWorldPosition(vPositionW),1.0);');
      ShaderStore.ShadersStore[name+'PixelShader']=particlesPixelShader.shader.replace('#define CUSTOM_FRAGMENT_DEFINITIONS',FLAT_GLSL+'\nvarying vec3 flatSource;').replace('#define CUSTOM_FRAGMENT_MAIN_BEGIN','if(!flatInside(flatSource))discard;');
      const defines:string[]=[];system.fillDefines(defines,system.blendMode);
      const uniforms=[...FLAT_UNIFORMS],attributes:string[]=[],samplers=['flatFoundation'];system.fillUniformsAttributesAndSamplerNames(uniforms,attributes,samplers);
      const effect=this.scene.getEngine().createEffect({vertex:name,fragment:name},attributes,uniforms,samplers,defines.join('\n'));
      system.setCustomEffect(effect);system.onBeforeDrawParticlesObservable.add(()=>bindFlat(effect,this.projection,this.scene));this.attached.add(system);
    }
  }
}
