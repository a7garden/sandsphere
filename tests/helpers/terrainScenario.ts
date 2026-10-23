import {F,STRIDE,type Environment} from '../../src/sim/model';
import {sandboxDefinition} from '../../src/sim/planetDefinition';
import type {SphereGrid} from '../../src/sim/sphere';
export const TERRAIN_MOUND=80;

/** A bare granular mound and the same mound against a water-loaded bed.
 * The shape is only initial data; production mechanics chooses each parcel. */
export function terrainScenario(grid:SphereGrid,layered:boolean,loaded=false){
 const state=new Float32Array(grid.count*STRIDE),environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:layered,body:sandboxDefinition('rock')};
 for(let i=0;i<grid.count;i++){
  const p=i*STRIDE;state[p+F.rock]=8-grid.geometry[i*4+3];state[p+F.temperature]=20;state[p+F.nitrogen]=.3;
  state[p+F.water]=loaded&&i!==0?128:0;
 }
 state[F.sand]=TERRAIN_MOUND;
 return {state,environment};
}
