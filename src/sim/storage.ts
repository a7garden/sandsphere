import {movingMass} from './oceanDynamics';
import {validClimate} from './weatherClimate';
import {airMassWidth,AIR_FIELDS,AIR_LAYERS,LEGACY_AIR_LAYERS,ATMOSPHERE_MIRRORS} from './layeredAtmosphere';
import { F,STRIDE,MASS_FIELDS,type Snapshot } from './model';
import { RESEARCH } from '../ui/content';
import {BASE_CAPACITY,SPECIFIC_HEAT,MATERIAL_ENERGY,validThermodynamicTemperature,assertThermodynamicTemperature,validThermalRemainder} from './thermodynamics';
import {validPlanetDefinition,planetSupport,sandboxDefinition,temperatureLimits,physicalRadius,maxSpinPeriod,isDeepAtmosphere,PLANET_SPECIES,PLANET_DISTANCE_AU,PLANET_PERIOD_SECONDS,PHYSICAL_SECONDS_PER_TICK,type PlanetDefinition} from './planetDefinition';
import {DEEP_LAYERS,DEEP_FIELDS,deepMassWidth,upgradeDeepSnapshot} from './deepAtmosphere';
import {loadRecord} from './browserStorage';
import {validStateScalar,validInventoryAmount} from './physicalState';
export {saveSnapshot,loadRecord} from './browserStorage';

/** Read only bounded legacy Float32 transfer error, never arbitrary negative stocks.
 * Old freezing computed a rounded complement for water and its dissolved salt. */
function massRoundoffLimit(state:number[],offset:number,field:number){
  if(field===F.seed||field>=24)return 0;
  const waterIce=Math.max(0,(state[offset+F.water]??0)+(state[offset+F.ice]??0));
  const scale=field===F.water?waterIce:field===F.dissolved?Math.max(waterIce*.36,(state[offset+F.salt]??0)+(state[offset+F.dissolved]??0)):0;
  return Math.max(1e-7,scale*2**-23);
}
function repairLegacyRoundoff(state:number[]){
  for(let p=0;p<state.length;p+=STRIDE){
    if(!state.slice(p,p+STRIDE).some((v,f)=>f!==F.temperature&&v<0))continue;
    const heat=()=>{let c=BASE_CAPACITY,phase=0;for(let f=0;f<STRIDE;f++){c+=state[p+f]*(SPECIFIC_HEAT[f]??0);phase+=state[p+f]*(MATERIAL_ENERGY[f]??0);}return {c,phase};};
    const before=heat(),h=before.c*state[p+F.temperature]+before.phase;
    for(let f=0;f<STRIDE;f++)if(f!==F.temperature&&state[p+f]<0){
      const negative=state[p+f];
      if(negative< -massRoundoffLimit(state,p,f))throw new Error('저장된 물질량이 반올림 오차 범위를 벗어났습니다.');
      // Preserve the known water/ice and dissolved/crystalline salt pair totals.
      if(f===F.water)state[p+F.ice]=Math.max(0,state[p+F.ice]+negative);
      if(f===F.dissolved)state[p+F.salt]=Math.max(0,state[p+F.salt]+negative);
      state[p+f]=0;
    }
    const after=heat();state[p+F.temperature]=Math.fround((h-after.phase)/after.c);assertThermodynamicTemperature(state[p+F.temperature]);
  }
  return state;
}

