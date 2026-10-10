import {CLIMATE_LAYERS,type ClimateLayer} from '../sim/weatherClimate';
import {icon} from './icons';

/** Reserve the live legend's height when opening the planet settings overlay. */
export function keepSceneLayersVisible(){
 const app=document.querySelector<HTMLElement>('.app')!;
 const dock=document.querySelector<HTMLElement>('.scene-layer-dock')!;
 const controls=document.querySelector<HTMLElement>('.planet-controls')!;
 const header=document.querySelector<HTMLElement>('.topbar')!;
 const scene=document.querySelector<HTMLElement>('.view')!;
 const layout=new ResizeObserver(()=>{
  const top=dock.getBoundingClientRect().top;scene.style.setProperty('--weather-dock-height',dock.getBoundingClientRect().height+'px');
  app.style.setProperty('--scene-panel-bottom',`${Math.max(0,controls.getBoundingClientRect().bottom-top+16)}px`);
  app.style.setProperty('--scene-panel-max-height',`${Math.max(120,top-header.getBoundingClientRect().bottom-32)}px`);
 });
 for(const element of [dock,controls,header,scene])layout.observe(element);
}

export function sceneLayersMarkup(){return `<div class="climate-map-controls"><div class="climate-layer-selector"><button id="climate-map-toggle" type="button" aria-label="관찰 지도: 물질" aria-haspopup="listbox" aria-expanded="false" aria-controls="climate-layer"><span class="climate-picker-label">관찰 지도</span><span id="climate-map-name">물질</span>${icon('chevron')}</button><div id="climate-layer" class="climate-picker-menu" role="listbox" aria-label="관찰 지도" hidden>${Object.entries(CLIMATE_LAYERS).map(([id,info])=>`<button type="button" role="option" data-climate-option="${id}" aria-selected="${id==='none'}" tabindex="-1"><span>${info.name}</span>${icon('check')}</button>`).join('')}</div><button id="climate-legend-toggle" type="button" aria-expanded="false" aria-controls="climate-layer-legend scene-layer-legend" aria-label="지도 범례">범례</button></div><div id="climate-layer-legend" class="climate-layer-legend" hidden></div></div><div class="scene-layer-dock">
<div id="scene-layer-legend" class="scene-layer-legend" role="group" aria-label="활성 레이어 범례" hidden>
<div id="atmosphere-map-key" class="scene-layer-key" hidden><i id="air-color-key" aria-hidden="true"></i><span>대기</span><output id="air-key-state"></output></div>
<div id="cloud-map-key" class="scene-layer-key" hidden><i class="cloud-color-key" aria-hidden="true"></i><span>구름</span><output id="cloud-key-state"></output></div>
<div id="precipitation-map-key" class="scene-precipitation-key" aria-label="강수 지역 범례" hidden>
<span id="dry-key-state">현재 강수 없음</span>
<div id="rain-map-key" class="scene-layer-key" hidden><i class="rain-region" aria-hidden="true"></i><span>비</span><output id="rain-key-state"></output><span class="layer-intensity" title="초당 강수량이 많을수록 진하게 표시">약<i class="rain-intensity" aria-hidden="true"></i>강</span></div>
<div id="snow-map-key" class="scene-layer-key" hidden><i class="snow-region" aria-hidden="true"></i><span>눈</span><output id="snow-key-state"></output><span class="layer-intensity" title="초당 강수량이 많을수록 진하게 표시">약<i class="snow-intensity" aria-hidden="true"></i>강</span></div>
<span id="paused-key-state" class="layer-key-note" hidden>일시정지 · 마지막 강수 분포</span></div></div>

<div class="scene-layer-controls" role="group" aria-label="표시 레이어">
<button id="layer-atmosphere" aria-pressed="true" title="대기 표시 / 숨김">${icon('gas')}<span>대기</span></button>
<button id="layer-clouds" aria-pressed="true" title="구름 표시 / 숨김 · 숨겨도 기후 계산은 계속됩니다.">${icon('cloud')}<span>구름</span></button>
<button id="layer-axis" aria-pressed="true" title="자전축 표시 / 숨김">${icon('axisLine')}<span>자전축</span></button>
<button id="layer-precipitation" aria-pressed="false" title="강수 지역 표시 / 숨김 · 강수량이 많을수록 진하게 표시하며, 일시정지 시 마지막 분포를 유지합니다.">${icon('water')}<span>강수</span></button>
</div></div>`;}

