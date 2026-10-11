import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import {sectionShader} from './sectionClip';

const vertexSource=`precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 color;
attribute vec3 supplyCoord;
uniform sampler2D supplyMap;
uniform float supplyActive;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vPosition;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
varying vec4 vSupply;
varying float vSupplyEdge;
void main(){
 vSupply=vec4(0.0);vSupplyEdge=supplyCoord.z;
 if(supplyActive>.5&&supplyCoord.x>0.0)vSupply=texture2D(supplyMap,supplyCoord.xy);
 vPosition=position;vWorld=(world*vec4(position,1.0)).xyz;
 vNormal=normalize(mat3(world)*normal);vColor=color;
 gl_Position=worldViewProjection*vec4(position,1.0);
}`;

const common=`precision highp float;
uniform mat4 world;
uniform vec3 cameraPosition;
uniform vec3 sunDirection;
uniform float surfaceTime;
uniform float cloudShadow;
uniform float surfaceFaceting;
uniform float hexagonalSurface;
uniform float boundaryBlend;
uniform sampler2D densityMap;
varying vec3 vPosition;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
varying vec4 vSupply;
varying float vSupplyEdge;
uniform float supplyTime;

`;

const supplyGlow=`
vec3 supplyGlow(vec3 shade){
 float age=max(0.0,supplyTime-vSupply.a);
 float fade=1.0-smoothstep(0.0,.24,age);
 float border=(1.0-smoothstep(0.0,max(.0001,fwidth(vSupplyEdge)*1.7),vSupplyEdge))*hexagonalSurface;
 // A gentle interior tint and a crisp emissive boundary remain visible at night.
 return shade+vSupply.rgb*fade*(.16+border*.75);
}
`;

const cloudLight=`
float cloudLightAt(vec3 p){
 vec3 sunLocal=vec3(dot(world[0].xyz,sunDirection),dot(world[1].xyz,sunDirection),dot(world[2].xyz,sunDirection));
 vec3 projected=normalize(p+sunLocal*.48);
 vec4 stock=texture2D(densityMap,vec2(atan(projected.z,projected.x)/6.2831853+.5,acos(clamp(projected.y,-1.0,1.0))/3.14159265));
 return 1.0-cloudShadow*min(.34,(stock.r+stock.g)*.28);
}
`;
const terrainFragment=common+cloudLight+supplyGlow+`
varying vec4 vSurface;
float edgeHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float edgeNoise(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(edgeHash(i),edgeHash(i+vec3(1,0,0)),f.x),mix(edgeHash(i+vec3(0,1,0)),edgeHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(edgeHash(i+vec3(0,0,1)),edgeHash(i+vec3(1,0,1)),f.x),mix(edgeHash(i+vec3(0,1,1)),edgeHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
void main(){
 vec3 n=normalize(vNormal),eye=normalize(cameraPosition-vWorld);
 vec3 face=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
 if(dot(face,n)<0.0)face=-face;
 n=normalize(mix(n,face,surfaceFaceting*(1.0-hexagonalSurface)));
 float daylight=dot(n,sunDirection),lit=max(0.0,daylight);
 vec3 base=vColor.rgb;
 // The border moves, the two materials do not dissolve into one another.
 // Low-frequency variation only changes the contour; interiors stay clean.
 float bankFace=1.0-step(-.5,vSurface.r);
 float density=clamp(vSurface.b,0.0,1.0);
 float irregular=(edgeNoise(vPosition*3.2)-.5)*.18+(edgeNoise(vPosition*7.0)-.5)*.045;
 float boundary=density-.24+irregular*(1.0-surfaceFaceting);
 float width=mix(.006,.22,boundaryBlend);
 float cover=smoothstep(-width,width,boundary);
 vec3 grass=mix(vec3(.46,.57,.29),vec3(.31,.45,.23),smoothstep(.35,.90,density));
 base=mix(base,grass,cover);
 base*=1.0-vSurface.a*.08;
 // Broad slope tones expose relief without outlining the computation grid.
 vec3 radial=normalize(mat3(world)*normalize(vPosition));
 // Banks share the ground's ambient light. Their soft fill comes only from
 // sunlit surroundings; sideways normals cannot catch sunlight through the globe.
 float groundDaylight=dot(radial,sunDirection);
 float bankLit=max(lit*smoothstep(0.0,.12,groundDaylight),max(0.0,groundDaylight)*.5);
 lit=mix(lit,bankLit,bankFace);
 float slope=1.0-max(0.0,dot(n,radial));
 base=mix(base,vec3(.49,.51,.43),smoothstep(.08,.33,slope)*(1.0-cover*.70)*(1.0-bankFace));
 // Warm key and cool fill keep both banks and ridge faces readable.
 vec3 light=vec3(.24,.29,.35)+vec3(.94,.85,.68)*lit*.84*cloudLightAt(vPosition);
 float rim=pow(1.0-max(0.0,dot(n,eye)),4.0);
 vec3 halfway=normalize(eye+sunDirection);
 float polish=pow(max(0.0,dot(n,halfway)),55.0)*vColor.a*lit*.18;
 gl_FragColor=vec4(supplyGlow(base*light+vec3(.11,.17,.20)*rim*lit+polish),1.0);
}`;

