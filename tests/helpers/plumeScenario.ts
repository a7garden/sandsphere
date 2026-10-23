import {CpuSolver,F,STRIDE,type Environment} from '../../src/sim/model';
import {AIR_LAYERS,AIR_SPECIES} from '../../src/sim/layeredAtmosphere';
import {sandboxDefinition} from '../../src/sim/planetDefinition';
import type {SphereGrid} from '../../src/sim/sphere';
/** Controlled material placements, with zero initial winds. Vertical targets
 * start below ignition; lateral targets are preheated but lack oxygen. */
export function plumeScenario(grid:SphereGrid,layout:'vertical'|'lateral'|'separated'='vertical'){
 const lateral=layout==='lateral',body=sandboxDefinition('rock',1);if(lateral)body.radiusMeters=100000;
 const environment:Environment={ambient:22,sunlight:0,sun:[1,0,0],gravity:1,climate:true,body};
 const state=new Float32Array(grid.count*STRIDE);
 for(let i=0;i<grid.count;i++){state[i*STRIDE+F.temperature]=lateral?520:22;state[i*STRIDE+F.nitrogen]=.3;}
 const seed=new CpuSolver(grid,state),air=seed.climate.air;seed.climate.prepareSurface(seed.state,environment);
 air.mass.fill(0);air.temperature.fill(lateral?520:22);
 for(let q=0;q<air.temperature.length;q++)air.mass[q*AIR_SPECIES+1]=lateral?.1:.04;
 air.temperature[0]=lateral?800:510;air.mass[2]=lateral?.01:.02;air.mass[6]=.06;air.mass[8]=.0001;
 if(lateral)air.mass[1]=.0299;
 const target=(lateral?grid.neighbors[0]*AIR_LAYERS:0)+1;
 air.temperature[target]=lateral?520:490;air.mass[target*AIR_SPECIES+2]=.004;
 if(lateral)air.mass[target*AIR_SPECIES+1]=.096;
 if(layout==='separated'){air.mass[6]=0;air.mass[(air.temperature.length-1)*AIR_SPECIES+6]=.06;}
 air.attach(seed.state);
 return {state:seed.state.slice(),environment,climate:seed.climate.snapshot(),target};
}
