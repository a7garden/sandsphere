import {icon} from './icons';

interface NamedPlanet {id:string;name:string;}
export function planetNavigationMarkup(){return `<div class="header-planets"><span class="header-planet-icon" aria-hidden="true">${icon('planet')}</span><select id="header-planet-select" aria-label="행성 전환" title="행성 전환"></select><button id="planet-rename" class="icon-button" aria-label="행성 이름 변경" title="행성 이름 변경" aria-expanded="false" aria-controls="planet-name-form">${icon('edit')}</button><form id="planet-name-form" class="planet-name-editor" hidden novalidate><input id="planet-name" aria-label="행성 이름" aria-describedby="planet-name-hint planet-name-error" maxlength="28" autocomplete="off" spellcheck="false"><button id="planet-name-apply" class="icon-button" type="submit" aria-label="이름 저장" title="저장 · Enter">${icon('check')}</button><button id="planet-name-cancel" class="icon-button" type="button" aria-label="이름 변경 취소" title="취소 · Esc">${icon('close')}</button><div class="planet-name-assist"><span id="planet-name-hint"><kbd>Enter</kbd> 저장 <span>·</span> <kbd>Esc</kbd> 취소</span><output id="planet-name-count" aria-label="이름 글자 수"></output><span id="planet-name-error" role="alert" hidden></span></div></form><span id="planet-name-status" class="visually-hidden" role="status"></span></div>`;}

export class PlanetNavigation {
 private root=document.querySelector<HTMLElement>('.header-planets')!;
 private select=document.getElementById('header-planet-select') as HTMLSelectElement;
 private edit=document.getElementById('planet-rename') as HTMLButtonElement;
 private form=document.getElementById('planet-name-form') as HTMLFormElement;
 private input=document.getElementById('planet-name') as HTMLInputElement;
 private error=document.getElementById('planet-name-error')!;
 private renameId='';private navigatingId='';private composing=false;
 private savedTimer:ReturnType<typeof setTimeout>|undefined;
 constructor(private planets:()=>NamedPlanet[],private activeId:()=>string,private busy:()=>boolean,private navigate:(id:string)=>Promise<void>,private rename:(id:string,name:string)=>void){
  this.select.addEventListener('change',async()=>{const id=this.select.value;this.navigatingId=id;this.select.disabled=true;this.edit.disabled=true;try{await this.navigate(id);}finally{this.navigatingId='';this.update();}});
  this.edit.addEventListener('click',()=>this.openRename());
  this.form.addEventListener('submit',event=>{event.preventDefault();if(this.composing)return;const name=this.input.value.trim();if(!name){this.error.textContent='이름을 입력하세요.';this.error.hidden=false;this.input.setAttribute('aria-invalid','true');this.input.focus();return;}const current=this.planets().find(p=>p.id===this.renameId);if(!current||this.busy())return;if(current.name!==name)this.rename(current.id,name);this.finish(true);document.getElementById('planet-name-status')!.textContent=name+' 이름을 저장했습니다.';this.root.dataset.saved='true';this.edit.innerHTML=icon('check');clearTimeout(this.savedTimer);this.savedTimer=setTimeout(()=>{delete this.root.dataset.saved;this.edit.innerHTML=icon('edit');},1400);});
  document.getElementById('planet-name-cancel')!.addEventListener('click',()=>this.finish(true));
  this.form.addEventListener('keydown',event=>{event.stopPropagation();if(event.isComposing||this.composing||event.keyCode===229){if(event.key==='Enter')event.preventDefault();return;}if(event.key==='Escape'){event.preventDefault();this.finish(true);}});
  this.input.addEventListener('compositionstart',()=>this.composing=true);this.input.addEventListener('compositionend',()=>this.composing=false);
  this.input.addEventListener('input',()=>{this.error.hidden=true;this.input.removeAttribute('aria-invalid');this.updateCount();});
  document.addEventListener('pointerdown',event=>{if(this.renameId&&!this.root.contains(event.target as Node))this.finish(false);});
  this.form.addEventListener('focusout',event=>{if(event.relatedTarget&&!this.form.contains(event.relatedTarget as Node))this.finish(false);});
  this.update();
 }
 openRename(){const planet=this.planets().find(p=>p.id===this.activeId());if(!planet||this.busy())return;clearTimeout(this.savedTimer);delete this.root.dataset.saved;this.edit.innerHTML=icon('edit');this.renameId=planet.id;this.composing=false;this.error.hidden=true;this.input.removeAttribute('aria-invalid');this.input.value=planet.name;this.form.hidden=false;this.select.hidden=this.edit.hidden=true;this.edit.setAttribute('aria-expanded','true');this.root.dataset.editing='true';this.updateCount();this.input.focus();this.input.select();}
 private updateCount(){document.getElementById('planet-name-count')!.textContent=this.input.value.length+'/28';}
 private finish(focus:boolean){this.renameId='';this.composing=false;this.form.hidden=true;this.select.hidden=this.edit.hidden=false;this.edit.setAttribute('aria-expanded','false');delete this.root.dataset.editing;this.update();if(focus)this.edit.focus();}
 update(){
  const planets=this.planets();
  if(this.renameId&&(this.renameId!==this.activeId()||!planets.some(p=>p.id===this.renameId)))this.finish(false);
  for(const option of [...this.select.options])if(!planets.some(p=>p.id===option.value))option.remove();
  for(const planet of planets){let option=[...this.select.options].find(o=>o.value===planet.id);if(!option){option=document.createElement('option');option.value=planet.id;this.select.append(option);}if(option.textContent!==planet.name)option.textContent=planet.name;}
  this.select.value=this.navigatingId||this.activeId();const current=planets.find(p=>p.id===this.select.value);
  this.select.disabled=this.edit.disabled=!current||this.busy();this.select.title=current?current.name+' · 행성 전환':'행성 전환';
 }
}