export async function loadSnapshot(count:number,slot='latest'):Promise<Snapshot|null> {
  const value=await loadRecord(slot);
  if(value===undefined)return null;
  if(!validSnapshot(value,count))throw new Error('저장된 행성 형식이 현재 버전과 맞지 않습니다.');
  return upgradeSnapshot(value,count);
}
export function validSnapshot(value:unknown,count:number):value is Snapshot {
  if(!value||typeof value!=='object')return false;
  const s=value as Snapshot;
  if(![1,2,3,4,5,6,7,8,9,10,11].includes(s.version)||!['coast','winter','kiln'].includes(s.preset))return false;
  const body=s.environment?.body;
  if(s.version>=5&&!body||body&&(!validPlanetDefinition(body)||!planetSupport(body,s.climate?.giant?{existingHeight:s.climate.giant.height}:undefined).supported))return false;
  if(body&&((body.lowerBoundary.kind==='solid-surface'&&body.lowerBoundary.primary!==(s.planet?.primary??'rock'))||Math.abs((s.environment.gravity??1)-body.surfaceGravity/9.81)>1e-9||Math.abs((s.environment.orbitDistance??1)-body.orbit.distanceAu)>1e-9))return false;
  if(s.climate!==undefined&&!validClimate(s.climate,count))return false;
  if(s.planet&&!['rock','sand','clay','water','ice'].includes(s.planet.primary))return false;
  for(const field of [s.transferredIn,s.transferredOut])if(field!==undefined&&(!Number.isFinite(field)||field<0))return false;
  if(s.escaped!==undefined&&(!Number.isFinite(s.escaped)||s.escaped<0))return false;
  if(!Array.isArray(s.state))return false;
  const savedStride=s.state.length/count;
  if(savedStride!==STRIDE && !(savedStride===36&&s.version<=10) && !(savedStride===32&&s.version<=7) && !(savedStride===28&&s.version<=6) && !(savedStride===24&&s.version<=5) && !([16,20].includes(savedStride)&&s.version<3))return false;
  if(!s.state.every((v,i)=>validStateScalar(v) && (i%savedStride===F.temperature?validThermodynamicTemperature(v):v>=-massRoundoffLimit(s.state,i-i%savedStride,i%savedStride))))return false;
  if(s.state.some((v,i)=>(i%savedStride>=37||s.version<11&&i%savedStride===36)&&v!==0))return false;
  if(savedStride>=28&&s.state.some((v,i)=>((s.version<10&&[34,35].includes(i%savedStride)||s.version<9&&[27,33].includes(i%savedStride))||s.version<=7&&[30,31,32].includes(i%savedStride))&&v!==0))return false;
  const physical=s.state.slice(),massCarry=s.climate?.surfaceMassCarry;
  if(massCarry){
    if(savedStride!==STRIDE)return false;
    for(let i=0;i<physical.length;i++){
      physical[i]+=massCarry[i];
      if(!validStateScalar(physical[i])||MASS_FIELDS.includes(i%STRIDE)&&!validInventoryAmount(physical[i])||massCarry[i]!==0&&Math.fround(physical[i])!==s.state[i])return false;
    }
  }
  const retained=s.climate?.atmosphere?.surfaceHeatCarry??s.climate?.surfaceHeatCarry;
  if(retained)for(let i=0;i<count;i++){
    let c=BASE_CAPACITY,phase=s.state[i*savedStride+F.photonEnergy]??0;
    for(let f=0;f<savedStride;f++)if(!s.climate?.atmosphere||!(ATMOSPHERE_MIRRORS as readonly number[]).includes(f)){c+=physical[i*savedStride+f]*(SPECIFIC_HEAT[f]??0);phase+=physical[i*savedStride+f]*(MATERIAL_ENERGY[f]??0);}
    if(!validThermalRemainder(s.state[i*savedStride+F.temperature],c,phase,retained[i]))return false;
  }
  if(s.climate?.ocean?.potentialReady&&Math.abs(s.climate.ocean.gravity!-9.81*(s.environment.gravity??1))>1e-9)return false;
  if(s.climate?.ocean?.ready){
    if(savedStride!==STRIDE)return false;
    for(let i=0;i<count;i++){const expected=movingMass(physical,i);if(Math.abs(s.climate.ocean.mass[i]-expected)>Math.max(1e-10,expected*1e-9))return false;}
  }
  if(isDeepAtmosphere(body)){
    const deep=s.climate?.giant,boundary=body!.lowerBoundary;
    if(!deep||!(s.version===7&&savedStride===32&&deep.version===1||s.version>=8&&(savedStride===STRIDE||s.version<=10&&savedStride===36)&&deep.version===2)||s.planet!==undefined||s.environment.climate!==true||boundary.kind!=='deep-atmosphere'||deep.radiusMeters!==body!.radiusMeters||Math.abs(deep.gravity-body!.surfaceGravity/9.81)>1e-9||deep.referencePressure!==body!.atmosphere.pressurePa||deep.initialBottomPressure!==boundary.pressurePa||deep.intrinsicFlux!==boundary.intrinsicFlux)return false;
    const width=deepMassWidth(deep),fields=DEEP_FIELDS.slice(0,width);
    for(let i=0;i<count;i++){
      for(let f=0;f<savedStride;f++)if(f!==F.temperature&&!(fields as readonly number[]).includes(f)&&s.state[i*savedStride+f]!==0)return false;
      for(let f=0;f<width;f++){let mass=0;for(let k=0;k<DEEP_LAYERS;k++)mass+=deep.mass[(i*DEEP_LAYERS+k)*width+f];if(Math.abs(mass-s.state[i*savedStride+DEEP_FIELDS[f]])>Math.max(1e-8,mass*2e-7))return false;}
      let h=0,c=0;for(let k=0;k<DEEP_LAYERS;k++){const q=i*DEEP_LAYERS+k;let capacity=0;for(let f=0;f<width;f++)capacity+=deep.mass[q*width+f]*SPECIFIC_HEAT[DEEP_FIELDS[f]];c+=capacity;h+=capacity*deep.temperature[q];}if(Math.abs(h/c-s.state[i*savedStride+F.temperature])>Math.max(1e-5,Math.abs(h/c)*2e-7))return false;
    }
  }else if(s.climate?.giant||s.state.some((v,i)=>[28,29,30,31,32].includes(i%savedStride)&&v!==0))return false;
  if(s.climate?.atmosphere){
    const air=s.climate.atmosphere;if(air.version<6&&s.state.some((v,i)=>i%savedStride===F.soot&&v!==0))return false;if(air.version<5&&s.state.some((v,i)=>i%savedStride===F.carbonMonoxide&&v!==0))return false;if(air.version<4&&s.state.some((v,i)=>i%savedStride===F.oxygen&&v!==0))return false;const layers=air.version===1?LEGACY_AIR_LAYERS:AIR_LAYERS;
    if(body&&((air.radiusMeters??1e6)!==physicalRadius(body)||(air.radiationModel??'earth-spectral')!==body.atmosphere.radiation||(air.minTemperature??-150)!==temperatureLimits(body).airMin||Math.abs(air.gravity-body.surfaceGravity/9.81)>1e-9))return false;
    for(let i=0;i<count;i++){
      let dust=0;for(let k=0;k<layers;k++)dust+=air.dustMass?.[i*layers+k]??0;
      const mirror=savedStride>26?s.state[i*savedStride+F.airborneDust]:0;
      if(Math.abs(dust-mirror)>Math.max(1e-8,dust*2e-7))return false;
    }
    for(let i=0;i<count;i++)for(let f=0;f<airMassWidth(air);f++){
      let m=0;for(let k=0;k<layers;k++)m+=air.mass[(i*layers+k)*airMassWidth(air)+f];
      const mirror=AIR_FIELDS[f]<savedStride?s.state[i*savedStride+AIR_FIELDS[f]]:0;
      if(Math.abs(m-mirror)>Math.max(1e-8,m*2e-7))return false;
    }
  }
  if(!Number.isFinite(s.time)||s.time<0||!Number.isFinite(s.supplied)||s.supplied<0||!Number.isFinite(s.removed)||s.removed<0)return false;
  if(!Array.isArray(s.discoveries)||s.discoveries.some(id=>!RESEARCH.some(r=>r.id===id)))return false;
  if(s.savedAt!==undefined&&(!Number.isFinite(s.savedAt)||s.savedAt<0))return false;
  if(s.paused!==undefined&&typeof s.paused!=='boolean')return false;
  if(s.spin&&(!Number.isFinite(s.spin.angle)||Math.abs(s.spin.angle)>Math.PI*2+.001||typeof s.spin.running!=='boolean'||(s.spin.locked!==undefined&&typeof s.spin.locked!=='boolean')
    ||(s.spin.azimuth!==undefined&&(!Number.isFinite(s.spin.azimuth)||s.spin.azimuth<0||s.spin.azimuth>360))
    ||(s.spin.elevation!==undefined&&(!Number.isFinite(s.spin.elevation)||s.spin.elevation< -30||s.spin.elevation>85))
    ||(s.spin.tilt!==undefined&&(!Number.isFinite(s.spin.tilt)||s.spin.tilt<0||s.spin.tilt>180))
    ||(s.spin.period!==undefined&&(!Number.isFinite(s.spin.period)||s.spin.period<(body?PLANET_PERIOD_SECONDS.min/PHYSICAL_SECONDS_PER_TICK:20)||s.spin.period>(body?PLANET_PERIOD_SECONDS.max/PHYSICAL_SECONDS_PER_TICK:maxSpinPeriod(body))))))return false;
  const weather=s.weather;
  if(weather&&(!['rain','cold','warm'].includes(weather.kind)||!Number.isFinite(weather.remaining)||weather.remaining<0
    ||!Number.isFinite(weather.duration)||weather.duration<=0||weather.duration>600||weather.remaining>weather.duration
    ||!Number.isFinite(weather.ambient)||weather.ambient< -100||weather.ambient>100||!Number.isFinite(weather.sunlight)||weather.sunlight<0||weather.sunlight>2.5
    ||!Array.isArray(weather.direction)||weather.direction.length!==3||weather.direction.some(v=>!Number.isFinite(v)||Math.abs(v)>1)))return false;
  const e=s.environment;
  // Body-backed inputs use the same physical domain as creation. Bodyless
  // legacy records retain their original metadata bounds; no input is clipped.
  const validAmbient=body?(isDeepAtmosphere(body)?Number.isFinite(e?.ambient)&&e.ambient>=-250&&e.ambient<=2500:validThermodynamicTemperature(e?.ambient)):Number.isFinite(e?.ambient)&&e.ambient>=temperatureLimits().surfaceMin&&e.ambient<=100;
  return !!e&&(e.climate===undefined||typeof e.climate==='boolean')&&validAmbient&&Number.isFinite(e.sunlight)&&e.sunlight>=0&&e.sunlight<=(body?1/PLANET_DISTANCE_AU.min**2:2.5)
    &&(e.gravity===undefined||(Number.isFinite(e.gravity)&&e.gravity>=.01&&e.gravity<=3))
    &&(e.orbitAngle===undefined||(Number.isFinite(e.orbitAngle)&&e.orbitAngle>=0&&e.orbitAngle<Math.PI*2+.001))
    &&(e.rotationRate===undefined||(Number.isFinite(e.rotationRate)&&Math.abs(e.rotationRate)<=(body?Math.PI*2*PHYSICAL_SECONDS_PER_TICK/PLANET_PERIOD_SECONDS.min*(1+4*Number.EPSILON):Math.PI/10+.001)))
    &&(e.orbitDistance===undefined||(Number.isFinite(e.orbitDistance)&&e.orbitDistance>=(body?PLANET_DISTANCE_AU.min:.65)&&e.orbitDistance<=(body?PLANET_DISTANCE_AU.max:2.4)))
    &&Array.isArray(e.sun)&&e.sun.length===3&&e.sun.every(v=>Number.isFinite(v)&&Math.abs(v)<=1);
}

