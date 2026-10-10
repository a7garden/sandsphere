import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import type {Scene} from '@babylonjs/core/scene';
export function solarMaterial(scene:Scene){
 const material=new ShaderMaterial('solar photosphere',scene,{vertexSource:`precision highp float;
 attribute vec3 position;attribute vec3 normal;uniform mat4 worldViewProjection;uniform mat4 world;varying vec3 p;varying vec3 n;varying vec3 wp;
 void main(){p=position;n=mat3(world)*normal;wp=(world*vec4(position,1.0)).xyz;gl_Position=worldViewProjection*vec4(position,1.0);}`,
 fragmentSource:`precision highp float;varying vec3 p;varying vec3 n;varying vec3 wp;uniform vec3 eye;uniform float time;
 void main(){
 float limb=pow(max(0.0,dot(normalize(n),normalize(eye-wp))),.35);vec3 color=mix(vec3(1.0,.63,.22),vec3(1.0,.92,.66),limb);
 gl_FragColor=vec4(color,1.0);}`},{attributes:['position','normal'],uniforms:['world','worldViewProjection','time','eye']});
 material.onBindObservable.add(()=>{if(scene.activeCamera)material.setVector3('eye',scene.activeCamera.globalPosition);});
 return material;
}
