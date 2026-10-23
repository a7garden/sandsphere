import {MATERIALS} from './content';
import {F,isProduct,type Material,type Stock} from '../sim/model';
import type {GameMode} from '../sim/system';
import {currentLocale,translatePhrase} from './i18n';
import {freshProgress,lifeSampleAvailability,planetInventory,type Progress,type CampaignPlanet} from '../sim/progress';
import {MATERIAL_SOURCES,formatSupplyMass} from './materialSupply';
export const inventoryMarkup=()=>`<aside id="catalog" class="catalog" aria-label="전체 인벤토리" hidden><header><div><span class="eyebrow">COLLECTION</span><h2>전체 인벤토리</h2></div><button id="catalog-close" class="icon-button" aria-label="인벤토리 닫기">×</button></header><label class="catalog-search">물질 찾기<input id="catalog-search" type="search" placeholder="이름 또는 성질로 검색" autocomplete="off"></label><div class="catalog-filters" aria-label="인벤토리 분류">${[['all','전체'],['surface','기본'],['gas','기체'],['crafted','광물'],['life','생태']].map(([id,name])=>`<button data-catalog-filter="${id}" aria-pressed="${id==='all'}">${name}</button>`).join('')}</div><div class="catalog-scroll"><p id="catalog-guide" class="catalog-guide">기본 재료 9종은 무제한입니다. 생성물·생물 7종은 회수하거나 보상으로 받은 보관함 수량만큼 공급합니다.</p><div id="catalog-list"></div><p id="catalog-empty" hidden>표시할 재료가 없습니다.</p><section id="sample-recovery"><h3>생물 표본 수급</h3><ul id="sample-status"></ul><p>보관함과 모든 행성의 해당 생물량이 합쳐서 0.01kg 미만이면 해금된 표본을 다시 받습니다.</p><button id="sample-resupply" class="text-button">소진된 생물 표본 다시 받기</button></section></div></aside>`;
export class Inventory {
 private pinned:Material[]=MATERIALS.map(m=>m.id);
 private selected:Material|null=null;private editing=false;
 private progress:Progress=freshProgress();private planets:CampaignPlanet[]=[];
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
 update(stock:Stock,known:Set<string>,mode:GameMode,progress:Progress=freshProgress(),planets:CampaignPlanet[]=[]){this.stock=stock;this.known=known;this.mode=mode;this.progress=progress;this.planets=planets;document.getElementById('sample-recovery')!.hidden=mode==='sandbox';this.quick();if(!document.getElementById('catalog')!.hidden)this.render();}
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
 refreshCampaign(progress:Progress,planets:CampaignPlanet[]){
  this.progress=progress;this.planets=planets;
  if(!document.getElementById('catalog')!.hidden)this.refreshReadouts();
 }
 private refreshReadouts(){
  const en=currentLocale()==='en',sums=this.planets.map(planetInventory);
  for(const m of MATERIALS){
   const count=document.querySelector<HTMLElement>('[data-catalog-quantity="'+m.id+'"]'),location=document.querySelector<HTMLElement>('[data-catalog-world="'+m.id+'"]');
   if(!count||!location)continue;
   const finite=this.mode==='campaign'&&isProduct(m.id);
   count.textContent=finite?formatSupplyMass(this.stock[m.id as keyof Stock]):'∞';
   document.querySelector<HTMLButtonElement>('[data-select-material="'+m.id+'"]')!.disabled=finite&&this.stock[m.id as keyof Stock]<.00001;
   if(finite){
    const mass=sums.reduce((n,t)=>n+t[F[m.id]],0);
    location.textContent=(en?'On planets · ':'행성에 남은 양 · ')+formatSupplyMass(mass);
   }else location.textContent=en?'Unlimited supply':'무제한 공급';
  }
  const samples=lifeSampleAvailability(this.progress,this.planets,this.stock),list=document.getElementById('sample-status')!;
  list.replaceChildren();
  for(const sample of samples){
   const row=document.createElement('li'),name=translatePhrase(MATERIALS.find(m=>m.id===sample.id)!.name);
   const status=!sample.unlocked?(en?'Complete the prerequisite expedition':'선행 과제 완료 필요'):sample.depleted?(en?'Ready to restock':'재보급 가능'):this.stock[sample.id]>0?(en?'Sample in inventory':'보관함에 표본 있음'):(en?'Collect from a planet':'행성에서 회수 가능');
   row.textContent=name+' · '+(en?'Restock ':'재보급 ')+formatSupplyMass(sample.amount)+' · '+status;list.append(row);
  }
  document.getElementById('sample-resupply')!.toggleAttribute('disabled',!samples.some(s=>s.unlocked&&s.depleted));
 }
 private render(){
  document.getElementById('catalog-guide')!.textContent=translatePhrase(this.mode==='sandbox'?'샌드박스에서는 모든 재료를 무제한 공급합니다. 아래 제작·보상 설명은 캠페인의 수급 경로입니다.':'기본 재료 9종은 무제한입니다. 생성물·생물 7종은 회수하거나 보상으로 받은 보관함 수량만큼 공급합니다.');
  this.quick();document.querySelectorAll<HTMLElement>('[data-catalog-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.catalogFilter===this.filter)));
  const items=MATERIALS.filter(m=>(this.filter==='all'||m.category===this.filter)&&(!this.query||[m.name,m.type,m.note,translatePhrase(m.name),translatePhrase(m.type),translatePhrase(m.note),MATERIAL_SOURCES[m.id],translatePhrase(MATERIAL_SOURCES[m.id])].join(' ').toLowerCase().includes(this.query)));
  const container=document.getElementById('catalog-list')!;container.replaceChildren();
  for(const m of items){
   const finite=this.mode==='campaign'&&isProduct(m.id),amount=isProduct(m.id)?this.stock[m.id]:Infinity;
   const row=document.createElement('div');row.className='catalog-row';
   const button=document.createElement('button');button.dataset.selectMaterial=m.id;button.className='catalog-material';button.setAttribute('aria-pressed',String(this.selected===m.id));button.disabled=finite&&amount<.00001;
   const title=document.createElement('strong');title.textContent=translatePhrase(m.name);
   const count=document.createElement('span');count.dataset.catalogQuantity=m.id;if(!finite){count.className='supply-unlimited';count.setAttribute('aria-label','무제한');}count.textContent=finite?formatSupplyMass(amount):'∞';
   const note=document.createElement('small');note.textContent=translatePhrase(m.note);button.append(title,count);
   const detail=document.createElement('div');detail.className='catalog-material-detail';
   const source=document.createElement('p');source.textContent=translatePhrase(MATERIAL_SOURCES[m.id]);
   const location=document.createElement('output');location.dataset.catalogWorld=m.id;
   detail.append(note,source,location);
   const pin=document.createElement('button');pin.className='catalog-pin';pin.dataset.pin=m.id;const pinned=this.pinned.includes(m.id);pin.textContent=pinned?'★':'☆';pin.setAttribute('aria-label',currentLocale()==='en'?`${translatePhrase(m.name)} · ${pinned?'Unpin':'Pin to quick selection'}`:m.name+(pinned?' 고정 해제':' 빠른 선택에 고정'));pin.setAttribute('aria-pressed',String(pinned));pin.title=currentLocale()==='en'?(pinned?'Remove from quick selection':'Add to quick selection'):(pinned?'빠른 선택에서 제외':'빠른 선택에 추가');
   row.append(button,pin,detail);container.append(row);
  }
  document.getElementById('catalog-empty')!.hidden=items.length>0;this.refreshReadouts();
 }
}
