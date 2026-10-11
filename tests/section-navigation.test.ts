import {describe,it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import {Viewport} from '@babylonjs/core/Maths/math.viewport';
import {SectionCamera} from '../src/render/sectionCamera';
import {RADIUS} from '../src/sim/sphere';

function fixture(width:number,height:number){
  const engine=new NullEngine({renderWidth:width,renderHeight:height,textureSize:512,deterministicLockstep:false,lockstepMaxSteps:4});
  const scene=new Scene(engine),camera=new ArcRotateCamera('camera',-1,1.2,18,Vector3.Zero(),scene),root=new TransformNode('root',scene);
  camera.getViewMatrix(true);
  const section=new SectionCamera(camera,root,true);
  section.setFlatRange(.45);section.toggle(true,Vector3.Up(),RADIUS,{u:Vector3.Right(),v:Vector3.Up(),normal:Vector3.Forward()});section.update(1);
  const project=(point:Vector3)=>Vector3.Project(point,Matrix.Identity(),camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true)),new Viewport(0,0,width,height));
  return {section,project,dispose:()=>{scene.dispose();engine.dispose();}};
}

describe('section navigation in screen coordinates',()=>{
  for(const [width,height] of [[1280,800],[375,812]]){
    it(`moves the scene by the dragged CSS pixels at ${width}px and different zooms`,()=>{
      const f=fixture(width,height);
      try{for(const zoom of [.5,1.8]){
        f.section.zoom(zoom);f.section.update(1);
        const point=new Vector3(.3,RADIUS+.2,0),before=f.project(point);
        f.section.movePixels(78,-31,height);f.section.update(1);
        const after=f.project(point);
        expect(after.x-before.x).toBeCloseTo(78,3);expect(after.y-before.y).toBeCloseTo(-31,3);
      }}finally{f.dispose();}
    });
    it(`keeps the cursor's material point fixed during wheel zoom at ${width}px`,()=>{
      const f=fixture(width,height);
      try{const point=new Vector3(.3,RADIUS+.2,0),before=f.project(point);
        for(const factor of [.7,1.4,.00001,10000]){
          f.section.zoomAt(factor,before.x,before.y,width,height);f.section.update(1);
          const after=f.project(point);
          expect(after.x).toBeCloseTo(before.x,2);expect(after.y).toBeCloseTo(before.y,2);
        }
      }finally{f.dispose();}
    });
  }
});
