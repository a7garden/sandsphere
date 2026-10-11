import {ShaderMaterial,type IShaderMaterialOptions} from '@babylonjs/core/Materials/shaderMaterial';
import {Plane} from '@babylonjs/core/Maths/math.plane';
import {Vector2,Vector3,Vector4,Matrix} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import {FLAT_GLSL,FLAT_VERTEX_GLSL,FLAT_UNIFORMS,bindFlat,type SectionProjection} from './sectionProjection';
import {ParticleSystem} from '@babylonjs/core/Particles/particleSystem';

interface ClipState {projection?:SectionProjection;normal:Vector3;width:number;front:Plane;back:Plane;}
const states=new WeakMap<Scene,ClipState>(),custom=new WeakSet<ShaderMaterial>();
export function isSectionShader(material:ShaderMaterial){return custom.has(material);}
function state(scene:Scene){let s=states.get(scene);if(!s){s={normal:Vector3.Forward(),width:1e6,front:new Plane(0,0,1,-1e6),back:new Plane(0,0,-1,-1e6)};states.set(scene,s);}return s;}
export const SECTION_GLSL=`
uniform vec4 sectionPlane;uniform float sectionHalfWidth;
uniform mat4 sectionInverseViewProjection;uniform vec2 sectionViewport;uniform float sectionNearDepth;
bool sectionInside(vec3 p){return abs(dot(sectionPlane,vec4(p,1.0)))<=sectionHalfWidth+.0002&&flatInside(p);}
vec2 sectionInterval(vec3 origin,vec3 direction,vec2 interval){float q=dot(sectionPlane.xyz,direction),p=dot(sectionPlane,vec4(origin,1.0));if(abs(q)<.000001)return abs(p)<=sectionHalfWidth?interval:vec2(1.0,-1.0);float a=(-sectionHalfWidth-p)/q,b=(sectionHalfWidth-p)/q;return vec2(max(interval.x,min(a,b)),min(interval.y,max(a,b)));}
vec3 sectionRayOrigin(){vec4 p=sectionInverseViewProjection*vec4(gl_FragCoord.xy/sectionViewport*2.0-1.0,sectionNearDepth,1.0);vec3 q=p.xyz/p.w;if(flatAmount>.999){vec3 local=(flatInverse*vec4(q,1.0)).xyz;return (flatWorld*vec4(flatPhysical(local),1.0)).xyz;}return q;}
vec3 sectionRayDirection(){vec4 p=sectionInverseViewProjection*vec4(gl_FragCoord.xy/sectionViewport*2.0-1.0,1.0,1.0);if(flatAmount>.999)return normalize((flatWorld*vec4(flatNormal,0.0)).xyz);return normalize(p.xyz/p.w-sectionRayOrigin());}
`;
/** Custom and instanced shader paths share a world-space slab. Volume shaders
 * integrate samples inside it instead of discarding the proxy's front face. */
export function sectionShader(scene:Scene,name:string,sources:{vertexSource:string;fragmentSource:string},options:Partial<IShaderMaterialOptions>,worldPosition='(world*vec4(position,1.0)).xyz',surfaceClip=true){
  let vertex=sources.vertexSource;
  const declaration=`varying vec3 sectionWorldPosition;${/uniform mat4 world\s*;/.test(vertex)?'':'uniform mat4 world;'}`;
  vertex=vertex.replace('precision highp float;','precision highp float;'+declaration+FLAT_VERTEX_GLSL);
  const last=vertex.lastIndexOf('}');vertex=vertex.slice(0,last)+`sectionWorldPosition=${worldPosition};if(flatAmount>0.0)gl_Position=flatViewProjection*vec4(flatWorldPosition(sectionWorldPosition),1.0);`+vertex.slice(last);
  let fragment=sources.fragmentSource.replace('precision highp float;','precision highp float;varying vec3 sectionWorldPosition;'+FLAT_GLSL+SECTION_GLSL);
  if(surfaceClip)fragment=fragment.replace(/void main\(\)\s*\{/,'void main(){if(!sectionInside(sectionWorldPosition))discard;');
  const uniforms=[...(options.uniforms??[]),...FLAT_UNIFORMS,'world','sectionPlane','sectionHalfWidth','sectionInverseViewProjection','sectionViewport','sectionNearDepth'];
  const material=new ShaderMaterial(name,scene,{vertexSource:vertex,fragmentSource:fragment},{...options,uniforms:[...new Set(uniforms)],samplers:[...(options.samplers??[]),'flatFoundation']});custom.add(material);
  // Register the vertex/fragment texture before readiness checks. Binding it only
  // through the effect lets WebGPU draw while its GPU resource is still pending.
  const projection=state(scene).projection;if(projection)bindFlat(material,projection,scene);
  material.onBindObservable.add(()=>{
    const s=state(scene),engine=scene.getEngine(),effect=material.getEffect();if(!effect)return;if(s.projection)bindFlat(effect,s.projection,scene);else effect.setFloat('flatAmount',0);effect.setVector4('sectionPlane',new Vector4(s.normal.x,s.normal.y,s.normal.z,0));effect.setFloat('sectionHalfWidth',s.width);
    effect.setMatrix('sectionInverseViewProjection',scene.getTransformMatrix().clone().invert());effect.setVector2('sectionViewport',new Vector2(engine.getRenderWidth(),engine.getRenderHeight()));effect.setFloat('sectionNearDepth',engine.isNDCHalfZRange?0:-1);
  });
  return material;
}
export function setSectionProjection(scene:Scene,projection:SectionProjection){state(scene).projection=projection;}
export function updateSectionClip(scene:Scene,root:TransformNode,normal:Vector3,width:number){
  const s=state(scene),n=Vector3.TransformNormal(normal,root.computeWorldMatrix(true)).normalize();s.normal.copyFrom(n);s.width=width;
  s.front.normal.copyFrom(n);s.front.d=-width;s.back.normal.copyFrom(n.scale(-1));s.back.d=-width;
  for(const mesh of scene.meshes){if(!mesh.isDescendantOf(root))continue;const material=mesh.material;if(material&&(!(material instanceof ShaderMaterial)||!custom.has(material))){material.clipPlane=s.front;material.clipPlane2=s.back;}}
  for(const system of scene.particleSystems){const emitter=system.emitter as AbstractMesh|null;if(system instanceof ParticleSystem&&emitter&&typeof emitter.isDescendantOf==='function'&&emitter.isDescendantOf(root)){system.clipPlane=s.front;system.clipPlane2=s.back;}}
}
export function sectionClipStats(scene:Scene){const s=state(scene);return {halfWidth:s.width,normal:s.normal.asArray(),customShaders:scene.materials.filter(m=>m instanceof ShaderMaterial&&custom.has(m)).length};}

export function blendedProjection(perspective:Matrix,orthographic:Matrix,mix:number){
  return Matrix.FromArray(perspective.asArray().map((v,i)=>v+(orthographic.asArray()[i]-v)*mix));
}
