import type {ClimateCheckpoint,ClimateSnapshot} from './weatherClimate';
import type {LayeredSnapshot} from './layeredAtmosphere';
import type {DeepSnapshot} from './deepAtmosphere';
import type {OceanSnapshot} from './oceanDynamics';

/** Convert a committed typed checkpoint only at a public snapshot boundary.
 * Rollback-only fields stay internal; persisted fields match climate.snapshot(). */
export function climateSnapshotFromCheckpoint(c:ClimateCheckpoint):ClimateSnapshot {
 const arrays=(value:object)=>Object.fromEntries(Object.entries(value).map(([key,v])=>[key,ArrayBuffer.isView(v)?Array.from(v as Float64Array):v]));
 const ocean={version:3,...arrays(c.ocean)} as OceanSnapshot;
 let body:Partial<ClimateSnapshot>;
 if(c.giant)body={version:3,giant:{...arrays(c.giant)} as DeepSnapshot};
 else if(c.air.initialized){
  // Snapshot property order is part of the existing JSON restart contract.
  // Rollback checkpoints place radiationCache before gravity; public snapshots
  // place it after gravity, so do not inherit checkpoint enumeration order here.
  const {initialized:_initialized,detached:_detached,roundoff:_roundoff,gravity,radiationCache,radiusMeters,minTemperature,radiationModel,...columns}=c.air;
  body={version:7,surfaceMassCarry:Array.from(c.surfaceMassCarry),atmosphere:{version:9,...arrays(columns),gravity,radiationCache:Array.from(radiationCache),radiusMeters,minTemperature,radiationModel} as LayeredSnapshot,ocean};
 }else body={version:6,surfaceMassCarry:Array.from(c.surfaceMassCarry),surfaceHeatCarry:Array.from(c.air.surfaceHeatCarry),ocean};
 return {...body,wind:Array.from(c.wind),currents:Array.from(c.currents),seeds:Array.from(c.seeds)} as ClimateSnapshot;
}
