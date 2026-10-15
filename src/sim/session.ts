import {WeatherClimate,type ClimateSnapshot} from './weatherClimate';
import type {Environment} from './model';
import {isDeepAtmosphere} from './planetDefinition';
import {AIR_LAYERS} from './layeredAtmosphere';
import {COMMAND_STRIDE,COMMAND_FIELD,F,MASS_FIELDS,SURFACE_ERASE,SURFACE_ERASE_FIELDS,STRIDE,applyCommand,emptyStock,type Material} from './model';

export interface FallingDeposit {index:number;material:Material;amount:number;}

/** Save a complete material budget without snapping or stopping visible falling grains. */
export function snapshotSurface(live:Float32Array,pending:Float32Array,falling:FallingDeposit[],inFlight?:Float32Array|null,climate?:WeatherClimate,environment?:Environment):{state:Float32Array;pendingRemoved:number;collected:ReturnType<typeof emptyStock>;climate?:ClimateSnapshot} {
  if((!climate||climate.air.ready||climate.giant.ready)&&!falling.length&&!pending.some(v=>v!==0)&&(!inFlight||!inFlight.some(v=>v!==0)))return {state:live.slice(),pendingRemoved:0,collected:emptyStock(),climate:climate?.snapshot()};
  const prior=inFlight?snapshotSurface(live,inFlight,[],null,climate,environment):null;
  const state=prior?.state??new Float32Array(live),count=live.length/STRIDE;
  const shadow=climate&&environment?new WeatherClimate(climate.grid):undefined;
  if(shadow){shadow.restore(prior?.climate??climate!.snapshot());shadow.prepareSurface(state,environment!);}
  const energy=new Float32Array(count*4);
  if(shadow&&isDeepAtmosphere(environment?.body)){if(falling.length)throw new Error('가스형 행성에는 낙하 재료를 저장할 수 없습니다.');shadow.stepGiant(state,0,pending,environment!,energy);return {state,pendingRemoved:0,collected:emptyStock(),climate:shadow.snapshot()};}
  let pendingRemoved=prior?.pendingRemoved??0;
  const collected=prior?.collected??emptyStock();
  for(let i=0;i<count;i++) {
    const c=i*COMMAND_STRIDE,fraction=Math.max(0,Math.min(1,pending[c+5]));
    if(fraction) {
      const fields=pending[c+SURFACE_ERASE]>0?SURFACE_ERASE_FIELDS:MASS_FIELDS;
      let mass=Object.entries(COMMAND_FIELD).reduce((sum,[material,f])=>sum+(fields.includes(F[material as Material])?pending[c+f]:0),0);
      for(const f of fields)mass+=state[i*STRIDE+f];
      if(shadow&&pending[c+SURFACE_ERASE]===0)for(let k=0;k<AIR_LAYERS;k++)mass+=shadow.air.layerMass(i*AIR_LAYERS+k);
      pendingRemoved+=mass*fraction;
    }
    applyCommand(state,i,pending,collected);
  }
  if(shadow)shadow.surfaceSupplies(state,pending,COMMAND_STRIDE,energy);
  const landing=new Float32Array(pending.length);
  for(const grain of falling)landing[grain.index*COMMAND_STRIDE+COMMAND_FIELD[grain.material]]+=grain.amount;
  for(let i=0;i<count;i++)applyCommand(state,i,landing);
  if(shadow){shadow.surfaceSupplies(state,landing,COMMAND_STRIDE,energy);shadow.air.attach(state);}
  return {state,pendingRemoved,collected,climate:shadow?.snapshot()};
}
