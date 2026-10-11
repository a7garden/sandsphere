import {it,expect} from 'vitest';
import process from 'node:process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {soakWorld,soakStep,soakMeasure,soakSnapshot} from './helpers/climateSoak';
import {CpuSolver} from '../src/sim/model';
import {advanceOrbit} from '../src/sim/system';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {PHYSICS_DT} from '../src/sim/clock';

it.skipIf(process.env.SANDSPHERE_LONG_AUDIT!=='1')('continues a long evolved climate identically through a serialized and upgraded snapshot',()=>{
 const w=soakWorld(2),samples=[soakMeasure(w)];mkdirSync('artifacts/climate-soak',{recursive:true});
 for(let k=1;k<=72000;k++){soakStep(w);if(k%1800===0)samples.push(soakMeasure(w));if(k===36000)writeFileSync('artifacts/climate-soak/coast-2-mid.snapshot.json',JSON.stringify(soakSnapshot(w)));}
 const saved=JSON.parse(JSON.stringify(soakSnapshot(w)));expect(validSnapshot(saved,w.grid.count)).toBe(true);
 writeFileSync('artifacts/climate-soak/coast-2-end.snapshot.json',JSON.stringify(saved));
 const migrated=upgradeSnapshot(saved,w.grid.count),resumed=new CpuSolver(w.grid,new Float32Array(migrated.state));resumed.climate.restore(migrated.climate);
 expect(resumed.state).toEqual(w.solver.state);expect(resumed.climate.snapshot()).toEqual(w.solver.climate.snapshot());
 for(let k=0;k<900;k++){soakStep(w);advanceOrbit(migrated,PHYSICS_DT);resumed.advance(PHYSICS_DT,w.empty,migrated.environment);}
 const stateExact=resumed.state.every((v,i)=>v===w.solver.state[i]),climateExact=JSON.stringify(resumed.climate.snapshot())===JSON.stringify(w.solver.climate.snapshot());
 writeFileSync('artifacts/climate-soak/resume.json',JSON.stringify({seconds:2400,continued:30,cells:w.grid.count,stateExact,climateExact,orbitExact:JSON.stringify(migrated.environment)===JSON.stringify(w.snapshot.environment),samples},null,2));
 expect(stateExact).toBe(true);expect(climateExact).toBe(true);expect(migrated.environment).toEqual(w.snapshot.environment);
},600000);
