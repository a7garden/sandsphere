import {RANGE_THUMB_SIZE} from './rangeControl';

/** The range uses whole seconds; lock to the exact orbital period at its marker. */
export function spinPeriodSelection(value:number,orbitalSeconds:number,snapSeconds=0){
 const locked=Math.abs(value-Math.round(orbitalSeconds))<=snapSeconds;
 return {locked,period:locked?orbitalSeconds:value};
}

export function validSpinSpeed(value:number){return Number.isFinite(value)&&(value===0||value>=.3&&value<=18);}

export function updateSyncPeriodMarker(orbitalSeconds:number,locked:boolean,spinning=true){
 const range=document.getElementById('spin-period') as HTMLInputElement;
 const marker=document.getElementById('sync-period-marker')!;
 const position=(Math.round(orbitalSeconds)-Number(range.min))/(Number(range.max)-Number(range.min));
 const seconds=Number(orbitalSeconds.toFixed(1))+'초';
 if(marker.dataset.period!==seconds){
  marker.dataset.period=seconds;
  marker.style.left=`calc(${position*100}% + ${RANGE_THUMB_SIZE/2-position*RANGE_THUMB_SIZE}px)`;
  document.getElementById('sync-period-value')!.textContent=seconds;
 }
 if(marker.dataset.active!==String(locked)){
  marker.dataset.active=String(locked);
  document.getElementById('spin-period-status')!.hidden=!locked;
 }
 const valueText=spinning?Math.round(Number(range.value))+'초'+(locked?' · 동기 자전':''):'자전 속도 0 · 주기 무한대';
 if(range.getAttribute('aria-valuetext')!==valueText)range.setAttribute('aria-valuetext',valueText);
}
