import {CpuSolver,F,STRIDE,type Environment} from '../../src/sim/model';
import {AIR_LAYERS} from '../../src/sim/layeredAtmosphere';
import {sandboxDefinition} from '../../src/sim/planetDefinition';
import type {SphereGrid} from '../../src/sim/sphere';
export function oceanScenario(grid:SphereGrid){
 const state=new Float32Array(grid.count*STRIDE),environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,rotationRate:.06,climate:true,body:sandboxDefinition('rock')};
 for(let i=0;i<grid.count;i++){const p=i*STRIDE;state[p+F.rock]=8;state[p+F.water]=2;state[p+F.dissolved]=.02;state[p+F.temperature]=20;state[p+F.nitrogen]=.3;}
 const s=new CpuSolver(grid,state);s.climate.prepareSurface(state,environment);s.climate.air.attach(state);s.climate.ocean.reconcile(state,new Float32Array(grid.count*4));
 for(let i=0;i<grid.count;i++){const n=i*3,q=i*AIR_LAYERS;for(let k=0;k<3;k++)s.climate.air.velocity[q*3+k]=20*([grid.directions[n+2],0,-grid.directions[n]][k]);}
 return {state,environment,climate:s.climate.snapshot()};
}
