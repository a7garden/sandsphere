// @vitest-environment happy-dom
import {beforeEach,afterEach,describe,expect,it} from 'vitest';
import {Inventory,inventoryMarkup} from '../src/ui/inventory';
import {expeditionMarkup,updateExpeditions,updateWeatherReadout} from '../src/ui/observatory';
import {systemDialog,renderSystemUi,updateSystemUi} from '../src/ui/system';
import {MATERIALS} from '../src/ui/content';
import {MATERIAL_SOURCES,formatSupplyMass} from '../src/ui/materialSupply';
import {CpuSolver,emptyStock,F,STRIDE,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {freshProgress,EXPEDITIONS,observeCampaignPlanets} from '../src/sim/progress';
import {setupLocalization} from '../src/ui/i18n';
import {orbitalEnvironment} from '../src/sim/orbit';
let dispose:(()=>void)|undefined;
beforeEach(()=>{localStorage.clear();document.body.innerHTML=`<main id="app"><select id="settings-language"><option value="ko">한국어</option><option value="en">English</option></select><button id="inventory-open"></button><button id="quick-edit"></button><button id="quick-add"></button><div id="selected-material-label"></div><div class="material-list"></div>${inventoryMarkup()}${expeditionMarkup()}</main>`;localStorage.setItem('sandsphere-language','ko');dispose=setupLocalization();});
afterEach(()=>{dispose?.();dispose=undefined;document.body.replaceChildren();});
describe('campaign inventory and instructions',()=>{
 it('shows all 16 materials before discovery, with readable acquisition rules for empty stock',()=>{
  const inventory=new Inventory(()=>{},emptyStock(),()=>{});inventory.update(emptyStock(),new Set(),'campaign');inventory.open();
  expect(document.querySelectorAll('[data-select-material]')).toHaveLength(16);
  expect((document.querySelector('[data-select-material="glass"]') as HTMLButtonElement).disabled).toBe(true);
  expect(document.querySelector('[data-select-material="glass"]')!.parentElement!.textContent).toContain('1,700°C');
  const query=document.getElementById('catalog-search') as HTMLInputElement;query.value='850';query.dispatchEvent(new Event('input'));
  expect(document.querySelectorAll('[data-select-material]')).toHaveLength(2);
 });
 it('refreshes world stock and restock eligibility without replacing a focused catalog button',()=>{
  const stock=emptyStock();stock.plant=8;const progress=freshProgress(),snapshot:Snapshot={version:3,preset:'coast',time:0,state:Array(STRIDE).fill(0),discoveries:[],supplied:0,removed:0,environment:orbitalEnvironment(1)},planets=[{id:'planet-1',name:'Test',snapshot}];
  const inventory=new Inventory(()=>{},stock,()=>{});inventory.update(stock,new Set(),'campaign',progress,planets);inventory.open();
  const pin=document.querySelector('[data-pin="glass"]') as HTMLButtonElement;pin.focus();
  snapshot.state[F.glass]=2;stock.plant=0;inventory.refreshCampaign(progress,planets);
  expect(document.activeElement).toBe(pin);
  expect(document.querySelector('[data-catalog-world="glass"]')!.textContent).toContain('2.0 kg');
  expect((document.getElementById('sample-resupply') as HTMLButtonElement).disabled).toBe(false);
  progress.completed.push('garden');inventory.refreshCampaign(progress,planets);
  expect(document.getElementById('sample-status')!.textContent).toContain('초식 생물 · 재보급 4.0 kg · 재보급 가능');
 });
 it('makes every material available in sandbox and hides finite sample recovery',()=>{
  const inventory=new Inventory(()=>{},emptyStock(),()=>{});inventory.update(emptyStock(),new Set(),'sandbox');inventory.open();
  expect(document.querySelectorAll('[data-select-material]:disabled')).toHaveLength(0);
  expect(document.getElementById('sample-recovery')!.hidden).toBe(true);
  expect(document.getElementById('catalog-guide')!.textContent).toContain('모든 재료를 무제한');
 });
 it('shows committed active inventory in the catalog and system while its saved snapshot remains old',()=>{
  const grid=createSphere(0),solver=new CpuSolver(grid,new Float32Array(grid.count*STRIDE)),stock=emptyStock(),progress=freshProgress(),snapshot:Snapshot={version:11,preset:'coast',time:0,state:[...solver.state],climate:solver.climate.snapshot(),discoveries:[],supplied:0,removed:0,environment:orbitalEnvironment(1)},planets=[{id:'planet-1',name:'Test',snapshot}];
  const actual=new Float64Array(solver.state);actual[F.glass]=2.25;for(let p=F.temperature;p<actual.length;p+=STRIDE)actual[p]=17;solver.state=solver.climate.publishSurface(actual);
  const observed=observeCampaignPlanets(planets,'planet-1',solver,0),inventory=new Inventory(()=>{},stock,()=>{});inventory.update(stock,new Set(),'campaign',progress,observed);inventory.open();
  expect(document.querySelector('[data-catalog-world="glass"]')!.textContent).toContain('2.3 kg');
  document.getElementById('app')!.insertAdjacentHTML('beforeend',systemDialog());renderSystemUi(planets,'planet-1',stock);updateSystemUi(planets,stock,'campaign',observed);
  expect(document.querySelector('[data-planet-summary]')!.textContent).toContain('17°C');expect(document.querySelector('[data-planet-production]')!.textContent).toContain('2.3 kg');expect(snapshot.state[F.glass]).toBe(0);
 });
 it('reads weather stock from canonical layers even when the surface cloud mirror is stale',()=>{
  const grid=createSphere(0),solver=new CpuSolver(grid,new Float32Array(grid.count*STRIDE));for(let i=0;i<grid.count;i++){solver.state[i*STRIDE+F.temperature]=20;solver.state[i*STRIDE+F.nitrogen]=.3;}
  solver.climate.prepareSurface(solver.state,{...orbitalEnvironment(1),climate:true});solver.climate.air.mass.fill(0);solver.climate.air.mass[4]=2.25;
  document.getElementById('app')!.insertAdjacentHTML('beforeend',['weather-state','weather-timing','weather-cloud-stock','weather-condensation','weather-rain','weather-snow'].map(id=>`<output id="${id}"></output>`).join(''));
  expect(solver.state[F.cloud]).toBe(0);expect(updateWeatherReadout(solver.state,grid.count,null,false,false,solver.climate)).toBe(2.25);expect(document.getElementById('weather-cloud-stock')!.textContent).toBe('2.25 kg');expect(document.getElementById('weather-state')!.textContent).toContain('1/'+grid.count);
 });
 it('translates recipes, chapter names, metrics and new hints in English',()=>{
  dispose?.();localStorage.setItem('sandsphere-language','en');dispose=setupLocalization();
  const inventory=new Inventory(()=>{},emptyStock(),()=>{});inventory.update(emptyStock(),new Set(),'campaign');inventory.open();updateExpeditions(freshProgress());
  expect(/[가-힣]/.test(document.getElementById('catalog-list')!.textContent!)).toBe(false);
  expect(document.getElementById('next-expedition-chapter')!.textContent).toBe('1 · Material experiments');
  expect(document.getElementById('next-expedition-hint')!.textContent).toContain('clouds');
  expect(document.getElementById('next-expedition-metrics')!.textContent).toContain('Water vapor');
  for(const m of MATERIALS)expect(MATERIAL_SOURCES[m.id]).toBeTruthy();
 });
 it('keeps tiny usable inventory amounts visible and handles all completed missions',()=>{
  expect(formatSupplyMass(.005)).toBe('0.005 kg');expect(formatSupplyMass(.0001)).toBe('<0.001 kg');
  updateExpeditions({completed:EXPEDITIONS.map(m=>m.id),meteorCount:1});
  expect(document.getElementById('next-expedition')!.textContent).toBe('모든 탐사 완료');
  expect(document.getElementById('next-expedition-metrics')!.children).toHaveLength(0);
 });
});
