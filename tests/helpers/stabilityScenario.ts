import {CpuSolver,F,STRIDE,type Environment,type Snapshot} from '../../src/sim/model';
import {AIR_LAYERS,AIR_SPECIES} from '../../src/sim/layeredAtmosphere';
import {sandboxDefinition} from '../../src/sim/planetDefinition';
import type {SphereGrid} from '../../src/sim/sphere';
import {coldMethaneScenario} from './coldMethaneScenario';
import {airInventory} from './airInventory';

export type StabilityKind='simple-water'|'layered-water'|'cold-methane'|'simple-fire'|'layered-fire';
export const STABILITY_KINDS:StabilityKind[]=['simple-water','layered-water','cold-methane','simple-fire','layered-fire'];

/** Input data only: every evolution path below is the production CpuSolver. */
export function stabilityScenario(grid:SphereGrid,kind:StabilityKind){
 if(kind==='cold-methane')return coldMethaneScenario(grid);
 const layered=kind.startsWith('layered'),fire=kind.endsWith('fire');
 const environment:Environment={ambient:fire?22:5,sunlight:fire?0:.7,sun:[1,0,0],gravity:1,climate:layered,body:sandboxDefinition('rock',1)};
 const state=new Float32Array(grid.count*STRIDE);
 for(let i=0;i<grid.count;i++){
  const p=i*STRIDE,x=grid.directions[i*3];
  state[p+F.rock]=8-grid.geometry[i*4+3];state[p+F.nitrogen]=.3;
  state[p+F.temperature]=fire?800:2+8*x;
  if(fire){state[p+F.soil]=.5;state[p+F.methane]=.03;state[p+F.oxygen]=.07;}
  else {state[p+F.water]=.5+.1*x;state[p+F.ice]=.1;state[p+F.dissolved]=.015;state[p+F.vapor]=.002;state[p+F.cloud]=.0005;}
 }
 const solver=new CpuSolver(grid,state);
 if(layered){
  solver.climate.prepareSurface(solver.state,environment);
  const air=solver.climate.air;
  for(let i=0;i<grid.count;i++)for(let k=0;k<AIR_LAYERS;k++){
   const q=i*AIR_LAYERS+k,x=grid.directions[i*3];
   air.temperature[q]=fire?800-20*k:2+8*x-5*k;
   if(!fire){air.mass[q*AIR_SPECIES]=.0005*Math.exp(-.2*k);air.mass[q*AIR_SPECIES+4]=.0002;}
  }
  air.attach(solver.state);
 }
 return {state:solver.state.slice(),environment,climate:layered?solver.climate.snapshot():undefined};
}

export function stabilityInventory(s:CpuSolver){
 return airInventory(s);
}

export function stabilitySnapshot(s:CpuSolver,environment:Environment,time:number):Snapshot{
 return {version:11,preset:'coast',time,state:[...s.state],climate:s.climate.snapshot(),environment:structuredClone(environment),planet:{primary:'rock'},supplied:0,removed:0,discoveries:[]};
}
