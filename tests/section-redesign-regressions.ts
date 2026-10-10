import type {PlanetView} from '../src/render/planet';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {totalMass,totalEnthalpy} from '../src/sim/model';

/** Real-engine regression; invoke from the paused, isolated section-lab fixture. */
export async function verifySectionNavigation(view:PlanetView,state:()=>Float32Array){
 const initial=state(),canvas=view.canvas,camera=view.camera;
 const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
 const settle=async()=>{const until=performance.now()+1100;while(performance.now()<until)await frame();};
 const cap=()=>view.scene.getMeshByName('live material cross section')!;
 const owners=()=>cap().getVerticesData('sectionData')!.filter((_,i)=>i%4===1).join(',');
 const initialOwners=owners(),normal=Vector3.FromArray(view.visualStats().section.normal);
 const localScale=view.visualStats().section.scale;
 view.turn(.5,.4);await settle();
 const rotated=view.visualStats().section,planeChanged=Vector3.Distance(normal,Vector3.FromArray(rotated.normal))>.2,
  ownersChanged=owners()!==initialOwners,twoAxes=rotated.angle!==0&&rotated.tilt!==0;
 view.setSectionNavigation('pan');const beforePan=camera.target.clone(),panNormal=Vector3.FromArray(rotated.normal);
 view.turn(.12,-.08);await settle();
 const panMovesTarget=Vector3.Distance(camera.target,beforePan)>.05,panKeepsPlane=Vector3.Distance(panNormal,Vector3.FromArray(view.visualStats().section.normal))<1e-6;
 view.frameSection('whole');await settle();const whole=view.visualStats().section,
  wholeCentered=camera.target.length()<.01,wholeLarger=whole.scale>localScale;
 view.home();await settle();const localRestored=camera.target.length()>4&&view.sectionFraming==='surface'&&view.visualStats().section.scale<whole.scale;
 let editable=0,air=0,foundation=0;
 for(let y=100;y<canvas.clientHeight-60;y+=24)for(let x=canvas.clientWidth*.3;x<canvas.clientWidth*.7;x+=24){
  const hit=view.pick(x,y);if(!hit)foundation++;else if(hit.inAir)air++;else if(hit.index>=0&&hit.index<view.grid.count)editable++;
 }
 view.setSectionNavigation('rotate');view.setSection(false);await settle();const globeReached=view.visualStats().section.amount===0;
 const globePosition=camera.position.clone(),globeTarget=camera.target.clone();
 view.setSection(true,0);await settle();view.setSectionAngle(123);view.setSectionTilt(-57);await settle();
 const ready=view.scene.isReady(),finite=Array.from(cap().getVerticesData('position')!).every(Number.isFinite);
 view.setSection(false);await settle();
 const cameraRestored=Vector3.Distance(camera.position,globePosition)<1e-5&&Vector3.Distance(camera.target,globeTarget)<1e-5;
 const final=state(),stateUnchanged=final.every((v,i)=>v===initial[i]),massUnchanged=totalMass(final)===totalMass(initial),energyUnchanged=totalEnthalpy(final)===totalEnthalpy(initial);
 view.setSection(true,0);await settle();
 const sameCanvas=view.canvas===canvas,sectionReached=view.visualStats().section.amount===1;
 return {passed:planeChanged&&ownersChanged&&twoAxes&&panMovesTarget&&panKeepsPlane&&wholeCentered&&wholeLarger&&localRestored&&editable>0&&air>0&&foundation>0&&globeReached&&cameraRestored&&stateUnchanged&&massUnchanged&&energyUnchanged&&sameCanvas&&sectionReached&&ready&&finite,
 planeChanged,ownersChanged,twoAxes,panMovesTarget,panKeepsPlane,wholeCentered,wholeLarger,localRestored,editable,air,foundation,globeReached,cameraRestored,stateUnchanged,massUnchanged,energyUnchanged,sameCanvas,sectionReached,ready,finite};
}