// Color alpha carries interpolated water stock, not transparency. The mesh stays
// opaque; the continuous wet/dry contour is clipped inside the underlying grid.
const waterFragment=common+cloudLight+supplyGlow+`
void main(){
 vec3 n=normalize(vNormal),eye=normalize(cameraPosition-vWorld);
 vec3 face=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
 if(dot(face,n)<0.0)face=-face;
 n=normalize(mix(n,face,surfaceFaceting*(1.0-hexagonalSurface)));
 float lit=max(0.0,dot(n,sunDirection));
 float depth=max(0.0,vColor.a-.035);
 // Continuous color follows the reconstructed shore rather than cell IDs.
 vec3 coast=vec3(.29,.67,.63),shelf=vec3(.075,.42,.53),deep=vec3(.035,.24,.39);
 vec3 sea=mix(coast,shelf,smoothstep(.03,1.0,depth));
 sea=mix(sea,deep,smoothstep(.8,4.8,depth));
 float edge=1.0-smoothstep(.015,.11,depth);
 float wash=(1.0-smoothstep(.08,.50,depth))*.07;
 sea=mix(sea,vec3(.80,.85,.70),edge*.55+wash);
 // Hex water uses a cool blue palette, distinct from green cover and ochre
 // ground. A narrow wash follows only solid-facing polygon edges.
 vec3 hexSea=mix(vec3(.10,.53,.68),vec3(.035,.32,.52),smoothstep(.03,1.4,depth));
 hexSea=mix(hexSea,vec3(.025,.19,.36),smoothstep(1.4,5.0,depth));
 float bank=smoothstep(.64,.89,vColor.g)*(1.0-smoothstep(.90,.98,vColor.g));
 hexSea*=1.0-bank*.035;
 float foam=smoothstep(.90,.975,vColor.g);
 hexSea=mix(hexSea,vec3(.61,.83,.85),foam*.40);
 sea=mix(sea,hexSea,hexagonalSurface);
 vec3 ice=mix(vec3(.46,.69,.77),vec3(.87,.93,.92),vColor.r);
 vec3 base=mix(sea,ice,smoothstep(.04,.65,vColor.r));
 vec3 light=vec3(.24,.29,.35)+vec3(.94,.85,.68)*lit*.84*cloudLightAt(vPosition);
 float rim=pow(1.0-max(0.0,dot(n,eye)),4.0);
 gl_FragColor=vec4(supplyGlow(base*light+vec3(.06,.11,.14)*rim*lit),1.0);
}`;

export function surfaceMaterial(scene:Scene,kind:'terrain'|'water') {
 const material=sectionShader(scene,kind==='water'?'sunlit water':'mineral relief',
  {vertexSource:kind==='terrain'?vertexSource.replace('attribute vec4 color;','attribute vec4 color;attribute vec4 surfaceInfo;varying vec4 vSurface;').replace('vPosition=position;','vSurface=surfaceInfo;vPosition=position;'):vertexSource,fragmentSource:kind==='water'?waterFragment:terrainFragment},
  {attributes:kind==='terrain'?['position','normal','color','surfaceInfo','supplyCoord']:['position','normal','color','supplyCoord'],uniforms:['world','worldViewProjection','cameraPosition','sunDirection','surfaceTime','cloudShadow','surfaceFaceting','hexagonalSurface','boundaryBlend','supplyTime','supplyActive'],samplers:['densityMap','supplyMap']});
 material.setVector3('sunDirection',new Vector3(-.65,.72,.35).normalize());
 material.setFloat('surfaceFaceting',0);material.setFloat('hexagonalSurface',0);material.setFloat('boundaryBlend',0);
 material.setFloat('surfaceTime',0);material.setFloat('cloudShadow',1);
 material.setFloat('supplyTime',0);material.setFloat('supplyActive',0);
 material.onBindObservable.add(()=>{
  if(scene.activeCamera)material.setVector3('cameraPosition',scene.activeCamera.globalPosition);
 });
 return material;
}
