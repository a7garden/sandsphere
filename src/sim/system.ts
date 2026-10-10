import {EXPEDITIONS,type Progress} from './progress';
import {CpuSolver,COMMAND_STRIDE,PRODUCTS,emptyStock,type Snapshot,type Stock} from './model';
import {validSnapshot,upgradeSnapshot} from './storage';
import {localSun,orbitalPeriod} from './orbit';
import type {SphereGrid} from './sphere';
import {physicsSteps} from './clock';
import type {TelemetryArchive} from './telemetryPersistence';

export const PLANET_LIMIT=4;
export interface PlanetRecord {id:string;name:string;snapshot:Snapshot;}
export interface SystemSave {version:1|2;progress?:Progress;activeId:string;planets:PlanetRecord[];stock:Stock;savedAt:number;telemetry?:TelemetryArchive;}

export function validSystem(value:unknown,count:number):value is SystemSave {
 if(!value||typeof value!=='object')return false;
 const s=value as SystemSave;
 if(![1,2].includes(s.version)||!Number.isFinite(s.savedAt)||s.savedAt<0||!Array.isArray(s.planets)||!s.planets.length||s.planets.length>PLANET_LIMIT)return false;
 if(!s.stock||PRODUCTS.some(id=>!Number.isFinite((s.stock[id]??(s.version===1&&!['ice','ceramic','glass'].includes(id)?0:NaN)))||(s.stock[id]??0)<0))return false;
 if(s.progress&&(!Array.isArray(s.progress.completed)||s.progress.completed.some(id=>!EXPEDITIONS.some(m=>m.id===id))||new Set(s.progress.completed).size!==s.progress.completed.length||!Number.isFinite(s.progress.meteorCount)||s.progress.meteorCount<0))return false;
 const ids=new Set<string>();
 for(const planet of s.planets){
  if(!planet||typeof planet.id!=='string'||!/^planet-[\w-]+$/.test(planet.id)||ids.has(planet.id))return false;
  if(typeof planet.name!=='string'||!planet.name.trim()||planet.name.length>28||!validSnapshot(planet.snapshot,count))return false;
  ids.add(planet.id);
 }
 return ids.has(s.activeId);
}

/** Validate before persistence and write canonical, nonnegative phase stocks.
 * Upgrade operates on copies, so saving never mutates the running solver. */
export function prepareSystemSave(system:SystemSave,count:number):SystemSave {
 if(!validSystem(system,count))throw new Error('계산 상태가 저장 형식과 맞지 않습니다.');
 return {...system,planets:system.planets.map(p=>({...p,snapshot:upgradeSnapshot(p.snapshot,count)}))};
}

export function migrateWorld(snapshot:Snapshot,count:number):SystemSave {
 return {version:1,activeId:'planet-1',planets:[{id:'planet-1',name:'행성 01',snapshot:upgradeSnapshot(snapshot,count)}],stock:emptyStock(),savedAt:snapshot.savedAt??0};
}

export function advanceOrbit(snapshot:Snapshot,dt:number) {
 const e=snapshot.environment,spin=snapshot.spin;
 e.orbitAngle=((e.orbitAngle??0)+dt*Math.PI*2/orbitalPeriod(e.orbitDistance??1))%(Math.PI*2);
 if(spin?.locked){spin.angle=e.orbitAngle;spin.period=orbitalPeriod(e.orbitDistance??1);spin.tilt=0;spin.running=true;}
 else if(spin?.running)spin.angle=(spin.angle+dt*Math.PI*2/(spin.period??120))%(Math.PI*2);
 e.sun=localSun(spin?.angle??0,spin?.tilt??0,e.orbitAngle);
 e.rotationRate=spin?.running?Math.PI*2/(spin.period??120):0;
 snapshot.time+=dt;
}

/** Inactive worlds batch the same small integration steps as active worlds. No invented
 * production rates or wall-clock catch-up are applied while the app is closed. */
export class BackgroundWorlds {
 private solvers=new Map<string,CpuSolver>();
 private empty:Float32Array;
 constructor(private grid:SphereGrid){this.empty=new Float32Array(grid.count*COMMAND_STRIDE);}
 invalidate(id:string){this.solvers.delete(id);}
 step(planets:PlanetRecord[],activeId:string,dt:number,onStep?:(planet:PlanetRecord,solver:CpuSolver,dt:number)=>void){
  for(const planet of planets){
   const s=planet.snapshot;if(planet.id===activeId||s.paused)continue;
   let solver=this.solvers.get(planet.id);
   if(!solver){solver=new CpuSolver(this.grid,new Float32Array(s.state));solver.climate.restore(s.climate);this.solvers.set(planet.id,solver);}
   for(const step of physicsSteps(dt)){advanceOrbit(s,step);solver.advance(step,this.empty,s.environment);s.escaped=(s.escaped??0)+solver.escapeCells.reduce((sum,v)=>sum+v,0);onStep?.(planet,solver,step);}
   s.state=Array.from(solver.state);s.climate=solver.climate.snapshot();
  }
 }
}
