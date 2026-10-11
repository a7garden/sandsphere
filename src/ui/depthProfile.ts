import {helpTip} from './helpTip';
import {F,STRIDE} from '../sim/model';
import type {SphereGrid} from '../sim/sphere';
import {columnGeometry} from '../render/columnGeometry';
import {currentLocale,translatePhrase} from './i18n';

export const DEPTH_MATERIALS={water:'물',dissolved:'녹은 소금',rock:'기반암',sand:'모래',clay:'점토',ceramic:'도자기',glass:'유리',ice:'얼음',salt:'소금',molten:'용융 규사',soil:'유기물',iron:'운철'} as const;
type Component={id:keyof typeof DEPTH_MATERIALS;mass:number;fraction:number};
export function depthProfile(state:Float32Array,index:number,grid:SphereGrid,hideBedrock=false){
 const p=index*STRIDE,c=columnGeometry(state,index,grid),liquid=state[p+F.water];
 const dissolved=state[p+F.dissolved],retainedShare=liquid>0?c.retained/liquid:0;
 const components=(entries:[Component['id'],number][])=>{
  const total=entries.reduce((sum,[,mass])=>sum+mass,0);
  return entries.filter(([,mass])=>mass>0).map(([id,mass])=>({id,mass,fraction:mass/total}));
 };
 const layers:{id:'water'|'solid';name:string;top:number;bottom:number;components:Component[]}[]=[];
 if(c.water>1e-6)layers.push({id:'water',name:'물층',top:0,bottom:c.water,components:components([['water',c.water],['dissolved',dissolved*(1-retainedShare)]])});
 const thickness=Math.max(0,c.solid-c.base-(hideBedrock?state[p+F.rock]:0));
 if(thickness>1e-6)layers.push({id:'solid',name:'고체 혼합층',top:c.water,bottom:c.water+thickness,components:components([
  ...(['rock','sand','clay','ceramic','glass','ice','salt','molten','soil','iron'] as const).filter(id=>!hideBedrock||id!=='rock').map(id=>[id,state[p+F[id]]] as [Component['id'],number]),
  ['water',c.retained],['dissolved',dissolved*retainedShare],
 ])});
 return {layers,depth:c.water+thickness};
}
export const depthProfileMarkup=()=>`<section class="depth-profile" aria-label="관측 지점의 깊이별 물질 분포"><div class="depth-heading"><h3>깊이별 분포 ${helpTip('depth-help','깊이별 분포','구간 너비는 층 두께, 구간 안의 색 비율은 질량 비율입니다. 고체층은 균일한 혼합물입니다.')}</h3><span id="depth-direction">표면 → 기반</span></div><div id="depth-spectrum"></div><div id="depth-material-legend" class="depth-material-legend"></div></section>`;
let previousMarkup='';
export function updateDepthProfile(state:Float32Array,index:number,grid:SphereGrid,hideBedrock=false){
 const profile=depthProfile(state,index,grid,hideBedrock),max=Math.max(profile.depth,.001);
 const number=(v:number)=>v.toFixed(2);
 const width=(layer:typeof profile.layers[number])=>(layer.bottom-layer.top)/max*100;
 const en=currentLocale()==='en';
 const band=(layer:typeof profile.layers[number])=>{const layerName=translatePhrase(layer.name);return `<div class="depth-band" style="width:${width(layer)}%" title="${en?`${layerName} · relative depth ${number(layer.top)} to ${number(layer.bottom)}`:`${layer.name} · 상대 깊이 ${number(layer.top)}–${number(layer.bottom)}`}"><div class="depth-mix">${layer.components.map(c=>`<span class="depth-material depth-${c.id}" style="width:${c.fraction*100}%" title="${en?`${layerName} · ${translatePhrase(DEPTH_MATERIALS[c.id])} ${(c.fraction*100).toFixed(1)}% · ${c.mass.toFixed(2)} kg`:`${layer.name} · ${DEPTH_MATERIALS[c.id]} ${(c.fraction*100).toFixed(1)}% · ${c.mass.toFixed(2)} kg`}"></span>`).join('')}</div></div>`;};
 const description=profile.layers.map(l=>en?`${translatePhrase(l.name)}, depth ${number(l.top)} to ${number(l.bottom)}: ${l.components.map(c=>translatePhrase(DEPTH_MATERIALS[c.id])+' '+(c.fraction*100).toFixed(1)+'%').join(', ')}`:`${l.name}, 깊이 ${number(l.top)}부터 ${number(l.bottom)}: ${l.components.map(c=>DEPTH_MATERIALS[c.id]+' '+(c.fraction*100).toFixed(1)+'%').join(', ')}`).join('; ')||(en?'Only fixed bedrock is present at the surface':'표면에 고정 기반만 있습니다');
 const boundary=profile.layers.length===2?profile.layers[0].bottom/max:0;
 const tick=boundary>.12&&boundary<.88?`<span class="depth-boundary" style="left:${boundary*100}%">${number(profile.layers[0].bottom)}</span>`:'';
 document.getElementById('depth-direction')!.textContent=hideBedrock?(en?'Surface → layer base':'표면 → 층 바닥'):(en?'Surface → bedrock':'표면 → 기반');
 const markup=`<div class="depth-axis"><span>${en?'Surface':'표면'} 0</span>${tick}<span>${en?(hideBedrock?'Layer base':'Bedrock'):(hideBedrock?'층 바닥':'기반')} ${number(profile.depth)}</span></div><div class="depth-ribbon" role="img" aria-label="${description}">${profile.layers.map(band).join('')}</div><div class="depth-layer-labels">${profile.layers.map(l=>`<span style="width:${width(l)}%" title="${en?`${translatePhrase(l.name)} · thickness ${number(l.bottom-l.top)}`:`${l.name} · 두께 ${number(l.bottom-l.top)}`}">${translatePhrase(l.name)}</span>`).join('')||(en?'<span>Fixed bedrock</span>':'<span>고정 기반</span>')}</div>`;
 const materials=[...new Set(profile.layers.flatMap(l=>l.components.map(c=>c.id)))];
 const legend=materials.map(id=>`<span><i class="depth-material depth-${id}"></i>${translatePhrase(DEPTH_MATERIALS[id])}</span>`).join('');
 if(previousMarkup===markup+legend)return;previousMarkup=markup+legend;
 document.getElementById('depth-spectrum')!.innerHTML=markup;
 document.getElementById('depth-material-legend')!.innerHTML=legend;
}
