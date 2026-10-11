import {RANGE_THUMB_SIZE} from './rangeControl';
import {formatPlanetDuration} from './simulationTime';
import {currentLocale} from './i18n';

/** The range uses whole planet minutes; lock to the exact orbital period at its marker. */
export function spinPeriodSelection(value:number,orbitalSeconds:number,snapSeconds=0){
 const locked=Math.abs(value-Math.round(orbitalSeconds))<=snapSeconds;
 return {locked,period:locked?orbitalSeconds:value};
}

export function validSpinSpeed(value:number){return Number.isFinite(value)&&(value===0||value>=.3&&value<=18);}

export function updateSyncPeriodMarker(orbitalSeconds:number,locked:boolean,spinning=true){
 const range=document.getElementById('spin-period') as HTMLInputElement;
 const marker=document.getElementById('sync-period-marker')!;
 const position=(Math.round(orbitalSeconds)-Number(range.min))/(Number(range.max)-Number(range.min));
 const duration=formatPlanetDuration(orbitalSeconds);
 if(marker.dataset.period!==String(orbitalSeconds)){
  marker.dataset.period=String(orbitalSeconds);
  marker.style.left=`calc(${position*100}% + ${RANGE_THUMB_SIZE/2-position*RANGE_THUMB_SIZE}px)`;
  document.getElementById('sync-period-value')!.textContent=duration;
 }
 if(marker.dataset.active!==String(locked)){
  marker.dataset.active=String(locked);
  document.getElementById('spin-period-status')!.hidden=!locked;
 }
 const valueText=spinning?formatPlanetDuration(Number(range.value))+(locked?(currentLocale()==='en'?' · synchronous rotation':' · 동기 자전'):''):(currentLocale()==='en'?'Rotation speed 0 · infinite period':'자전 속도 0 · 주기 무한대');
 if(range.getAttribute('aria-valuetext')!==valueText)range.setAttribute('aria-valuetext',valueText);
}
