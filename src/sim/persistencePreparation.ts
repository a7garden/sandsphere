import {WeatherClimate,type ClimateCheckpoint} from './weatherClimate';
import type {SphereGrid} from './sphere';
import {emptyStock,PRODUCTS,totalEnthalpy,type Snapshot} from './model';
import type {PhysicalState} from './physicalState';
import {snapshotSurface,type FallingDeposit} from './session';
import {prepareSystemSave,type SystemSave} from './system';
import {TelemetryStore,type PlanetTelemetry} from './telemetry';
import {archiveTelemetry} from './telemetryPersistence';
import {encodeSaveBytes} from './saveCodec';
import {climateSnapshotFromCheckpoint} from './climateSnapshot';
export type SnapshotMetadata=Omit<Snapshot,'state'|'climate'>;
export interface CapturePlanet {id:string;name:string;metadata:SnapshotMetadata;state:Float32Array|number[];climate:ClimateCheckpoint|Snapshot['climate'];typed:boolean;}
export interface PersistenceCapture {
 grid:SphereGrid;system:Omit<SystemSave,'planets'|'other'>;planets:CapturePlanet[];
 active:{state:Float32Array;climate:ClimateCheckpoint;pending:PhysicalState;falling:FallingDeposit[];inFlight?:PhysicalState|null;metadata:SnapshotMetadata};
 telemetry:Map<string,PlanetTelemetry>;other?:SystemSave['other'];otherRevision:number;
}
/** Runs in the persistence worker. No live solver or recorder is mutated. */
export async function preparePersistenceCapture(input:PersistenceCapture,other?:SystemSave['other']){
 const climate=new WeatherClimate(input.grid);climate.restoreCheckpoint(input.active.climate);
 const active=input.active,transfer=snapshotSurface(active.state,active.pending,active.falling,active.inFlight,climate,active.metadata.environment);
 const activeSnapshot:Snapshot={...active.metadata,state:Array.from(transfer.state),climate:transfer.climate??climate.snapshot(),removed:active.metadata.removed+transfer.pendingRemoved,transferredOut:(active.metadata.transferredOut??0)+Object.values(transfer.collected).reduce((sum,value)=>sum+value,0)};
 const planets=input.planets.map(p=>({id:p.id,name:p.name,snapshot:p.id===input.system.activeId?activeSnapshot:{...p.metadata,state:Array.from(p.state),climate:p.typed?climateSnapshotFromCheckpoint(p.climate as ClimateCheckpoint):p.climate as Snapshot['climate']}}));
 const stock=emptyStock();for(const id of PRODUCTS)stock[id]=input.system.stock[id]+transfer.collected[id];
 const system=prepareSystemSave({...input.system,planets,stock,other},input.grid.count),store=new TelemetryStore();
 for(const [id,record] of input.telemetry)store.planets.set(id,record);
 system.telemetry=archiveTelemetry(store,system.planets.map(p=>{const s=p.snapshot,state=new Float32Array(s.state);return {id:p.id,name:p.name,input:{...s,directions:input.grid.directions,state,escaped:s.escaped??0,transferredIn:s.transferredIn??0,transferredOut:s.transferredOut??0},settledEnergy:p.id===system.activeId?totalEnthalpy(state,s.climate)-totalEnthalpy(active.state,climate):0};}));
 return {savedAt:system.savedAt,activeSavedAt:activeSnapshot.savedAt!,bytes:await encodeSaveBytes(system)};
}
