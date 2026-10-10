export function rotationStickMarkup(){return `<div class="scene-stick"><button id="rotation-stick" class="rotation-stick" aria-label="시점 회전 조이스틱" aria-describedby="rotation-stick-help" title="드래그해서 시점 회전"><span class="rotation-stick-thumb" aria-hidden="true"></span></button><span id="rotation-stick-help" class="visually-hidden">원하는 방향으로 드래그하세요. 멀리 당길수록 빠르게 회전하고 놓으면 멈춥니다. 방향키로도 조작할 수 있습니다.</span></div>`;}

const directions:Record<string,readonly [number,number]>={
 ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1],
};

/** A spring-return camera stick. Rotation uses frame time, independent of simulation speed. */
export class RotationStick {
 private pointerId:number|null=null;
 private keys=new Set<string>();
 private x=0;
 private y=0;
 private thumb:HTMLElement;

 constructor(private element:HTMLButtonElement,private turn:(x:number,y:number)=>void){
  this.thumb=element.querySelector<HTMLElement>('.rotation-stick-thumb')!;
  element.addEventListener('pointerdown',event=>{
   if(event.button!==0||this.pointerId!==null)return;
   event.preventDefault();this.reset();element.focus({preventScroll:true});
   this.pointerId=event.pointerId;element.setPointerCapture(event.pointerId);this.move(event);
  });
  element.addEventListener('pointermove',event=>{if(event.pointerId===this.pointerId)this.move(event);});
  const release=(event:PointerEvent)=>{if(event.pointerId===this.pointerId)this.reset();};
  element.addEventListener('pointerup',release);
  element.addEventListener('pointercancel',release);
  element.addEventListener('lostpointercapture',release);
  element.addEventListener('keydown',event=>{
   if(!directions[event.code]||this.pointerId!==null)return;
   event.preventDefault();this.keys.add(event.code);this.keyboard();
  });
  element.addEventListener('keyup',event=>{
   if(!directions[event.code])return;
   event.preventDefault();this.keys.delete(event.code);this.keyboard();
  });
  element.addEventListener('blur',()=>this.reset());
  window.addEventListener('blur',()=>this.reset());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.reset();});
 }

 update(dt:number){
  if(!this.x&&!this.y)return;
  if(!this.element.getClientRects().length||document.querySelector('dialog[open]')){this.reset();return;}
  const distance=Math.hypot(this.x,this.y),deadZone=.1;
  if(distance<=deadZone)return;
  const strength=(distance-deadZone)/(1-deadZone);
  this.turn(this.x/distance*strength*1.4*dt,this.y/distance*strength*1.1*dt);
 }

 reset(){
  const pointerId=this.pointerId;this.pointerId=null;this.keys.clear();this.set(0,0);
  if(pointerId!==null&&this.element.hasPointerCapture(pointerId))this.element.releasePointerCapture(pointerId);
 }

 private travel(){return Math.max(1,(this.element.clientWidth-this.thumb.offsetWidth)/2-6);}
 private move(event:PointerEvent){
  const rect=this.element.getBoundingClientRect(),travel=this.travel();
  this.set((event.clientX-rect.left-rect.width/2)/travel,(event.clientY-rect.top-rect.height/2)/travel);
 }
 private keyboard(){
  let x=0,y=0;for(const key of this.keys){x+=directions[key][0];y+=directions[key][1];}this.set(x,y);
 }
 private set(x:number,y:number){
  const length=Math.max(1,Math.hypot(x,y));this.x=x/length;this.y=y/length;
  this.element.style.setProperty('--stick-x',this.x*this.travel()+'px');
  this.element.style.setProperty('--stick-y',this.y*this.travel()+'px');
  this.element.dataset.active=String(this.pointerId!==null||this.keys.size>0);
 }
}
