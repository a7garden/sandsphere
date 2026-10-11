import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import {Viewport} from '@babylonjs/core/Maths/math.viewport';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {PlanetView} from '../src/render/planet';
import type {SectionProjection} from '../src/render/sectionProjection';
import {RADIUS} from '../src/sim/sphere';
import {totalMass,totalEnthalpy} from '../src/sim/model';

const settle=()=>new Promise<void>(resolve=>{const start=performance.now();const frame=()=>performance.now()-start>650?resolve():requestAnimationFrame(frame);requestAnimationFrame(frame);});
/** Invoke with physics paused. Uses the same WebGPU scene and public picking path. */
export async function verifyFlatSection(view:PlanetView,state:()=>Float32Array){
  const checks:Record<string,boolean|number>={},before=state(),mass=totalMass(before),enthalpy=totalEnthalpy(before),scene=view.scene,canvas=view.canvas;
  view.setSection(false);await settle();const camera=view.camera.position.clone();
  const internals=view as unknown as {sectionProjection:SectionProjection;root:TransformNode};
  view.setSection(true,0);view.setSectionRange(12);await settle();
  const checkPicking=()=>{
    const mesh=view.scene.getMeshByName('live material cross section')!,positions=mesh.getVerticesData('position')!,data=mesh.getVerticesData('sectionData')!,projection=internals.sectionProjection;let tested=0,matched=0;
    for(let t=0;t<data.length/12;t++){const owner=data[t*12+1],kind=data[t*12+2];if(owner<0||kind<.5)continue;
      const vertices=[0,1,2].map(k=>Vector3.FromArray(positions,t*9+k*3));if(vertices.some(p=>Math.abs(projection.angle(p))>projection.halfRange-.02))continue;
      // A centroid in the displayed triangle stays away from shared boundaries.
      const flat=vertices.map(p=>projection.forward(p)).reduce((a,b)=>a.add(b),Vector3.Zero()).scale(1/3);if(Vector3.Dot(flat,projection.v)<RADIUS+.015)continue;
      const world=Vector3.TransformCoordinates(flat,internals.root.getWorldMatrix()),pixel=Vector3.Project(world,Matrix.Identity(),view.scene.getTransformMatrix(),new Viewport(0,0,view.canvas.clientWidth,view.canvas.clientHeight));
      if(pixel.x<0||pixel.x>view.canvas.clientWidth||pixel.y<0||pixel.y>view.canvas.clientHeight)continue;
      const pixels=vertices.map(p=>Vector3.Project(Vector3.TransformCoordinates(projection.forward(p),internals.root.getWorldMatrix()),Matrix.Identity(),view.scene.getTransformMatrix(),new Viewport(0,0,view.canvas.clientWidth,view.canvas.clientHeight)));
      const area=Math.abs((pixels[1].x-pixels[0].x)*(pixels[2].y-pixels[0].y)-(pixels[1].y-pixels[0].y)*(pixels[2].x-pixels[0].x));
      // Subpixel slivers cannot provide an unambiguous pointer target.
      if(pixels.some((p,i)=>area/Math.hypot(p.x-pixels[(i+1)%3].x,p.y-pixels[(i+1)%3].y)<3))continue;
      tested++;if(view.pick(pixel.x,pixel.y)?.index===owner)matched++;
    }
    return {tested,matched};
  };
  const initial=checkPicking();checks.pickTests=initial.tested;checks.pickMatches=initial.matched;checks.picking=initial.tested>8&&initial.matched===initial.tested;
  const projection=internals.sectionProjection,screen=(p:Vector3)=>Vector3.Project(Vector3.TransformCoordinates(p,internals.root.getWorldMatrix()),Matrix.Identity(),view.scene.getTransformMatrix(),new Viewport(0,0,view.canvas.clientWidth,view.canvas.clientHeight));
  const below=screen(projection.v.scale(RADIUS-.1));checks.foundationUnpickable=view.pick(below.x,below.y)===null;
  const outside=screen(projection.u.scale(RADIUS*(projection.halfRange+.1)).add(projection.v.scale(RADIUS+.6)));checks.rangeUnpickable=view.pick(outside.x,outside.y)===null;
  const airHeight=projection.displayDepth(projection.stackDepth)+.4,air=screen(projection.v.scale(RADIUS+airHeight)),pick=view.pick(air.x,air.y);checks.airEmitter=!!pick?.inAir&&!!pick.emitter;
  if(pick?.emitter){const physical=Vector3.FromArray(pick.emitter),back=projection.forward(physical);checks.emitterError=Vector3.Distance(back,projection.v.scale(RADIUS+airHeight));checks.emitterRoundTrip=(checks.emitterError as number)<.005;}
  view.setSectionMagnification(4);await settle();const magnified=checkPicking();checks.manualMagnification=Math.abs(view.visualStats().section.heightScale-4)<.03;checks.magnifiedPicking=magnified.tested>8&&magnified.tested===magnified.matched;view.setSectionMagnification(0);await settle();
  const narrow=view.visualStats().section.halfRange;view.setSectionRange(24);await settle();checks.rangeWidens=view.visualStats().section.halfRange>narrow;view.setSectionRange(12);view.setSectionAngle(73);view.setSectionTilt(-48);await settle();
  const rotated=checkPicking();checks.rotatedTests=rotated.tested;checks.rotatedMatches=rotated.matched;checks.rotatedPicking=rotated.tested>8&&rotated.matched===rotated.tested;
  const normal=[...view.visualStats().section.normal];view.setSectionNavigation('pan');view.turn(.08,-.04);await settle();checks.panKeepsCut=view.visualStats().section.normal.every((v,i)=>v===normal[i]);
  view.setSection(false);await settle();checks.globeError=Vector3.Distance(camera,view.camera.position);checks.globeRestored=(checks.globeError as number)<1e-4;
  view.setSection(true,0);await settle();
  for(let frame=0;frame<120&&!view.scene.isReady();frame++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  checks.sameScene=view.scene===scene&&view.canvas===canvas&&view.visualStats().section.flat===1&&view.scene.isReady();
  const after=state();checks.stockUnchanged=before.every((v,i)=>v===after[i]);checks.massUnchanged=mass===totalMass(after);checks.enthalpyUnchanged=enthalpy===totalEnthalpy(after);
  return {checks,pass:Object.entries(checks).filter(([k])=>!['pickTests','pickMatches','rotatedTests','rotatedMatches','emitterError','globeError'].includes(k)).every(([,v])=>v===true),engine:view.engine.getClassName()};
}
