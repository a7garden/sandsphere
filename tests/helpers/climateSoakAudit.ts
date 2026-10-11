import {expect} from 'vitest';
import {writeFileSync,mkdirSync} from 'node:fs';
import process from 'node:process';
import {soakWorld,soakStep,soakMeasure,soakSnapshot,type SoakKind} from './climateSoak';
import {CpuSolver} from '../../src/sim/model';
import {validSnapshot,upgradeSnapshot} from '../../src/sim/storage';
import {advanceOrbit} from '../../src/sim/system';
import {PHYSICS_DT} from '../../src/sim/clock';

export function auditSoak(kind:SoakKind,level:number,seconds:number){
 const directory=process.env.SANDSPHERE_SOAK_OUTPUT??'artifacts/climate-soak',w=soakWorld(level,kind),samples=[soakMeasure(w)],start=performance.now();mkdirSync(directory,{recursive:true});
 const steps=Math.round(seconds/PHYSICS_DT);
 for(let k=1;k<=steps;k++){soakStep(w);if(k%1800===0){const sample=soakMeasure(w);samples.push(sample);if(!sample.finite||sample.minMass<-.000001)break;}if(k===Math.round(steps/2))writeFileSync(`${directory}/${kind}-${level}-mid.snapshot.json`,JSON.stringify(soakSnapshot(w)));}
 const saved=JSON.parse(JSON.stringify(soakSnapshot(w)));writeFileSync(`${directory}/${kind}-${level}-end.snapshot.json`,JSON.stringify(saved));
 const first=new CpuSolver(w.grid,w.solver.state.slice()),loaded=upgradeSnapshot(saved,w.grid.count),second=new CpuSolver(w.grid,new Float32Array(loaded.state));first.climate.restore(w.solver.climate.snapshot());second.climate.restore(loaded.climate);
 for(let k=0;k<900;k++){advanceOrbit(loaded,PHYSICS_DT);first.advance(PHYSICS_DT,w.empty,loaded.environment);second.advance(PHYSICS_DT,w.empty,loaded.environment);}
 const resume={valid:validSnapshot(saved,w.grid.count),stateExact:first.state.every((v,i)=>v===second.state[i]),climateExact:JSON.stringify(first.climate.snapshot())===JSON.stringify(second.climate.snapshot()),continuedSeconds:30};
 const result={kind,level,seconds,wallSeconds:(performance.now()-start)/1000,resume,samples};writeFileSync(`${directory}/${kind}-${level}.json`,JSON.stringify(result,null,2));
 const last=samples.at(-1)!;
 expect(last.time).toBeCloseTo(seconds,4);expect(resume).toMatchObject({valid:true,stateExact:true,climateExact:true});
 for(const sample of samples){expect(sample.finite).toBe(true);expect(sample.minMass).toBeGreaterThanOrEqual(-1e-6);expect(sample.maxWind).toBeLessThanOrEqual(.120001);expect(sample.maxCurrent).toBeLessThanOrEqual(.035001);expect(sample.massRelative).toBeLessThan(5e-4);expect(sample.energyRelative).toBeLessThan(1e-3);expect(sample.minT).toBeGreaterThanOrEqual(-100.01);expect(sample.maxT).toBeLessThanOrEqual(2500.01);}
 if(kind==='dry'||kind==='symmetric'){expect(last.stocks.water+last.stocks.ice+last.stocks.vapor+last.stocks.cloud+last.stocks.cloudIce+last.stocks.plant).toBe(0);}
 if(kind==='symmetric'){expect(last.maxT-last.minT).toBeLessThan(1e-5);expect(last.maxWind).toBe(0);expect(last.maxCurrent).toBe(0);}
 return result;
}
