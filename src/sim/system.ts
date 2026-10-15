import {EXPEDITIONS,type Progress} from './progress';
import {CpuSolver,COMMAND_STRIDE,PRODUCTS,emptyStock,isProduct,type Material,type Snapshot,type Stock,type Solver} from './model';
import {validSnapshot,upgradeSnapshot} from './storage';
import {localSun,orbitalPeriod} from './orbit';
import type {SphereGrid} from './sphere';
import {physicsSteps} from './clock';
import type {TelemetryArchive} from './telemetryPersistence';

export const PLANET_LIMIT=4;
export interface PlanetRecord {id:string;name:string;snapshot:Snapshot;}
export type GameMode='campaign'|'sandbox';
export interface ModeWorld {progress?:Progress;activeId:string;planets:PlanetRecord[];stock:Stock;telemetry?:TelemetryArchive;}
export interface SystemSave extends ModeWorld {version:1|2|3;mode?:GameMode;other?:ModeWorld;savedAt:number;}

function validModeWorld(s:ModeWorld,count:number,legacyStock=false,allowEmpty=false){
 if(!Array.isArray(s.planets)||(!allowEmpty&&!s.planets.length)||s.planets.length>PLANET_LIMIT)return false;
 if(!s.stock||PRODUCTS.some(id=>!Number.isFinite((s.stock[id]??(legacyStock&&!['ice','ceramic','glass'].includes(id)?0:NaN)))||(s.stock[id]??0)<0))return false;
 if(s.progress&&(!Array.isArray(s.progress.completed)||s.progress.completed.some(id=>!EXPEDITIONS.some(m=>m.id===id))||new Set(s.progress.completed).size!==s.progress.completed.length||!Number.isFinite(s.progress.meteorCount)||s.progress.meteorCount<0))return false;
 const ids=new Set<string>();
 for(const planet of s.planets){
  if(!planet||typeof planet.id!=='string'||!/^planet-[\w-]+$/.test(planet.id)||ids.has(planet.id))return false;
  if(typeof planet.name!=='string'||!planet.name.trim()||planet.name.length>28||!validSnapshot(planet.snapshot,count))return false;
  ids.add(planet.id);
 }
 return s.planets.length?ids.has(s.activeId):allowEmpty&&s.activeId==='';
}
export function validSystem(value:unknown,count:number):value is SystemSave {
 if(!value||typeof value!=='object')return false;
 const s=value as SystemSave;
 if(![1,2,3].includes(s.version)||!Number.isFinite(s.savedAt)||s.savedAt<0)return false;
 if(s.version===3){if(!['campaign','sandbox'].includes(s.mode??'')||!validModeWorld(s,count,false,true))return false;return s.other===undefined||s.other.telemetry?.baseSavedAt===undefined&&validModeWorld(s.other,count,false,true);}
 return s.mode===undefined&&s.other===undefined&&validModeWorld(s,count,s.version===1);
}

/** Validate before persistence and write canonical, nonnegative phase stocks.
 * Upgrade operates on copies, so saving never mutates the running solver. */
export function prepareSystemSave(system:SystemSave,count:number):SystemSave {
 if(!validSystem(system,count))throw new Error('계산 상태가 저장 형식과 맞지 않습니다.');
 const upgrade=(world:ModeWorld)=>({...world,planets:world.planets.map(p=>({...p,snapshot:upgradeSnapshot(p.snapshot,count)}))});
 return {...system,...upgrade(system),other:system.other?upgrade(system.other):undefined};
}

/** Keep both modes in one local/cloud save while only one is active. */
export function switchSystemMode(system:SystemSave,target:GameMode,savedAt:number):SystemSave {
 const current=system.mode??'campaign';if(current===target)return system;
 const stock=emptyStock();if(target==='campaign')stock.plant=8;
 const other=system.other??{activeId:'',planets:[],stock};
 const active:ModeWorld={activeId:system.activeId,planets:system.planets,stock:system.stock,progress:system.progress,telemetry:system.telemetry};
 return {version:3,mode:target,...other,other:active,savedAt};
}
export function materialSupply(mode:GameMode,kind:Material,stock:Stock,requested:number){
 if(mode==='campaign'&&isProduct(kind))return {amount:Math.min(stock[kind],requested),fromStock:true};
 return {amount:requested,fromStock:false};
}

export function migrateWorld(snapshot:Snapshot,count:number):SystemSave {
 return {version:1,activeId:'planet-1',planets:[{id:'planet-1',name:'행성 01',snapshot:upgradeSnapshot(snapshot,count)}],stock:emptyStock(),savedAt:snapshot.savedAt??0};
}

export function advanceOrbit(snapshot:Pick<Snapshot,'time'|'environment'|'spin'>,dt:number) {
 const e=snapshot.environment,spin=snapshot.spin;
 e.orbitAngle=((e.orbitAngle??0)+dt*Math.PI*2/orbitalPeriod(e.orbitDistance??1,e.body))%(Math.PI*2);
 if(spin?.locked){spin.angle=e.orbitAngle;spin.period=orbitalPeriod(e.orbitDistance??1,e.body);spin.tilt=0;spin.running=true;}
 else if(spin?.running)spin.angle=(spin.angle+dt*Math.PI*2/(spin.period??120))%(Math.PI*2);
 e.sun=localSun(spin?.angle??0,spin?.tilt??0,e.orbitAngle);
 e.rotationRate=spin?.running?Math.PI*2/(spin.period??120):0;
 snapshot.time+=dt;
}