/** Zero-extend legacy cells and deep v1 without adding physical stocks. */
export function upgradeSnapshot(snapshot:Snapshot,count:number):Snapshot {
  const oldStride=snapshot.state.length/count;
  const state=new Float32Array(count*STRIDE);
  for(let i=0;i<count;i++)state.set(snapshot.state.slice(i*oldStride,(i+1)*oldStride),i*STRIDE);
  const e=snapshot.environment,gravity=e.gravity??1,distance=e.orbitDistance??e.body?.orbit.distanceAu??Math.max(.65,Math.min(2.4,1/Math.sqrt(Math.max(.174,snapshot.weather?.sunlight??e.sunlight))));
  const body:PlanetDefinition=e.body?structuredClone(e.body):sandboxDefinition(snapshot.planet?.primary??'rock',gravity,distance);
  if(!e.body){
   body.rotation={periodSeconds:(snapshot.spin?.period??120)*60,tiltDegrees:snapshot.spin?.tilt??0};
   const fields=[['vapor',F.vapor],['nitrogen',F.nitrogen],['methane',F.methane],['carbonDioxide',F.carbonDioxide]] as const;
   const masses=fields.map(([,field])=>Array.from({length:count},(_,i)=>Math.max(0,state[i*STRIDE+field])).reduce((a,b)=>a+b,0)/count),moles=masses.map((m,k)=>m/PLANET_SPECIES[fields[k][0]].molarMass),total=moles.reduce((a,b)=>a+b,0);
   body.atmosphere.pressurePa=masses.reduce((a,b)=>a+b,0)*gravity/.3*101325;
   body.atmosphere.composition=total>0?fields.flatMap(([species],k)=>moles[k]>0?[{species,moleFraction:moles[k]/total}]:[]):[];
  }
  return {...snapshot,version:11,...(snapshot.climate?.giant?{climate:{...structuredClone(snapshot.climate),giant:upgradeDeepSnapshot(snapshot.climate.giant)}}:{}),state:repairLegacyRoundoff(oldStride===STRIDE?[...snapshot.state]:[...state]),environment:{...e,gravity,orbitDistance:distance,body,sun:[...e.sun]}};
}
