import {MATERIALS} from './content';
import {isProduct,type Material,type Stock} from '../sim/model';
import type {GameMode} from '../sim/system';
import {currentLocale,translatePhrase} from './i18n';
export const inventoryMarkup=()=>`<aside id="catalog" class="catalog" aria-label="전체 인벤토리" hidden><header><div><span class="eyebrow">COLLECTION</span><h2>전체 인벤토리</h2></div><button id="catalog-close" class="icon-button" aria-label="인벤토리 닫기">×</button></header><label class="catalog-search">물질 찾기<input id="catalog-search" type="search" placeholder="이름 또는 성질로 검색" autocomplete="off"></label><div class="catalog-filters" aria-label="인벤토리 분류">${[['all','전체'],['surface','기본'],['gas','기체'],['crafted','광물'],['life','생태']].map(([id,name])=>`<button data-catalog-filter="${id}" aria-pressed="${id==='all'}">${name}</button>`).join('')}</div><div id="catalog-list"></div><p id="catalog-empty" hidden>표시할 재료가 없습니다.</p><button id="sample-resupply" class="text-button">소진된 생물 표본 다시 받기</button></aside>`;
export class Inventory {
 private pinned:Material[]=MATERIALS.map(m=>m.id);
 private selected:Material|null=null;private editing=false;
 private filter='all';private query='';private stock:Stock;private known=new Set<string>();private mode:GameMode='campaign';
 constructor(private select:(id:Material)=>void,stock:Stock,resupply:()=>void){
  this.stock=stock;document.getElementById('sample-resupply')!.addEventListener('click',resupply);
  window.addEventListener('sandsphere-language-change',()=>{this.quick();if(!document.getElementById('catalog')!.hidden)this.render();});
  try{const saved=JSON.parse(localStorage.getItem('sandsphere-quick-inventory')??'null');if(Array.isArray(saved))this.pinned=[...new Set(saved.filter(id=>MATERIALS.some(m=>m.id===id)))] as Material[];}catch{}
  document.getElementById('catalog-search')!.addEventListener('input',e=>{this.query=(e.target as HTMLInputElement).value.trim().toLowerCase();this.render();});
  document.querySelectorAll<HTMLButtonElement>('[data-catalog-filter]').forEach(b=>b.addEventListener('click',()=>{this.filter=b.dataset.catalogFilter!;this.render();}));
  document.getElementById('quick-edit')!.addEventListener('click',()=>{this.editing=!this.editing;this.quick();});
  document.getElementById('quick-add')!.addEventListener('click',()=>this.open());
  document.querySelector('.material-list')!.addEventListener('click',e=>{const remove=(e.target as Element).closest<HTMLElement>('[data-quick-remove]');if(remove){this.togglePin(remove.dataset.quickRemove as Material);document.getElementById('quick-edit')!.focus();}});
  document.getElementById('catalog-close')!.addEventListener('click',()=>this.close());
  document.getElementById('catalog-list')!.addEventListener('click',e=>{
   const pin=(e.target as Element).closest<HTMLElement>('[data-pin]');if(pin){const id=pin.dataset.pin as Material;this.togglePin(id);return;}
   const item=(e.target as Element).closest<HTMLButtonElement>('[data-select-material]');if(item&&!item.disabled){this.select(item.dataset.selectMaterial as Material);this.close();}
  });
 }
 open(){document.getElementById('catalog')!.hidden=false;this.render();document.getElementById('catalog-search')!.focus();}
 close(){document.getElementById('catalog')!.hidden=true;document.getElementById('inventory-open')!.focus();}
 update(stock:Stock,known:Set<string>,mode:GameMode){this.stock=stock;this.known=known;this.mode=mode;document.getElementById('sample-resupply')!.hidden=mode==='sandbox';this.quick();if(!document.getElementById('catalog')!.hidden)this.render();}
 setSelection(id:Material|null){this.selected=id;this.quick();}
 private togglePin(id:Material){
  if(this.pinned.includes(id))this.pinned=this.pinned.filter(p=>p!==id);else this.pinned.push(id);
  try{localStorage.setItem('sandsphere-quick-inventory',JSON.stringify(this.pinned));}catch{}
  this.quick();if(!document.getElementById('catalog')!.hidden)this.render();
 }
 private available(id:Material){return this.mode==='sandbox'||!isProduct(id)||this.known.has(id)||this.stock[id]>0;}
 quick(){
  const selected=this.selected,extra=selected!==null&&!this.pinned.includes(selected);
  document.querySelectorAll<HTMLElement>('[data-quick-material]').forEach(row=>{
   const id=row.dataset.quickMaterial as Material,pinned=this.pinned.includes(id);
   row.hidden=!this.available(id)||(!pinned&&id!==selected);row.style.order=String(id===selected&&extra?-1:this.pinned.indexOf(id));
   row.dataset.temporary=String(!pinned&&id===selected);
   const button=row.querySelector<HTMLButtonElement>('[data-material]')!;button.hidden=row.hidden;
   row.querySelector<HTMLButtonElement>('[data-quick-remove]')!.hidden=!this.editing||!pinned;
  });
  const edit=document.getElementById('quick-edit')!;edit.textContent=this.editing?'완료':'편집';edit.setAttribute('aria-pressed',String(this.editing));
  document.querySelector('.material-list')!.classList.toggle('editing',this.editing);
  const add=document.getElementById('quick-add')!;add.hidden=!this.editing;add.style.order=String(this.pinned.length);
  const label=document.getElementById('selected-material-label')!;label.hidden=selected===null;
  label.textContent=selected?(currentLocale()==='en'?'Selected material · '+translatePhrase(MATERIALS.find(m=>m.id===selected)!.name):'선택 재료 · '+MATERIALS.find(m=>m.id===selected)!.name):'';
 }
 private render(){
  this.quick();document.querySelectorAll<HTMLElement>('[data-catalog-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.catalogFilter===this.filter)));
  const items=MATERIALS.filter(m=>this.available(m.id)&&(this.filter==='all'||m.category===this.filter)&&(!this.query||[m.name,m.type,m.note,translatePhrase(m.name),translatePhrase(m.type),translatePhrase(m.note)].join(' ').toLowerCase().includes(this.query)));
  const container=document.getElementById('catalog-list')!;container.replaceChildren();
  for(const m of items){
   const finite=this.mode==='campaign'&&isProduct(m.id),amount=isProduct(m.id)?this.stock[m.id]:Infinity;
   const row=document.createElement('div');row.className='catalog-row';
   const button=document.createElement('button');button.dataset.selectMaterial=m.id;button.className='catalog-material';button.setAttribute('aria-pressed',String(this.selected===m.id));button.disabled=finite&&amount<=0;
   const title=document.createElement('strong');title.textContent=translatePhrase(m.name);
   const count=document.createElement('span');if(!finite){count.className='supply-unlimited';count.setAttribute('aria-label','무제한');}count.textContent=finite?amount.toFixed(1)+' kg':'∞';
   const note=document.createElement('small');note.textContent=translatePhrase(m.note);button.append(title,count,note);
   const pin=document.createElement('button');pin.className='catalog-pin';pin.dataset.pin=m.id;const pinned=this.pinned.includes(m.id);pin.textContent=pinned?'★':'☆';pin.setAttribute('aria-label',currentLocale()==='en'?`${translatePhrase(m.name)} · ${pinned?'Unpin':'Pin to quick selection'}`:m.name+(pinned?' 고정 해제':' 빠른 선택에 고정'));pin.setAttribute('aria-pressed',String(pinned));pin.title=currentLocale()==='en'?(pinned?'Remove from quick selection':'Add to quick selection'):(pinned?'빠른 선택에서 제외':'빠른 선택에 추가');
   row.append(button,pin);container.append(row);
  }
  document.getElementById('catalog-empty')!.hidden=items.length>0;
 }
}
