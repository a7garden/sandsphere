import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import type {Scene} from '@babylonjs/core/scene';
import type {SurfaceMaterial} from '../sim/model';

export function materialGrain(scene:Scene,kind:SurfaceMaterial,color:readonly number[]){
  const mesh=MeshBuilder.CreateSphere(kind+' grain',{diameter:1,segments:kind==='water'?12:8},scene);
  if(kind==='clay'||kind==='ceramic'){
    const points=mesh.getVerticesData(VertexBuffer.PositionKind)!;
    for(let i=0;i<points.length;i+=3){const bump=1+.16*Math.sin(points[i]*13+points[i+1]*8+points[i+2]*11);points[i]*=bump;points[i+1]*=bump*.76;points[i+2]*=bump;}
    const normals:number[]=[];VertexData.ComputeNormals(points,mesh.getIndices()!,normals);mesh.setVerticesData(VertexBuffer.PositionKind,points);mesh.setVerticesData(VertexBuffer.NormalKind,normals);
  }
  const mat=new StandardMaterial(kind+' grain surface',scene,true);mat.diffuseColor=Color3.FromArray(color);mat.specularColor=new Color3(.08,.09,.10);
  if(kind==='water'){mat.diffuseColor=new Color3(.32,.66,.77);mat.specularColor=new Color3(.32,.42,.46);mat.specularPower=180;mat.emissiveColor=new Color3(.015,.035,.04);}
  if(kind==='glass'||kind==='ice'){mat.specularColor=new Color3(.5,.6,.65);mat.specularPower=140;}
  if(kind==='salt'){mat.specularColor=new Color3(.35,.36,.33);mat.specularPower=80;}
  mesh.material=mat;mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;return mesh;
}
