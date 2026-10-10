interface SectionStats {angle:number;tilt:number;navigation:string;}
interface ProductStats {supplied:number;effects:{section:SectionStats};}

/** Synthetic pointer routing regression. Native capture is stubbed only for
 * these virtual IDs and restored immediately; this is not a hardware test. */
export function verifySectionTouch(stats:()=>ProductStats,state:()=>Float32Array){
 const canvas=document.querySelector<HTMLCanvasElement>('#planet')!,rect=canvas.getBoundingClientRect();
 const setCapture=canvas.setPointerCapture,hasCapture=canvas.hasPointerCapture;
 const virtual=new Set([9001,9002]);
 canvas.setPointerCapture=function(id:number){if(!virtual.has(id))setCapture.call(this,id);};
 canvas.hasPointerCapture=function(id:number){return virtual.has(id)?false:hasCapture.call(this,id);};
 const send=(type:string,id:number,x:number,y:number)=>canvas.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',button:0,buttons:type==='pointerup'?0:1,clientX:rect.x+x,clientY:rect.y+y,bubbles:true}));
 const initial=stats(),snapshot=state();
 try{
  send('pointerdown',9001,rect.width*.4,rect.height*.5);send('pointerdown',9002,rect.width*.6,rect.height*.5);
  send('pointermove',9001,rect.width*.4+30,rect.height*.5+10);send('pointermove',9002,rect.width*.6+30,rect.height*.5+10);
  send('pointerup',9001,rect.width*.4+30,rect.height*.5+10);send('pointerup',9002,rect.width*.6+30,rect.height*.5+10);
  const final=stats(),angleDelta=final.effects.section.angle-initial.effects.section.angle,tiltDelta=final.effects.section.tilt-initial.effects.section.tilt,
   expectedAngle=-30/220*180/Math.PI,expectedTilt=-10/220*180/Math.PI,
   noPaint=final.supplied===initial.supplied,stateUnchanged=state().every((v,i)=>v===snapshot[i]);
  return {passed:Math.abs(angleDelta-expectedAngle)<1e-6&&Math.abs(tiltDelta-expectedTilt)<1e-6&&noPaint&&stateUnchanged,angleDelta,tiltDelta,expectedAngle,expectedTilt,noPaint,stateUnchanged};
 }finally{canvas.setPointerCapture=setCapture;canvas.hasPointerCapture=hasCapture;}
}
