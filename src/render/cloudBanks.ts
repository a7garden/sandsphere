import {cloudComposition} from './cloudComposition';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {Matrix,Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {createSphere,type SphereGrid} from '../sim/sphere';
import {F,STRIDE} from '../sim/model';
import {softHull,type Lobe} from './softHull';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {sectionShader} from './sectionClip';
import {triangleSection} from './sectionGeometry';

export type CloudStyle='cumulus'|'stratus'|'faceted';

/** Adjacent atmospheric regions form smooth, noise-free density volumes. Their area and thickness
 * follow condensed water; the simulation remains the sole owner of cloud mass. */
export class CloudBanks {
 private regions=createSphere(1);
 private bins:number[][];
 private meshes;
 private matrices:Float32Array[];
 private polygonMatrices:Float32Array[];
 private pieceCount=0;
 private familyCounts=[0,0,0,0];
 private visible=true;
 private style:CloudStyle='cumulus';
 private flatClouds=true;
 private cloudOpacity=.84;
 private polygonMeshes;
 private polygonMaterial:ShaderMaterial;
 private lastState:Float32Array|null=null;
 private lastRadii:Float32Array|null=null;
 private count=0;
 private material:ShaderMaterial;
 private cap:Mesh;private capMaterial:ShaderMaterial;private cutNormal=Vector3.Forward();private cutWidth=1e6;private section=false;
 constructor(scene:Scene,root:TransformNode,private grid:SphereGrid){
  this.bins=Array.from({length:this.regions.count},()=>[]);
  for(let i=0;i<grid.count;i++){
   let best=0,dot=-2;
   for(let j=0;j<this.regions.count;j++){let d=0;for(let k=0;k<3;k++)d+=grid.directions[i*3+k]*this.regions.directions[j*3+k];if(d>dot){dot=d;best=j;}}
   this.bins[best].push(i);
  }
  this.matrices=Array.from({length:6},()=>new Float32Array(this.regions.count*16));
  this.polygonMatrices=Array.from({length:6},()=>new Float32Array(this.regions.count*4*16));
  const material=this.material=sectionShader(scene,'cloud density light',{vertexSource:`precision highp float;
 attribute vec3 position;uniform mat4 world;uniform mat4 viewProjection;uniform vec3 eye;uniform vec3 sunlight;
#ifdef INSTANCES
 attribute vec4 world0;attribute vec4 world1;attribute vec4 world2;attribute vec4 world3;
#endif
 varying vec3 localPosition;varying vec3 localEye;varying vec3 localSun;varying float dayLight;
 varying vec3 inverseX;varying vec3 inverseY;varying vec3 inverseZ;varying vec3 instanceCenter;
 void main(){
 mat4 finalWorld=world;
#ifdef INSTANCES
 finalWorld=world*mat4(world0,world1,world2,world3);
#endif
 vec3 offset=eye-finalWorld[3].xyz;
 vec3 x=finalWorld[0].xyz,y=finalWorld[1].xyz,z=finalWorld[2].xyz;
 inverseX=x/dot(x,x);inverseY=y/dot(y,y);inverseZ=z/dot(z,z);instanceCenter=finalWorld[3].xyz;
 localEye=vec3(dot(offset,x)/dot(x,x),dot(offset,y)/dot(y,y),dot(offset,z)/dot(z,z));
 localSun=normalize(vec3(dot(sunlight,x)/dot(x,x),dot(sunlight,y)/dot(y,y),dot(sunlight,z)/dot(z,z)));
 dayLight=max(0.0,dot(normalize(finalWorld[3].xyz-world[3].xyz),sunlight));
 localPosition=position;gl_Position=viewProjection*finalWorld*vec4(position,1.0);
 }`,fragmentSource:`precision highp float;
 varying vec3 localPosition;varying vec3 localEye;varying vec3 localSun;varying float dayLight;uniform float shapeSeed;uniform float cloudProfile;
 varying vec3 inverseX;varying vec3 inverseY;varying vec3 inverseZ;varying vec3 instanceCenter;
 float puff(vec3 p,vec3 center,vec3 scale){vec3 q=(p-center)/scale;return exp(-dot(q,q)*2.4);}
 float density(vec3 p){
 float s=shapeSeed,a=sin(s*1.7),b=cos(s*2.3);
 float d;
 if(cloudProfile>.5){
  d=puff(p,vec3(-.32,-.02,-.08),vec3(.48,.20,.37));
  d+=puff(p,vec3(.25,.03,.06+b*.10),vec3(.52,.22,.40));
  d+=puff(p,vec3(.05,.06,-.18),vec3(.38,.19,.31));
 }else{
  d=puff(p,vec3(-.34,.01,-.10+a*.10),vec3(.35,.26,.32));
  d+=puff(p,vec3(-.05,.16+a*.045,-.14),vec3(.38,.37+a*.055,.34));
  d+=puff(p,vec3(.32,-.01,.02),vec3(.34,.25+b*.035,.33));
  d+=puff(p,vec3(.04+b*.08,-.01,.25),vec3(.37,.24,.32));
 }
 return smoothstep(.18,.44,d)*max(0.0,d-.18);
 }
 void main(){
 bool outside=any(greaterThan(abs(localEye),vec3(1.2,.8,.9)));
 if((outside&&!gl_FrontFacing)||(!outside&&gl_FrontFacing))discard;
 vec3 worldOrigin=sectionRayOrigin()-instanceCenter,worldRay=sectionRayDirection();
 vec3 origin=vec3(dot(worldOrigin,inverseX),dot(worldOrigin,inverseY),dot(worldOrigin,inverseZ));
 vec3 ray=normalize(vec3(dot(worldRay,inverseX),dot(worldRay,inverseY),dot(worldRay,inverseZ))),inverseRay=1.0/ray;
 vec3 a=(-vec3(1.2,.8,.9)-origin)*inverseRay,b=(vec3(1.2,.8,.9)-origin)*inverseRay;
 vec3 nearT=min(a,b),farT=max(a,b);float start=max(0.0,max(nearT.x,max(nearT.y,nearT.z))),end=min(farT.x,min(farT.y,farT.z));
 vec3 physicalRay=inverseX/dot(inverseX,inverseX)*ray.x+inverseY/dot(inverseY,inverseY)*ray.y+inverseZ/dot(inverseZ,inverseZ)*ray.z;
 vec2 slab=sectionInterval(sectionRayOrigin(),physicalRay,vec2(start,end));start=slab.x;end=slab.y;
 if(end<=start)discard;
 float stepSize=(end-start)/24.0,trans=1.0;vec3 color=vec3(0.0);
 for(int i=0;i<24;i++){
 vec3 p=origin+ray*(start+(float(i)+.5)*stepSize);
 vec3 worldPoint=instanceCenter+inverseX/dot(inverseX,inverseX)*p.x+inverseY/dot(inverseY,inverseY)*p.y+inverseZ/dot(inverseZ,inverseZ)*p.z;
 float d=sectionInside(worldPoint)?density(p):0.0;
 float light=exp(-(density(p+localSun*.12)+density(p+localSun*.28)*.6)*2.2);
 float underside=smoothstep(-.16,.28,p.y);light=mix(light*.62,light,underside);
 vec3 shade=mix(vec3(.48,.59,.69),vec3(.95,.95,.92),light);shade*=vec3(.23,.28,.36)+vec3(.77,.72,.64)*smoothstep(0.0,.3,dayLight);
 float opacity=1.0-exp(-d*stepSize*18.0);color+=trans*opacity*shade;trans*=1.0-opacity;
 }
 float alpha=1.0-trans;if(alpha<.015)discard;gl_FragColor=vec4(color/max(.001,alpha),alpha);
 }`},{attributes:['position'],uniforms:['world','viewProjection','eye','sunlight','shapeSeed','cloudProfile'],needAlphaBlending:true},'(finalWorld*vec4(position,1.0)).xyz',false);
  material.setFloat('cloudProfile',0);material.disableDepthWrite=true;material.backFaceCulling=false;material.setVector3('sunlight',new Vector3(.7,.45,-.55).normalize());
  material.onBindObservable.add(mesh=>{if(scene.activeCamera)material.setVector3('eye',scene.activeCamera.globalPosition);material.setFloat('shapeSeed',mesh?.metadata?.cloudVariant??0);});
  this.meshes=this.matrices.map((buffer,i)=>{
   const mesh=MeshBuilder.CreateBox('cloud bank '+i,{width:2.4,height:1.6,depth:1.8},scene);mesh.metadata={cloudVariant:i};mesh.material=material;mesh.parent=root;mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;
   mesh.renderingGroupId=2;mesh.thinInstanceSetBuffer('matrix',buffer,16,false);mesh.thinInstanceCount=0;mesh.setEnabled(false);return mesh;
  });
  const polygonMaterial=this.polygonMaterial=sectionShader(scene,'faceted cloud light',{vertexSource:`precision highp float;
 attribute vec3 position;attribute vec3 normal;uniform mat4 world;uniform mat4 viewProjection;
#ifdef INSTANCES
 attribute vec4 world0;attribute vec4 world1;attribute vec4 world2;attribute vec4 world3;
#endif
 varying vec3 worldNormal;varying vec3 upDirection;
 void main(){mat4 finalWorld=world;
#ifdef INSTANCES
 finalWorld=world*mat4(world0,world1,world2,world3);
#endif
 vec3 x=finalWorld[0].xyz,y=finalWorld[1].xyz,z=finalWorld[2].xyz;
 worldNormal=normalize(x*normal.x/dot(x,x)+y*normal.y/dot(y,y)+z*normal.z/dot(z,z));
 upDirection=normalize(finalWorld[3].xyz-world[3].xyz);gl_Position=viewProjection*finalWorld*vec4(position,1.0);
 }`,fragmentSource:`precision highp float;varying vec3 worldNormal;varying vec3 upDirection;uniform vec3 sunlight;uniform float cloudOpacity;
 void main(){float day=smoothstep(0.0,.3,dot(normalize(upDirection),sunlight));
 float facing=max(0.0,dot(normalize(worldNormal),sunlight));
 vec3 color=mix(vec3(.49,.60,.70),vec3(.95,.96,.93),.15+smoothstep(0.0,.9,facing)*.8);
 color*=vec3(.23,.28,.36)+vec3(.77,.72,.64)*day;gl_FragColor=vec4(color,cloudOpacity);
 }`},{attributes:['position','normal'],uniforms:['world','viewProjection','sunlight','cloudOpacity'],needAlphaBlending:true},'(finalWorld*vec4(position,1.0)).xyz');
  polygonMaterial.needAlphaBlending=()=>this.cloudOpacity<1;polygonMaterial.disableDepthWrite=this.cloudOpacity<1;polygonMaterial.backFaceCulling=true;polygonMaterial.setFloat('cloudOpacity',this.cloudOpacity);
  polygonMaterial.setVector3('sunlight',new Vector3(.7,.45,-.55).normalize());
  const silhouettes:Lobe[][]=[
   [[0,-.03,0,.48,.18,.34],[-.33,.08,-.12,.33,.26,.30],[.29,.10,.10,.36,.28,.28]],
   [[0,.01,0,.48,.29,.42],[-.18,.14,.10,.31,.30,.26]],
   [[0,0,0,.55,.18,.24],[-.42,.04,-.08,.30,.23,.23],[.40,.05,.15,.31,.20,.25]],
   [[0,-.02,0,.42,.18,.35],[-.30,.09,-.15,.31,.26,.26],[.30,.11,-.10,.33,.28,.24],[.06,.045,.30,.30,.23,.29]],
   [[0,0,0,.66,.16,.32],[-.30,.08,.10,.40,.18,.27]],
   [[0,0,0,.45,.24,.32],[-.30,.16,-.02,.30,.30,.27],[.36,.02,.14,.29,.17,.24]],
  ];
  this.polygonMeshes=this.polygonMatrices.map((buffer,i)=>{
   const lobes=silhouettes[i];
   const mesh=softHull('cloud bank facets '+i,lobes,scene,1,2);mesh.material=polygonMaterial;mesh.parent=root;mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;mesh.renderingGroupId=2;
   mesh.thinInstanceSetBuffer('matrix',buffer,16,false);mesh.thinInstanceCount=0;mesh.setEnabled(false);return mesh;
  });
  this.cap=new Mesh('cloud cut faces',scene);this.cap.parent=root;this.cap.isPickable=false;this.cap.renderingGroupId=2;this.cap.alwaysSelectAsActiveMesh=true;
  this.capMaterial=sectionShader(scene,'cloud cut light',{vertexSource:`precision highp float;attribute vec3 position;attribute vec3 normal;uniform mat4 world;uniform mat4 worldViewProjection;varying vec3 up;varying vec3 face;void main(){up=normalize(mat3(world)*position);face=normalize(mat3(world)*normal);gl_Position=worldViewProjection*vec4(position,1.0);}`,
    fragmentSource:`precision highp float;varying vec3 up;varying vec3 face;uniform vec3 sunlight;uniform float cloudOpacity;void main(){float day=smoothstep(0.0,.3,dot(up,sunlight));float lit=max(0.0,dot(face,sunlight));vec3 color=mix(vec3(.49,.60,.70),vec3(.95,.96,.93),.55+lit*.3);color*=vec3(.23,.28,.36)+vec3(.77,.72,.64)*day;gl_FragColor=vec4(color,cloudOpacity);}`},{attributes:['position','normal'],uniforms:['world','worldViewProjection','sunlight','cloudOpacity'],needAlphaBlending:true});
  this.capMaterial.setFloat('cloudOpacity',this.cloudOpacity);this.capMaterial.setVector3('sunlight',new Vector3(.7,.45,-.55).normalize());this.capMaterial.backFaceCulling=false;this.cap.material=this.capMaterial;this.cap.setEnabled(false);
 }
 update(state:Float32Array,radii:Float32Array){
  this.lastState=state;this.lastRadii=radii;
  const stock=this.bins.map(cells=>cells.reduce((m,i)=>m+state[i*STRIDE+F.cloud]+state[i*STRIDE+F.cloudIce],0)/Math.max(1,cells.length));
  const used=new Set<number>(),counts=new Array(6).fill(0),pieceCounts=new Array(6).fill(0);
  this.familyCounts.fill(0);
  // Fixed traversal and bounded neighborhoods keep chunks deterministic, including
  // uniform overcast. No per-frame random placement or one object per sim cell.
  for(let j=0;j<this.bins.length;j++){
   if(used.has(j)||stock[j]<.004)continue;
   const group=[j];used.add(j);
   for(let k=0;k<6&&group.length<3;k++){
    const neighbor=this.regions.neighbors[j*6+k];
    if(neighbor<this.bins.length&&!used.has(neighbor)&&stock[neighbor]>.018&&stock[j]>.018){group.push(neighbor);used.add(neighbor);}
   }
   const center=Vector3.Zero();let mass=0,ground=0;
   for(const region of group){const weight=stock[region];mass+=weight;const cells=this.bins[region];for(const i of cells){const stock=state[i*STRIDE+F.cloud]+state[i*STRIDE+F.cloudIce];center.addInPlace(Vector3.FromArray(this.grid.directions.slice(i*3,i*3+3)).scale(stock/Math.max(1,cells.length)));ground=Math.max(ground,radii[i]);}}
   center.normalize();const concentration=mass/group.length,size=Math.min(.92,Math.sqrt(concentration)*2.6);
   const yaw=j*2.399,rotation=Quaternion.FromUnitVectorsToRef(Vector3.Up(),center,new Quaternion()).multiply(Quaternion.RotationAxis(Vector3.Up(),yaw));
   const variant=j%6,width=size*(1.05+Math.sqrt(group.length-1)*.12)*(this.style==='stratus'?1.35:this.style==='faceted'&&this.flatClouds?1.45:1),height=size*(1.0+(j%3)*.09)*(this.style==='stratus'?.75:this.style==='faceted'&&this.flatClouds?.52:1);
   const depth=size*(this.style==='faceted'&&this.flatClouds?1.22:1),radius=ground+.22+height*.24;
   Matrix.ComposeToRef(new Vector3(width,height,depth),rotation,center.scale(radius),Matrix.Identity()).copyToArray(this.matrices[variant],counts[variant]++*16);
   const pieces=cloudComposition(j,size),frame=Matrix.Compose(Vector3.One(),rotation,center.scale(radius));
   this.familyCounts[pieces.length-1]++;
   for(const piece of pieces){
    const direction=Vector3.TransformCoordinates(new Vector3(piece.x*width,0,piece.z*depth),frame).normalize();
    const orientation=Quaternion.FromUnitVectorsToRef(Vector3.Up(),direction,new Quaternion()).multiply(Quaternion.RotationAxis(Vector3.Up(),yaw+piece.yaw));
    Matrix.ComposeToRef(new Vector3(width*piece.width,height*piece.height,depth*piece.depth),orientation,direction.scale(radius+piece.y*height),Matrix.Identity()).copyToArray(this.polygonMatrices[piece.variant],pieceCounts[piece.variant]++*16);
   }
  }
  this.count=counts.reduce((a,b)=>a+b,0);
  this.pieceCount=pieceCounts.reduce((a,b)=>a+b,0);
  this.meshes.forEach((mesh,i)=>{mesh.thinInstanceCount=counts[i];if(counts[i])mesh.thinInstanceBufferUpdated('matrix');});
  this.polygonMeshes.forEach((mesh,i)=>{mesh.thinInstanceCount=pieceCounts[i];if(pieceCounts[i])mesh.thinInstanceBufferUpdated('matrix');});this.rebuildCap();this.applyVisibility();
 }
 setSun(sun:readonly number[]){for(const material of [this.material,this.polygonMaterial,this.capMaterial])material.setVector3('sunlight',Vector3.FromArray(sun));}
 private applyVisibility(){this.meshes.forEach(mesh=>mesh.setEnabled(this.visible&&this.style!=='faceted'&&mesh.thinInstanceCount>0));this.polygonMeshes.forEach(mesh=>mesh.setEnabled(this.visible&&this.style==='faceted'&&mesh.thinInstanceCount>0));this.cap?.setEnabled(this.visible&&this.section&&this.style==='faceted'&&this.capCount>0);}
 setStyle(style:CloudStyle){this.style=style;this.material.setFloat('cloudProfile',style==='stratus'?1:0);if(this.lastState&&this.lastRadii)this.update(this.lastState,this.lastRadii);else this.applyVisibility();}
 setAppearance(flat:boolean,opacity:number){this.flatClouds=flat;this.cloudOpacity=Math.max(.45,Math.min(1,opacity));this.polygonMaterial.setFloat('cloudOpacity',this.cloudOpacity);this.capMaterial.setFloat('cloudOpacity',this.cloudOpacity);this.polygonMaterial.disableDepthWrite=this.cloudOpacity<1;if(this.lastState&&this.lastRadii)this.update(this.lastState,this.lastRadii);}
 setSection(normal:Vector3,width:number,enabled:boolean){if(this.section===enabled&&this.cutWidth===width&&this.cutNormal.equalsWithEpsilon(normal,1e-7))return;this.cutNormal.copyFrom(normal);this.cutWidth=width;this.section=enabled;this.rebuildCap();this.applyVisibility();}
 private capCount=0;
 private rebuildCap(){
  if(!this.cap||!this.section||this.style!=='faceted')return;
  const positions:number[]=[],normals:number[]=[],indices:number[]=[],normal=this.cutNormal,offset=-this.cutWidth+.0001;
  const u=Vector3.Cross(Math.abs(normal.y)>.9?Vector3.Right():Vector3.Up(),normal).normalize(),v=Vector3.Cross(normal,u);
  for(let family=0;family<this.polygonMeshes.length;family++){
   const mesh=this.polygonMeshes[family],source=mesh.getVerticesData(VertexBuffer.PositionKind)!,faces=mesh.getIndices()!;
   for(let instance=0;instance<mesh.thinInstanceCount;instance++){
    const frame=Matrix.FromArray(this.polygonMatrices[family],instance*16),center=Vector3.TransformCoordinates(Vector3.Zero(),frame);
    if(Math.abs(Vector3.Dot(center,normal)-offset)>2)continue;
    const hits:Vector3[]=[];
    for(let f=0;f<faces.length;f+=3){const triangle=[0,1,2].map(k=>Vector3.TransformCoordinates(Vector3.FromArray(source,faces[f+k]*3),frame));for(const p of triangleSection(triangle,normal,offset))if(!hits.some(q=>Vector3.DistanceSquared(p,q)<1e-8))hits.push(p);}
    if(hits.length<3)continue;
    const mean=hits.reduce((a,p)=>a.addInPlace(p),Vector3.Zero()).scale(1/hits.length);hits.sort((a,b)=>Math.atan2(Vector3.Dot(a.subtract(mean),v),Vector3.Dot(a.subtract(mean),u))-Math.atan2(Vector3.Dot(b.subtract(mean),v),Vector3.Dot(b.subtract(mean),u)));
    for(let k=0;k<hits.length;k++){const start=positions.length/3;for(const p of [mean,hits[k],hits[(k+1)%hits.length]]){positions.push(...p.asArray());normals.push(...normal.scale(-1).asArray());}indices.push(start,start+1,start+2);}
   }
  }
  if(!indices.length){this.cap.setEnabled(false);this.capCount=0;return;}this.capCount=indices.length;const data=new VertexData();data.positions=positions;data.normals=normals;data.indices=indices;data.applyToMesh(this.cap,true);
 }
 setVisible(visible:boolean){this.visible=visible;this.applyVisibility();}
 stats(){return {cloudBanks:this.count,cloudStyle:this.style,cloudPieces:this.style==='faceted'?this.pieceCount:this.count,cloudFamilies:[...this.familyCounts],flatClouds:this.flatClouds,cloudOpacity:this.cloudOpacity};}
}
