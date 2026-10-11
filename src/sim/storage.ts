import {validClimate} from './weatherClimate';
import {AIR_FIELDS,AIR_LAYERS,LEGACY_AIR_LAYERS} from './layeredAtmosphere';
import { F,STRIDE,type Snapshot } from './model';
import { RESEARCH } from '../ui/content';
import {BASE_CAPACITY,SPECIFIC_HEAT,PHASE_ENERGY} from './thermodynamics';

/** Read only bounded legacy Float32 transfer error, never arbitrary negative stocks.
 * Old freezing computed a rounded complement for water and its dissolved salt. */
function massRoundoffLimit(state:number[],offset:number,field:number){
  if(field===F.seed)return 0;
  const waterIce=Math.max(0,(state[offset+F.water]??0)+(state[offset+F.ice]??0));
  const scale=field===F.water?waterIce:field===F.dissolved?Math.max(waterIce*.36,(state[offset+F.salt]??0)+(state[offset+F.dissolved]??0)):0;
  return Math.max(1e-7,scale*2**-23);
}
function repairLegacyRoundoff(state:number[]){
  for(let p=0;p<state.length;p+=STRIDE){
    if(!state.slice(p,p+STRIDE).some((v,f)=>f!==F.temperature&&v<0))continue;
    const heat=()=>{let c=BASE_CAPACITY,phase=0;for(let f=0;f<STRIDE;f++){c+=state[p+f]*(SPECIFIC_HEAT[f]??0);phase+=state[p+f]*(PHASE_ENERGY[f]??0);}return {c,phase};};
    const before=heat(),h=before.c*state[p+F.temperature]+before.phase;
    for(let f=0;f<STRIDE;f++)if(f!==F.temperature&&state[p+f]<0){
      const negative=state[p+f];
      if(negative< -massRoundoffLimit(state,p,f))throw new Error('저장된 물질량이 반올림 오차 범위를 벗어났습니다.');
      // Preserve the known water/ice and dissolved/crystalline salt pair totals.
      if(f===F.water)state[p+F.ice]=Math.max(0,state[p+F.ice]+negative);
      if(f===F.dissolved)state[p+F.salt]=Math.max(0,state[p+F.salt]+negative);
      state[p+f]=0;
    }
    const after=heat();state[p+F.temperature]=Math.max(-100,Math.min(2500,Math.fround((h-after.phase)/after.c)));
  }
  return state;
}

function openDatabase():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('sandsphere',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('snapshots');
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    req.onblocked=()=>reject(new Error('다른 창에서 저장소를 사용 중입니다.'));
  });
}
export async function saveSnapshot(snapshot:unknown,slot='latest',companion?:{slot:string;value:unknown}) {
  const db=await openDatabase();
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('snapshots','readwrite');
      if(companion)tx.objectStore('snapshots').put(companion.value,companion.slot);
      tx.objectStore('snapshots').put(snapshot,slot);
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }finally{db.close();}
}
export async function loadRecord(slot:string):Promise<unknown> {
  const db=await openDatabase();
  try{return await new Promise<unknown>((resolve,reject)=>{
    const tx=db.transaction('snapshots','readonly'),req=tx.objectStore('snapshots').get(slot);
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });}finally{db.close();}
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
  if(![1,2,3,4].includes(s.version)||!['coast','winter','kiln'].includes(s.preset))return false;
  if(s.climate!==undefined&&!validClimate(s.climate,count))return false;
  if(s.planet&&!['rock','sand','clay','water','ice'].includes(s.planet.primary))return false;
  for(const field of [s.transferredIn,s.transferredOut])if(field!==undefined&&(!Number.isFinite(field)||field<0))return false;
  if(s.escaped!==undefined&&(!Number.isFinite(s.escaped)||s.escaped<0))return false;
  if(!Array.isArray(s.state))return false;
  const savedStride=s.state.length/count;
  if(savedStride!==STRIDE && !([16,20].includes(savedStride)&&s.version<3))return false;
  if(!s.state.every((v,i)=>Number.isFinite(v) && (i%savedStride===F.temperature?v>=-100&&v<=2500:v>=-massRoundoffLimit(s.state,i-i%savedStride,i%savedStride)&&v<=100000)))return false;
  if(s.climate?.atmosphere){
    const air=s.climate.atmosphere,layers=air.version===1?LEGACY_AIR_LAYERS:AIR_LAYERS;
    for(let i=0;i<count;i++)for(let f=0;f<6;f++){
      let m=0;for(let k=0;k<layers;k++)m+=air.mass[(i*layers+k)*6+f];
      if(Math.abs(m-s.state[i*STRIDE+AIR_FIELDS[f]])>Math.max(1e-8,m*2e-7))return false;
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
    ||(s.spin.period!==undefined&&(!Number.isFinite(s.spin.period)||s.spin.period<20||s.spin.period>1200))))return false;
  const weather=s.weather;
  if(weather&&(!['rain','cold','warm'].includes(weather.kind)||!Number.isFinite(weather.remaining)||weather.remaining<0
    ||!Number.isFinite(weather.duration)||weather.duration<=0||weather.duration>600||weather.remaining>weather.duration
    ||!Number.isFinite(weather.ambient)||weather.ambient< -100||weather.ambient>100||!Number.isFinite(weather.sunlight)||weather.sunlight<0||weather.sunlight>2.5
    ||!Array.isArray(weather.direction)||weather.direction.length!==3||weather.direction.some(v=>!Number.isFinite(v)||Math.abs(v)>1)))return false;
  const e=s.environment;
  return !!e&&(e.climate===undefined||typeof e.climate==='boolean')&&Number.isFinite(e.ambient)&&e.ambient>=-100&&e.ambient<=100&&Number.isFinite(e.sunlight)&&e.sunlight>=0&&e.sunlight<=2.5
    &&(e.gravity===undefined||(Number.isFinite(e.gravity)&&e.gravity>=.01&&e.gravity<=3))
    &&(e.orbitAngle===undefined||(Number.isFinite(e.orbitAngle)&&e.orbitAngle>=0&&e.orbitAngle<Math.PI*2+.001))
    &&(e.rotationRate===undefined||(Number.isFinite(e.rotationRate)&&Math.abs(e.rotationRate)<=Math.PI/10+.001))
    &&(e.orbitDistance===undefined||(Number.isFinite(e.orbitDistance)&&e.orbitDistance>=.65&&e.orbitDistance<=2.4))
    &&Array.isArray(e.sun)&&e.sun.length===3&&e.sun.every(v=>Number.isFinite(v)&&Math.abs(v)<=1);
}

/** Extend legacy 16-field cells without altering their material stocks or temperatures. */
export function upgradeSnapshot(snapshot:Snapshot,count:number):Snapshot {
  const oldStride=snapshot.state.length/count;
  if(oldStride===STRIDE)return {...snapshot,version:snapshot.climate||snapshot.version===4?4:3,state:repairLegacyRoundoff([...snapshot.state])};
  const state=new Float32Array(count*STRIDE);
  for(let i=0;i<count;i++)state.set(snapshot.state.slice(i*oldStride,(i+1)*oldStride),i*STRIDE);
  return {...snapshot,version:snapshot.climate||snapshot.version===4?4:3,state:repairLegacyRoundoff([...state])};
}
