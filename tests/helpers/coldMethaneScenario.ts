import {CpuSolver,F,STRIDE,type Environment} from '../../src/sim/model';
import {AIR_LAYERS,AIR_SPECIES} from '../../src/sim/layeredAtmosphere';
import {sandboxDefinition} from '../../src/sim/planetDefinition';
import type {SphereGrid} from '../../src/sim/sphere';
/** A cold, methane-rich moving atmosphere. No named-world physics or injected
 * heat: a pressure gradient accelerates the existing tangent wind. */
export function coldMethaneScenario(grid:SphereGrid){
 const environment:Environment={ambient:18,sunlight:0,sun:[1,0,0],gravity:1,climate:true,body:sandboxDefinition('rock',1)},state=new Float32Array(grid.count*STRIDE);
 for(let i=0;i<grid.count;i++){state[i*STRIDE+F.temperature]=18;state[i*STRIDE+F.nitrogen]=.3;}
 const solver=new CpuSolver(grid,state),a=solver.climate.air;solver.climate.prepareSurface(solver.state,environment);a.mass.fill(0);
 for(let i=0;i<grid.count;i++)for(let k=0;k<AIR_LAYERS;k++){
  const q=i*AIR_LAYERS+k,[x,y,z]=grid.directions.subarray(i*3,i*3+3),scale=(1+.5*x)*Math.exp(-k*.3);
  a.mass[q*AIR_SPECIES+2]=.069*scale;a.mass[q*AIR_SPECIES+3]=.003*scale;a.mass[q*AIR_SPECIES+5]=.00045*scale;
  a.temperature[q]=-149.99;a.velocity.set([-600*(1-x*x),600*x*y,600*x*z],q*3);
 }
 a.attach(solver.state);return {state:solver.state.slice(),environment,climate:solver.climate.snapshot()};
}
