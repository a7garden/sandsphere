import {icon} from './icons';
import {PRODUCTS,totals,F,STRIDE,type Stock} from '../sim/model';
import {orbitalPeriod} from '../sim/orbit';
import type {PlanetRecord} from '../sim/system';
import {PRODUCT_NAMES} from './content';

export const systemDialog=()=>`<section id="system-dialog" class="system-dock" aria-label="항성계 탐색" hidden><div class="system-header"><span class="eyebrow">SOLAR SYSTEM</span><h2>작은 항성계</h2><p>행성을 누르면 가까이 이동합니다.</p></div><button id="system-add" class="text-button system-create" aria-label="행성 만들기">${icon('plus')}행성 만들기</button><div id="orbit-map" hidden></div><div id="planet-list" class="planet-list"></div><div class="system-actions"><button id="system-rename" class="text-button">${icon('edit')}행성 이름 변경</button></div><section class="warehouse"><h3>공유 보관함</h3><div class="warehouse-list">${PRODUCTS.map(id=>`<div><span>${PRODUCT_NAMES[id]}</span><output data-stock="${id}">0.0 kg</output></div>`).join('')}</div></section><button id="system-return" class="text-button">현재 행성으로 돌아가기</button></section>`;

export function renderSystemUi(planets:PlanetRecord[],activeId:string,stock:Stock){
 const list=document.getElementById('planet-list')!,map=document.getElementById('orbit-map')!;
 list.replaceChildren();map.querySelectorAll('.orbit-track,.orbit-planet').forEach(n=>n.remove());
 for(const p of planets){
  const button=document.createElement('button');button.className='planet-row';button.dataset.planetId=p.id;button.setAttribute('aria-pressed',String(p.id===activeId));
  const title=document.createElement('strong');title.textContent=p.name;
  const detail=document.createElement('span');detail.dataset.planetSummary=p.id;
  const output=document.createElement('small');output.dataset.planetProduction=p.id;
  button.append(title,detail,output);list.append(button);
  const track=document.createElement('span');track.className='orbit-track';track.dataset.orbitTrack=p.id;track.setAttribute('aria-hidden','true');map.append(track);
  const marker=document.createElement('button');marker.className='orbit-planet';marker.dataset.planetId=p.id;marker.dataset.orbitMarker=p.id;marker.setAttribute('aria-label',p.name+'로 이동');marker.setAttribute('aria-pressed',String(p.id===activeId));map.append(marker);
 }
 updateSystemUi(planets,stock);
}

export function updateSystemUi(planets:PlanetRecord[],stock:Stock){
 for(const id of PRODUCTS)document.querySelector<HTMLOutputElement>('[data-stock="'+id+'"]')!.textContent=stock[id].toFixed(1)+' kg';
 for(const p of planets){
  const s=p.snapshot,e=s.environment,dist=e.orbitDistance??1,phase=e.orbitAngle??0;
  const summary=document.querySelector<HTMLElement>('[data-planet-summary="'+p.id+'"]');
  if(!summary)continue;
  let temperature=0;for(let i=F.temperature;i<s.state.length;i+=STRIDE)temperature+=s.state[i];temperature/=s.state.length/STRIDE;
  summary.textContent=dist.toFixed(2)+' AU · '+temperature.toFixed(0)+'°C · '+(s.paused?'일시 정지':'변화 중');
  const t=totals(new Float32Array(s.state));
  document.querySelector<HTMLElement>('[data-planet-production="'+p.id+'"]')!.textContent=PRODUCTS.filter(id=>t[F[id]]>.05).map(id=>PRODUCT_NAMES[id]+' '+t[F[id]].toFixed(1)+' kg').join(' · ')||'표면 생성물 없음';
  const radius=13+dist/2.4*32,track=document.querySelector<HTMLElement>('[data-orbit-track="'+p.id+'"]')!,marker=document.querySelector<HTMLElement>('[data-orbit-marker="'+p.id+'"]')!;
  track.style.width=track.style.height=(radius*2)+'%';marker.style.left=(50+Math.cos(phase)*radius)+'%';marker.style.top=(50+Math.sin(phase)*radius)+'%';marker.title=p.name+' · 공전 '+orbitalPeriod(dist).toFixed(0)+'초';
 }
}
