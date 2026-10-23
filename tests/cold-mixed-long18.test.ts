// Opt in: AUDIT_COLD_MIXED18=1 npx vitest run tests/cold-mixed-long18.test.ts --maxWorkers=1 --disableConsoleIntercept
import {describe,it,expect} from 'vitest';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,MASS_FIELDS,totalMass,totalEnthalpy,totals,type Environment,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {ATOMIC_MASS,elementalMass,type Element} from '../src/sim/chemistry';
import {GASES} from '../src/sim/gases';
import {validSnapshot} from '../src/sim/storage';

describe.skipIf(process.env.AUDIT_COLD_MIXED18!=='1')('alpha18 long cold mixed-material stability',()=>{
 it('runs 3000 steps and exactly matches five JSON save/resumes with closed budgets',()=>{
  const grid=createSphere(0),empty=new Float32Array(grid.count*COMMAND_STRIDE),state=new Float32Array(grid.count*STRIDE);
  const environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true,body:sandboxDefinition('rock')};
  // Exact layered -273.139°C mixed fixture from audit-surface18.test.ts.
  for(let i=0;i<grid.count;i++){
   const p=i*STRIDE;state[p+F.temperature]=-273.139;state[p+F.rock]=8-grid.geometry[i*4+3];state[p+F.nitrogen]=.3;
   state[p+F.water]=i===0?10:.12;state[p+F.ice]=i===1?10:0;state[p+F.sand]=i===2?40:.1;state[p+F.clay]=i===3?5:0;
   state[p+F.salt]=i===4?1:0;state[p+F.soil]=.2;state[p+F.plant]=.1;state[p+F.herbivore]=i===5?.1:0;
   state[p+F.carnivore]=i===6?.1:0;state[p+F.charcoal]=i===7?1:0;state[p+F.oxygen]=.1;state[p+F.methane]=.01;
  }
  const continuous=new CpuSolver(grid,state);let resumed=new CpuSolver(grid,state);
  const mass0=totalMass(state),energy0=totalEnthalpy(state),atoms0=elementalMass(totals(state));
  const ledger=()=>({boundary:0,numerical:0,numericalAbs:0,lost:new Float64Array(STRIDE)}),continuousLedger=ledger(),resumedLedger=ledger();
  const record=(solver:CpuSolver,account:ReturnType<typeof ledger>)=>{
   for(let k=0;k<solver.energyChanges.length;k++)if(k%4===3){account.numerical+=solver.energyChanges[k];account.numericalAbs+=Math.abs(solver.energyChanges[k]);}else account.boundary+=solver.energyChanges[k];
   for(let i=0;i<grid.count;i++)for(let k=0;k<GASES.length;k++)account.lost[GASES[k].field]+=solver.escapeCells[i*GASES.length+k];
  };
  const snapshot=(solver:CpuSolver,steps:number):Snapshot=>({version:11,preset:'coast',time:steps/30,state:[...solver.state],climate:solver.climate.snapshot(),environment,supplied:0,removed:0,discoveries:[]});
  const budget=(solver:CpuSolver,account:ReturnType<typeof ledger>)=>{
   const stock=totals(solver.state,solver.climate);for(let f=0;f<STRIDE;f++)stock[f]+=account.lost[f];const atoms=elementalMass(stock);
   return {massResidual:MASS_FIELDS.reduce((h,f)=>h+stock[f],0)-mass0,energyResidual:totalEnthalpy(solver.state,solver.climate)-energy0-account.boundary-account.numerical,
    atomRelative:Math.max(...Object.keys(ATOMIC_MASS).map(e=>Math.abs(atoms[e as Element]-atoms0[e as Element])/Math.max(1,atoms0[e as Element]))),
    boundary:account.boundary,numerical:account.numerical,numericalAbs:account.numericalAbs,
    minSurfaceTemperature:Math.min(...solver.state.filter((_,i)=>i%STRIDE===F.temperature)),maxSurfaceTemperature:Math.max(...solver.state.filter((_,i)=>i%STRIDE===F.temperature)),
    minAirTemperature:Math.min(...solver.climate.air.temperature),maxAirTemperature:Math.max(...solver.climate.air.temperature),geometryScale:solver.climate.air.geometryScale};
  };
  const files=['src/sim/model.ts','src/sim/layeredAtmosphere.ts','src/sim/mechanicalBoundary.ts','src/sim/weatherClimate.ts','src/sim/oceanDynamics.ts','src/sim/thermodynamics.ts','src/sim/storage.ts','src/sim/spectralRadiation.ts','src/sim/phaseEquilibrium.ts'];
  const hashes=()=>Object.fromEntries(files.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])),sourceHashes=hashes(),started=performance.now();
  const checkpoints:unknown[]=[],resumes:number[]=[];let completedSteps=0,error='';
  const receipt=()=>({status:error?'failed':completedSteps===3000?'passed':'running',scenario:'Exact audit-surface18 mixed layered -273.139 C fixture',cells:grid.count,steps:completedSteps,targetSteps:3000,dt:1/30,simulatedGameSeconds:completedSteps/30,simulatedPhysicalSeconds:completedSteps*2,elapsedSeconds:(performance.now()-started)/1000,sourceHashes,finalSourceHashes:hashes(),resumes,checkpoints,continuous:budget(continuous,continuousLedger),resumed:budget(resumed,resumedLedger),error});
  const writeReceipt=()=>{mkdirSync('artifacts/audit-alpha18',{recursive:true});writeFileSync('artifacts/audit-alpha18/cold-mixed-long18.json',JSON.stringify(receipt(),null,2)+'\n');};
  try{
   expect(validSnapshot(snapshot(continuous,0),grid.count)).toBe(true);
   for(let n=1;n<=3000;n++){
    continuous.advance(1/30,empty,environment);record(continuous,continuousLedger);resumed.advance(1/30,empty,environment);record(resumed,resumedLedger);completedSteps=n;
    if(n%100===0){
     const a=budget(continuous,continuousLedger),b=budget(resumed,resumedLedger);
     expect(validSnapshot(snapshot(continuous,n),grid.count)).toBe(true);expect(validSnapshot(snapshot(resumed,n),grid.count)).toBe(true);
     for(const report of [a,b]){expect(Math.abs(report.massResidual)).toBeLessThan(1e-7);expect(Math.abs(report.energyResidual)).toBeLessThan(1e-6);expect(report.atomRelative).toBeLessThan(1e-9);expect(report.numericalAbs).toBeLessThan(1e-6);}
     expect(resumed.state).toEqual(continuous.state);expect(resumed.climate.snapshot()).toEqual(continuous.climate.snapshot());expect(resumedLedger).toEqual(continuousLedger);
     checkpoints.push({steps:n,continuous:a,resumed:b,valid:true,exactResume:true});writeReceipt();
    }
    if(n%500===0&&n<3000){
     const saved:Snapshot=JSON.parse(JSON.stringify(snapshot(resumed,n)));expect(validSnapshot(saved,grid.count)).toBe(true);
     const next=new CpuSolver(grid,new Float32Array(saved.state));next.climate.restore(saved.climate);expect(next.state).toEqual(resumed.state);expect(next.climate.snapshot()).toEqual(resumed.climate.snapshot());resumed=next;resumes.push(n);
     console.log('cold mixed long checkpoint',JSON.stringify({steps:n,resumes:resumes.length,...budget(continuous,continuousLedger)}));
    }
   }
   expect(resumes).toEqual([500,1000,1500,2000,2500]);expect(hashes()).toEqual(sourceHashes);
  }catch(cause){error=cause instanceof Error?cause.stack??cause.message:String(cause);throw cause;}finally{writeReceipt();writeFileSync('artifacts/audit-alpha18/cold-mixed-long18-last-committed.json',JSON.stringify(snapshot(continuous,completedSteps))+'\n');console.log('cold mixed long result',JSON.stringify({steps:completedSteps,resumes,error,elapsedSeconds:(performance.now()-started)/1000,...budget(continuous,continuousLedger)}));}
 },600000);
});
