import {it,expect} from 'vitest';
import {CpuSolver,COMMAND_STRIDE} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {PHYSICS_DT} from '../src/sim/clock';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {stabilityScenario,stabilitySnapshot} from './helpers/stabilityScenario';
it('exactly resumes low-gravity layered water after 120 steps through JSON',()=>{
 const grid=createSphere(1),p=stabilityScenario(grid,'layered-water');p.environment={...p.environment,gravity:.01,sunlight:0,body:sandboxDefinition('rock',.01)};
 const solver=new CpuSolver(grid,p.state.slice());solver.climate.restore(p.climate);const empty=new Float32Array(grid.count*COMMAND_STRIDE);
 for(let n=0;n<120;n++)solver.advance(PHYSICS_DT,empty,p.environment);
 const before=stabilitySnapshot(solver,p.environment,120*PHYSICS_DT),json=JSON.parse(JSON.stringify(before));expect(validSnapshot(json,grid.count)).toBe(true);
 const saved=upgradeSnapshot(json,grid.count),resumed=new CpuSolver(grid,new Float32Array(saved.state));resumed.climate.restore(saved.climate);

 expect(resumed.climate.snapshot()).toEqual(before.climate);expect(resumed.state).toEqual(solver.state);
 for(let n=0;n<3;n++){solver.advance(PHYSICS_DT,empty,p.environment);resumed.advance(PHYSICS_DT,empty,p.environment);expect(resumed.state).toEqual(solver.state);expect(resumed.climate.snapshot()).toEqual(solver.climate.snapshot());expect(resumed.energyChanges).toEqual(solver.energyChanges);}
});