/** A published planet is immutable in its matter/climate buffers. Ordinary save
 * arrays are materialized once, lazily, instead of on every background step. */
function snapshotMetadata(s:Snapshot):Omit<Snapshot,'state'|'climate'>{return Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(s)).filter(([k])=>k!=='state'&&k!=='climate').map(([k])=>[k,s[k as keyof Snapshot]])) as Omit<Snapshot,'state'|'climate'>;}
function publishSnapshot(previous:Snapshot,next:Pick<Snapshot,'time'|'environment'|'spin'>,solver:Solver):Snapshot {
 const state=solver.state.slice(),climate=solver.climate.deferredSnapshot();let numbers:number[]|undefined;
 const snapshot={...snapshotMetadata(previous),...next,escaped:(previous.escaped??0)+solver.escapeCells.reduce((sum,v)=>sum+v,0)} as Snapshot;
 Object.defineProperties(snapshot,{state:{enumerable:true,get:()=>numbers??=Array.from(state)},climate:{enumerable:true,get:climate}});return snapshot;
}

/** Inactive worlds retain every shared integration step. Only publication is
 * deferred; camera position and active status never select different physics. */
export class BackgroundWorlds {
 private solvers=new Map<string,CpuSolver>();private asyncSolvers=new Map<string,Solver>();private empty:Float32Array;
 constructor(private grid:SphereGrid,private createAsyncSolver?:(state:Float32Array)=>Promise<Solver>){this.empty=new Float32Array(grid.count*COMMAND_STRIDE);}
 invalidate(id:string){this.solvers.get(id)?.dispose();this.solvers.delete(id);this.asyncSolvers.get(id)?.dispose();this.asyncSolvers.delete(id);}
 /** Offline callers retain the existing mutable record/reference contract. */
 step(planets:PlanetRecord[],activeId:string,dt:number,onStep?:(planet:PlanetRecord,solver:CpuSolver,dt:number)=>void){
  for(const planet of planets){
   const s=planet.snapshot;if(planet.id===activeId||s.paused)continue;
   let solver=this.solvers.get(planet.id);
   if(!solver){solver=new CpuSolver(this.grid,new Float32Array(s.state));solver.climate.restore(s.climate);this.solvers.set(planet.id,solver);}
   for(const step of physicsSteps(dt)){advanceOrbit(s,step);solver.advance(step,this.empty,s.environment);s.escaped=(s.escaped??0)+solver.escapeCells.reduce((sum,v)=>sum+v,0);onStep?.(planet,solver,step);}
   s.state=Array.from(solver.state);s.climate=solver.climate.snapshot();
  }
 }
 private async advancePlanet(planet:PlanetRecord,dt:number,onStep?:((planet:PlanetRecord,solver:Solver,dt:number)=>void),onFailure?:((planet:PlanetRecord,error:unknown)=>void)){
  let solver=this.asyncSolvers.get(planet.id);
  if(!solver){solver=await this.createAsyncSolver!(new Float32Array(planet.snapshot.state));solver.climate.restore(planet.snapshot.climate);this.asyncSolvers.set(planet.id,solver);}
  for(const step of physicsSteps(dt)){
   const s=planet.snapshot,next={time:s.time,environment:{...s.environment},spin:s.spin?{...s.spin}:undefined};advanceOrbit(next,step);
   try{try{await solver.step(step,this.empty,next.environment);}catch(error){
    console.warn('Background planet compute stopped.',error);const state=solver.state.slice(),climate=solver.climate.checkpoint(),lift=solver.climate.lift.slice();solver.dispose();
    solver=await this.createAsyncSolver!(state);solver.climate.restoreCheckpoint(climate);solver.climate.lift.set(lift);this.asyncSolvers.set(planet.id,solver);await solver.step(step,this.empty,next.environment);
   }}catch(error){if(!onFailure)throw error;s.paused=true;this.invalidate(planet.id);onFailure(planet,error);break;}
   planet.snapshot=publishSnapshot(s,next,solver);onStep?.(planet,solver,step);
  }
 }
 /** Up to two independent background workers run together. All jobs settle
  * before returning, even if one fails, so switching/saving sees a complete batch. */
 async stepAsync(planets:PlanetRecord[],activeId:string,dt:number,onStep?:(planet:PlanetRecord,solver:Solver,dt:number)=>void,onFailure?:(planet:PlanetRecord,error:unknown)=>void){
  if(!this.createAsyncSolver){this.step(planets,activeId,dt,onStep);return;}
  const worlds=planets.filter(p=>p.id!==activeId&&!p.snapshot.paused);let cursor=0;
  const run=async()=>{let failure:unknown;while(cursor<worlds.length){const planet=worlds[cursor++];try{await this.advancePlanet(planet,dt,onStep,onFailure);}catch(error){failure??=error;}}if(failure)throw failure;};
  const results=await Promise.allSettled(Array.from({length:Math.min(2,worlds.length)},run));const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
 }
}
