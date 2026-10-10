import {it,expect} from 'vitest';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,MASS_FIELDS,seedWorld,totalMass} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';

it('converges when the common step is halved in a mixed wet/cloud transport experiment',()=>{
 const grid=createSphere(1),initial=seedWorld(grid),empty=new Float32Array(grid.count*COMMAND_STRIDE),e={ambient:18,sunlight:1,sun:[1,0,0],gravity:1,rotationRate:.05};
 for(let i=0;i<grid.count;i++){const p=i*STRIDE;initial[p+F.cloud]=i%3===0?.8:.1;initial[p+F.water]+=i%5===0?5:0;initial[p+F.dissolved]=initial[p+F.water]*.02;}
 const run=(dt:number)=>{const solver=new CpuSolver(grid,initial.slice());for(let n=0;n<Math.round(2/dt);n++)solver.advance(dt,empty,e);return solver.state;};
 const coarse=run(1/30),fine=run(1/60),reference=run(1/120);
 const error=(s:Float32Array)=>{let mass=0,temperature=0;for(let i=0;i<grid.count;i++){for(const f of MASS_FIELDS)mass+=Math.abs(s[i*STRIDE+f]-reference[i*STRIDE+f]);temperature+=Math.abs(s[i*STRIDE+F.temperature]-reference[i*STRIDE+F.temperature]);}return {massRelative:mass/totalMass(initial),temperatureMean:temperature/grid.count};};
 const coarseError=error(coarse),fineError=error(fine);
 expect(fineError.massRelative).toBeLessThan(coarseError.massRelative);expect(fineError.temperatureMean).toBeLessThan(coarseError.temperatureMean);
 expect(coarseError.massRelative).toBeLessThan(.005);expect(coarseError.temperatureMean).toBeLessThan(.1);
 console.info('step convergence',JSON.stringify({duration:2,referenceDt:1/120,coarseDt:1/30,fineDt:1/60,coarseError,fineError}));
});
