import {CpuSolver,F,STRIDE,type Environment} from '../../src/sim/model';
import {sandboxDefinition} from '../../src/sim/planetDefinition';
import type {SphereGrid} from '../../src/sim/sphere';
/** Extreme but finite initial stocks, no ongoing temperature prescription. */
export function surfaceThermalScenario(grid:SphereGrid,temperature:number,layered:boolean){
 const environment:Environment={ambient:temperature<0?-100:100,sunlight:0,sun:[1,0,0],gravity:1,climate:layered,body:sandboxDefinition('rock')};
 const state=new Float32Array(grid.count*STRIDE);
 for(let i=0;i<grid.count;i++){const p=i*STRIDE;state[p+F.temperature]=18;state[p+F.rock]=8;state[p+F.nitrogen]=.3;state[p+(temperature<0?F.ice:F.sand)]=.02;}
 const solver=new CpuSolver(grid,state);
 if(layered){solver.climate.prepareSurface(solver.state,environment);solver.climate.air.temperature.fill(temperature);solver.climate.air.attach(solver.state);}
 for(let i=0;i<grid.count;i++)solver.state[i*STRIDE+F.temperature]=temperature;
 return {state:solver.state.slice(),environment,climate:layered?solver.climate.snapshot():undefined};
}
