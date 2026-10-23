import {F,STRIDE,MASS_FIELDS,type Environment,type Solver} from '../../src/sim/model';
import {AIR_FIELDS,AIR_SPECIES,ATMOSPHERE_MIRRORS} from '../../src/sim/layeredAtmosphere';
import {sandboxDefinition} from '../../src/sim/planetDefinition';
import type {SphereGrid} from '../../src/sim/sphere';

export const LARGE_SAND=400;
export const LARGE_WATER=1000;

/** Exact original precision-gpu-diagnostic.mjs input, also run with layered air.
 * Keep these inventories independent of the smaller terrain admission fixture. */
export function largeInventoryScenario(grid:SphereGrid,layered=false){
 const state=new Float32Array(grid.count*STRIDE);
 const environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:layered,body:sandboxDefinition('rock')};
 for(let i=0;i<grid.count;i++){
  const p=i*STRIDE;
  state[p+F.rock]=8-grid.geometry[i*4+3];state[p+F.temperature]=20;state[p+F.nitrogen]=.3;
  if(i!==0)state[p+F.water]=LARGE_WATER;
 }
 state[F.sand]=LARGE_SAND;
 return {state,environment};
}

/** Independent species sum: local surface projection plus its saved remainder,
 * and authoritative Float64 air layers in place of their surface mirrors. */
export function largeInventoryStocks(s:Pick<Solver,'state'|'climate'>){
 const stock=new Float64Array(STRIDE),a=s.climate.air;
 for(let p=0;p<s.state.length;p+=STRIDE)for(const f of MASS_FIELDS)if(!a.ready||!(ATMOSPHERE_MIRRORS as readonly number[]).includes(f))stock[f]+=s.state[p+f]+a.surfaceMassCarry[p+f];
 if(a.ready)for(let q=0;q<a.temperature.length;q++){
  for(let f=0;f<AIR_SPECIES;f++)stock[AIR_FIELDS[f]]+=a.mass[q*AIR_SPECIES+f];
  stock[F.airborneDust]+=a.dustMass[q];
 }
 return stock;
}
