import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {SectionMaterials} from '../src/render/sectionMaterials';
import {ClimateLayers} from '../src/render/climateLayers';
import {SectionProjection} from '../src/render/sectionProjection';
import {setSectionProjection} from '../src/render/sectionClip';
import {WeatherClimate} from '../src/sim/weatherClimate';
import {createSphere} from '../src/sim/sphere';
import {seedPlanet} from '../src/sim/model';

it('retains flat-section projection and clipping when weak-flow arrow meshes are rebuilt',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),grid=createSphere(1),root=new TransformNode('root',scene);
 try{
  const projection=new SectionProjection(scene);setSectionProjection(scene,projection);
  const layers=new ClimateLayers(scene,root,grid),state=seedPlanet(grid,'sand',22),before=state.slice(),climate=new WeatherClimate(grid);
  const positions=Float32Array.from(Array.from({length:grid.count},(_,i)=>Array.from({length:3},()=>Array.from(grid.directions.subarray(i*3,i*3+3),v=>v*5)).flat()).flat()),owners=Uint32Array.from({length:grid.count},(_,i)=>i);
  const update=()=>layers.update(state,{ambient:18,sunlight:1,sun:[1,0,0]},climate,positions,positions,owners);
  layers.layer='wind';climate.wind[0]=.000002;update();
  expect(layers.stats().arrows).toBe(1);
  const arrows=scene.getMeshByName('climate velocity arrows')!,material=arrows.material as ShaderMaterial;
  expect(material).toBeInstanceOf(ShaderMaterial);expect(material.hasTexture(projection.texture)).toBe(true);
  const path=material.shaderPath as {vertexSource:string;fragmentSource:string};
  expect(path.vertexSource).toContain('flatWorldPosition(sectionWorldPosition)');expect(path.fragmentSource).toContain('if(!sectionInside(sectionWorldPosition))discard');
  let disposed=false;material.onDisposeObservable.add(()=>{disposed=true;});
  new SectionMaterials(scene,root,projection).update();expect(arrows.material).toBe(material);expect(disposed).toBe(false);
  climate.wind[3]=.000002;update();expect(layers.stats().arrows).toBe(2);
  expect(scene.getMeshByName('climate velocity arrows')!.material).toBe(material);expect(disposed).toBe(false);
  layers.layer='none';update();expect(layers.stats().arrows).toBe(0);expect(state).toEqual(before);
 }finally{scene.dispose();engine.dispose();}
});
