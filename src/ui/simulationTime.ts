/** One stored simulation second represents one minute on the planet clock. */
import {currentLocale} from './i18n';

export const PLANET_SECONDS_PER_SIMULATION_SECOND=60;
/** 1× targets one planet minute per real second; other values are multiples of it. */
export const SIMULATION_SPEEDS=[1/60,1/6,1,2,10,60] as const;
export type SimulationSpeed=typeof SIMULATION_SPEEDS[number];

export function speedLabel(speed:SimulationSpeed) {
 if(speed===1/60)return '1/60×';
 if(speed===1/6)return '1/6×';
 return `${speed}×`;
}

export function formatRealDuration(realSeconds:number) {
 const whole=Math.max(0,Math.round(realSeconds));
 if(currentLocale()==='en'){
  if(whole<60)return `${whole} sec`;
  if(whole<3600)return `${Math.floor(whole/60)} min${whole%60?` ${whole%60} sec`:''}`;
  return `${Math.floor(whole/3600)} hr${whole%3600>=60?` ${Math.floor(whole%3600/60)} min`:''}`;
 }
 if(whole<60)return `${whole}초`;
 if(whole<3600)return `${Math.floor(whole/60)}분${whole%60?` ${whole%60}초`:''}`;
 return `${Math.floor(whole/3600)}시간${whole%3600>=60?` ${Math.floor(whole%3600/60)}분`:''}`;
}

export function realDurationForPlanetPeriod(planetMinutes:number,speed:SimulationSpeed|number) {
 return formatRealDuration(planetMinutes/speed);
}

export function formatPlanetElapsed(simulationSeconds:number) {
 const whole=Math.max(0,Math.round(simulationSeconds*PLANET_SECONDS_PER_SIMULATION_SECOND));
 const hours=Math.floor(whole/3600),minutes=Math.floor(whole/60)%60,remaining=whole%60;
 return `${hours}:${String(minutes).padStart(2,'0')}:${String(remaining).padStart(2,'0')}`;
}

export function formatPlanetDuration(simulationSeconds:number) {
 const minutes=Math.round(simulationSeconds);
 if(currentLocale()==='en')return minutes<60?`${minutes} planet min`:`${Math.floor(minutes/60)} planet hr${minutes%60?` ${minutes%60} min`:''}`;
 return minutes<60?`${minutes}분`:`${Math.floor(minutes/60)}시간${minutes%60?` ${minutes%60}분`:''}`;
}

export function formatPlanetRate(simulationSecondsPerRealSecond:number) {
 // The numeric value is unchanged: one simulation second is one planet minute.
 if(simulationSecondsPerRealSecond<1){const seconds=simulationSecondsPerRealSecond*60;return currentLocale()==='en'?`${seconds<10?seconds.toFixed(1):seconds.toFixed(0)} planet sec/s`:`${seconds<10?seconds.toFixed(1):seconds.toFixed(0)}초/초`;}
 if(simulationSecondsPerRealSecond<60)return currentLocale()==='en'?`${simulationSecondsPerRealSecond.toFixed(simulationSecondsPerRealSecond<10?1:0)} planet min/s`:`${simulationSecondsPerRealSecond.toFixed(simulationSecondsPerRealSecond<10?1:0)}분/초`;
 return currentLocale()==='en'?`${(simulationSecondsPerRealSecond/60).toFixed(1)} planet hr/s`:`${(simulationSecondsPerRealSecond/60).toFixed(1)}시간/초`;
}

/** Reports completed simulation time, including slow solvers and frame stalls. */
export class ActualGameRate {
 private startReal:number|null=null;
 private startGame=0;
 private planet='';
 private last:number|null=null;
 reset(){this.startReal=null;this.last=null;}
 sample(realMilliseconds:number,gameSeconds:number,planet:string,running:boolean,windowSeconds=3) {
  if(!running){this.reset();return null;}
  if(this.startReal===null||planet!==this.planet||gameSeconds<this.startGame){
   this.planet=planet;this.startReal=realMilliseconds;this.startGame=gameSeconds;this.last=null;return null;
  }
  const elapsed=(realMilliseconds-this.startReal)/1000;
  if(elapsed>=windowSeconds){this.last=Math.max(0,(gameSeconds-this.startGame)/elapsed);this.startReal=realMilliseconds;this.startGame=gameSeconds;}
  return this.last;
 }
}