export function updateSceneLayerLegend(state:{
 atmosphere:{enabled:boolean;color:number[];summary:string};
 clouds:{enabled:boolean;mass:number};
 precipitation:{enabled:boolean;rainCells:number;snowCells:number;paused:boolean};
}){
 const node=(id:string)=>document.getElementById(id)!;
 node('scene-layer-legend').hidden=!(state.atmosphere.enabled||state.clouds.enabled||state.precipitation.enabled);
 node('atmosphere-map-key').hidden=!state.atmosphere.enabled;
 node('air-color-key').style.background=`rgb(${state.atmosphere.color.map(c=>Math.round(c*255)).join(' ')})`;
 node('air-key-state').textContent=state.atmosphere.summary;
 node('cloud-map-key').hidden=!state.clouds.enabled;
 node('cloud-key-state').textContent=state.clouds.mass>.01?`${state.clouds.mass.toFixed(1)} kg`:'현재 구름 없음';
 const rain=state.precipitation.rainCells,snow=state.precipitation.snowCells;
 node('precipitation-map-key').hidden=!state.precipitation.enabled;
 node('dry-key-state').hidden=rain+snow>0;
 node('rain-map-key').hidden=!rain;node('snow-map-key').hidden=!snow;
 node('rain-key-state').textContent=`${rain}곳`;node('snow-key-state').textContent=`${snow}곳`;
 node('paused-key-state').hidden=!state.precipitation.paused||rain+snow===0;
}

export function updateClimateLegend(layer:ClimateLayer,count=2562){
 const legend=document.getElementById('climate-layer-legend')!;document.querySelector('.climate-map-controls')!.setAttribute('data-layer',layer);document.getElementById('climate-legend-toggle')!.setAttribute('aria-expanded','false');document.querySelector('.view')!.setAttribute('data-climate-layer',layer);document.querySelector('.view')!.classList.remove('climate-legend-open');legend.hidden=layer==='none';legend.replaceChildren();
 legend.dataset.categorical=String(layer==='airmass');
 if(layer==='airmass')for(const [label,color] of [['차고 건조','#8c6bd4'],['차고 습함','#29a1d1'],['따뜻하고 건조','#eb9130'],['따뜻하고 습함','#33b861']]){const key=document.createElement('span'),chip=document.createElement('i');chip.style.background=color;key.append(chip,label);legend.append(key);}
 else {const ramp=document.createElement('i');ramp.className='climate-map-ramp';ramp.setAttribute('aria-hidden','true');const note=document.createElement('span');note.textContent=layer==='wind'||layer==='currents'?`색: 속도 · 화살표: 방향 · 0 → ${((layer==='wind'?.12:.035)/Math.sqrt(4*Math.PI/count)).toFixed(2)} 셀/게임초`:CLIMATE_LAYERS[layer].legend;legend.append(ramp,note);}
}


export function updateClimatePicker(layer:ClimateLayer){
 const toggle=document.getElementById('climate-map-toggle')!;
 document.getElementById('climate-map-name')!.textContent=CLIMATE_LAYERS[layer].name;
 toggle.setAttribute('aria-label','관찰 지도: '+CLIMATE_LAYERS[layer].name);
 document.querySelectorAll<HTMLButtonElement>('[data-climate-option]').forEach(option=>option.setAttribute('aria-selected',String(option.dataset.climateOption===layer)));
}

export function setupClimatePicker(initial:ClimateLayer,onSelect:(layer:ClimateLayer)=>void){
 const toggle=document.getElementById('climate-map-toggle') as HTMLButtonElement;
 const menu=document.getElementById('climate-layer')!;
 const options=[...menu.querySelectorAll<HTMLButtonElement>('[data-climate-option]')];
 const close=(focus=false)=>{menu.hidden=true;toggle.setAttribute('aria-expanded','false');if(focus)toggle.focus();};
 const open=()=>{menu.hidden=false;toggle.setAttribute('aria-expanded','true');(options.find(option=>option.getAttribute('aria-selected')==='true')??options[0]).focus();};
 toggle.addEventListener('click',()=>menu.hidden?open():close());
 toggle.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open();}});
 options.forEach(option=>option.addEventListener('click',()=>{onSelect(option.dataset.climateOption as ClimateLayer);close(true);}));
 menu.addEventListener('keydown',event=>{
  const index=options.indexOf(document.activeElement as HTMLButtonElement);
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
  else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next].focus();
  }else if(event.key==='Tab')close(true);
 });
 document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!toggle.contains(event.target as Node)&&!menu.contains(event.target as Node))close();});
 toggle.parentElement!.addEventListener('focusout',event=>{if(!toggle.parentElement!.contains(event.relatedTarget as Node))close();});
 updateClimatePicker(initial);
}
