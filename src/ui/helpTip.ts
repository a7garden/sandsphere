import {icon} from './icons';
import {currentLocale,translatePhrase} from './i18n';

const escape=(text:string)=>text.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function helpTip(id:string,label:string,text:string){
 const accessibleLabel=currentLocale()==='en'?`${translatePhrase(label)} help`:`${label} 설명`;
 return `<span class="help-tip"><button type="button" class="help-tip-button" data-help-tip="${id}" aria-label="${escape(accessibleLabel)}" aria-describedby="${id}" aria-expanded="false">${icon('info')}</button><span id="${id}" class="help-tip-content" role="tooltip" popover="manual">${escape(text)}</span></span>`;
}

/** Top-layer tooltips remain readable inside scrolling sidebars. */
export function setupHelpTips(){
 let active:{button:HTMLButtonElement;tip:HTMLElement;pinned:boolean}|null=null;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const close=()=>{clearTimeout(timer);if(!active)return;active.tip.hidePopover();active.button.setAttribute('aria-expanded','false');active=null;};
 const open=(button:HTMLButtonElement,pinned=false)=>{
  clearTimeout(timer);
  if(active?.button===button){active.pinned ||= pinned;return;}
  close();const tip=document.getElementById(button.dataset.helpTip!)!;
  tip.style.visibility='hidden';tip.showPopover();
  const anchor=button.getBoundingClientRect(),box=tip.getBoundingClientRect();
  tip.style.left=Math.max(12,Math.min(innerWidth-box.width-12,anchor.left))+'px';
  const below=anchor.bottom+8;
  tip.style.top=Math.max(12,below+box.height<=innerHeight-12?below:anchor.top-box.height-8)+'px';
  tip.style.visibility='visible';button.setAttribute('aria-expanded','true');active={button,tip,pinned};
 };
 const leave=()=>{clearTimeout(timer);if(!active?.pinned)timer=setTimeout(close,120);};
 document.querySelectorAll<HTMLButtonElement>('[data-help-tip]').forEach(button=>{
  const tip=document.getElementById(button.dataset.helpTip!)!;
  button.addEventListener('pointerenter',()=>open(button));
  button.addEventListener('pointerleave',leave);
  button.addEventListener('focus',()=>open(button));
  button.addEventListener('blur',()=>{if(!active?.pinned)close();});
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(active?.button===button&&active.pinned)close();else open(button,true);});
  tip.addEventListener('pointerenter',()=>clearTimeout(timer));tip.addEventListener('pointerleave',leave);
 });
 document.addEventListener('pointerdown',event=>{if(active&&!active.button.contains(event.target as Node)&&!active.tip.contains(event.target as Node))close();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&active){event.stopImmediatePropagation();close();}},true);
 window.addEventListener('resize',close);
 document.addEventListener('scroll',event=>{if(event.target!==active?.tip)close();},true);
}
