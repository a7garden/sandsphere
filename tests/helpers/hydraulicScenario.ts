import {CpuSolver,F,STRIDE,type Environment} from '../../src/sim/model';
import {sandboxDefinition} from '../../src/sim/planetDefinition';
import type {SphereGrid} from '../../src/sim/sphere';
/** No prescribed wind: only a liquid mound and an optional solid barrier. */
export function hydraulicScenario(grid:SphereGrid,barrier=false){
 const state=new Float32Array(grid.count*STRIDE),environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,rotationRate:0,climate:true,body:sandboxDefinition('rock')};
 for(let i=0;i<grid.count;i++){const p=i*STRIDE;state[p+F.rock]=8-grid.geometry[i*4+3];state[p+F.water]=i===0?5:0;state[p+F.dissolved]=i===0?.1:0;state[p+F.temperature]=20;state[p+F.nitrogen]=.3;}
 if(barrier)state[grid.neighbors[0]*STRIDE+F.rock]+=12;
 const s=new CpuSolver(grid,state);s.climate.prepareSurface(state,environment);s.climate.air.attach(state);s.climate.ocean.reconcile(state,new Float32Array(grid.count*4));
 return {state,environment,climate:s.climate.snapshot()};
}
