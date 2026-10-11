import type {PlanetView} from '../render/planet';

export function sectionSelectionMarkup(){return `<div id="section-selection-controls" class="section-selection-controls" hidden><div><strong>절단선 선택</strong><output id="section-selection-count" aria-live="polite"></output></div><p>양 끝 셀을 드래그해 범위를 선택하세요.</p><div class="section-selection-actions"><button id="section-selection-open">선택한 단면 열기</button><button id="section-selection-cancel">취소</button></div></div>`;}

function hull(points:{x:number;y:number}[]){
  const sorted=[...points].sort((a,b)=>a.x-b.x||a.y-b.y),cross=(a:{x:number;y:number},b:{x:number;y:number},c:{x:number;y:number})=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half=(items:typeof points)=>{const out:typeof points=[];for(const p of items){while(out.length>1&&cross(out[out.length-2],out[out.length-1],p)<=0)out.pop();out.push(p);}out.pop();return out;};
  return [...half(sorted),...half([...sorted].reverse())];
}

/** DOM handles stay in CSS pixels; all picks and owners come from the live globe. */
export class SectionSelectionControls {
  private handles:HTMLButtonElement[]=[];
  private dragging:{end:'a'|'b';id:number}|null=null;
  constructor(private view:PlanetView,host:HTMLElement){
    for(const end of ['a','b'] as const){
      const handle=document.createElement('button');handle.className='section-endpoint';handle.dataset.endpoint=end;handle.innerHTML='<svg aria-hidden="true"><polygon/></svg>';handle.hidden=true;
      handle.setAttribute('aria-label',`절단선 ${end==='a'?'시작점':'끝점'}`);handle.title='드래그 또는 방향키로 절단선 끝점 이동';host.append(handle);this.handles.push(handle);
      handle.addEventListener('pointerdown',event=>{if(event.button!==0||!view.isSelectingSection)return;event.preventDefault();event.stopPropagation();this.dragging={end,id:event.pointerId};view.camera.detachControl();handle.setPointerCapture(event.pointerId);handle.focus({preventScroll:true});});
      handle.addEventListener('pointermove',event=>{if(this.dragging?.id!==event.pointerId)return;event.preventDefault();event.stopPropagation();this.move(end,event.clientX,event.clientY);});
      const release=(event:PointerEvent)=>{if(this.dragging?.id!==event.pointerId)return;event.stopPropagation();this.dragging=null;if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);view.camera.attachControl(view.canvas,true);view.orbitMode(true);};
      handle.addEventListener('pointerup',release);handle.addEventListener('pointercancel',release);handle.addEventListener('lostpointercapture',release);
      handle.addEventListener('keydown',event=>{
        if(!view.isSelectingSection||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
        event.preventDefault();event.stopPropagation();view.stepSectionEndpoint(end,event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0,event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0,event.shiftKey?4:1);
      });
    }
    document.getElementById('section-selection-open')!.addEventListener('click',()=>{if(view.sectionSelection.cells.length){view.setSection(true);view.canvas.focus({preventScroll:true});}});
    document.getElementById('section-selection-cancel')!.addEventListener('click',()=>{view.cancelSectionSelection();document.querySelector<HTMLButtonElement>('[data-camera-view="section"]')?.focus();});
  }
  private move(end:'a'|'b',x:number,y:number){const r=this.view.canvas.getBoundingClientRect(),hit=this.view.pick(x-r.left,y-r.top);if(hit&&!hit.inAir)this.view.moveSectionEndpointCell(end,hit.index);}
  refresh(){
    const editing=this.view.isSelectingSection,count=this.view.sectionSelection.cells.length;
    document.getElementById('section-selection-controls')!.hidden=!editing;
    document.getElementById('section-selection-count')!.textContent=`${count}셀`;
    (document.getElementById('section-selection-open') as HTMLButtonElement).disabled=count===0;
    this.update();
  }
  update(){for(const handle of this.handles){
    const p=this.view.sectionEndpointPosition(handle.dataset.endpoint as 'a'|'b');handle.hidden=!this.view.isSelectingSection||!p?.visible;if(!p)continue;
    const outline=hull(p.outline);if(outline.length<3){handle.hidden=true;continue;}
    const left=Math.min(...outline.map(v=>v.x))-3,top=Math.min(...outline.map(v=>v.y))-3,width=Math.max(...outline.map(v=>v.x))-left+3,height=Math.max(...outline.map(v=>v.y))-top+3;
    handle.dataset.cell=String(p.index);handle.style.left=left+'px';handle.style.top=top+'px';handle.style.width=width+'px';handle.style.height=height+'px';
    const svg=handle.querySelector('svg')!;svg.setAttribute('viewBox',`0 0 ${width} ${height}`);handle.querySelector('polygon')!.setAttribute('points',outline.map(v=>`${v.x-left},${v.y-top}`).join(' '));
    handle.style.clipPath='polygon('+outline.map(v=>`${v.x-left+(v.x-p.x)*.08}px ${v.y-top+(v.y-p.y)*.08}px`).join(',')+')';
  }}
}
