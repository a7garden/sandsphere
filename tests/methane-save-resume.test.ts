/** Local opt-in audit of an existing save. No writes to the source or browser.
 * METHANE_SAVE_PATH=/path/to/snapshot.json METHANE_STEPS=600 npx vitest run
 * tests/methane-save-resume.test.ts --maxWorkers=1 --disableConsoleIntercept */
import {it,expect} from 'vitest';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import process from 'node:process';
import {createSphere} from '../src/sim/sphere';
import {CpuSolver,COMMAND_STRIDE,STRIDE,totalEnthalpy,type Snapshot} from '../src/sim/model';
import {upgradeSnapshot,validSnapshot} from '../src/sim/storage';
import {advanceOrbit} from '../src/sim/system';
import {GASES} from '../src/sim/gases';
import {elementalMass,ATOMIC_MASS,type Element} from '../src/sim/chemistry';
import {airInventory} from './helpers/airInventory';
const path=process.env.METHANE_SAVE_PATH;
it.skipIf(!path)('continues a saved cold methane world with a closed ledger and exact restart',()=>{
 const bytes=readFileSync(path!),raw=JSON.parse(bytes.toString()) as Snapshot,count=raw.state.length/STRIDE;
 let level=0;while(10*4**level+2<count)level++;const grid=createSphere(level);expect(grid.count).toBe(count);expect(validSnapshot(raw,count)).toBe(true);
 const snapshot=upgradeSnapshot(raw,count);expect(JSON.stringify(raw)).toBe(bytes.toString());let solver=new CpuSolver(grid,new Float32Array(snapshot.state));solver.climate.restore(snapshot.climate);
 const start=airInventory(solver),initialH=totalEnthalpy(solver.state,solver.climate),lost=new Float64Array(STRIDE),empty=new Float32Array(count*COMMAND_STRIDE),steps=Number(process.env.METHANE_STEPS??600);
 expect(Number.isInteger(steps)&&steps>=30&&steps<=100000).toBe(true);
 let external=0,correction=0,min=Infinity,max=-Infinity,restarted=false;const progress=[];
 for(let n=0;n<steps;n++){
  advanceOrbit(snapshot,1/30);solver.advance(1/30,empty,snapshot.environment);external+=solver.energyChanges.reduce((a,b)=>a+b);correction+=solver.energyChanges.filter((_,i)=>i%4===3).reduce((a,b)=>a+b);
  for(let i=0;i<count;i++)for(let k=0;k<GASES.length;k++)lost[GASES[k].field]+=solver.escapeCells[i*GASES.length+k];
  expect(solver.climate.air.temperature.every(Number.isFinite)).toBe(true);for(const t of solver.climate.air.temperature){min=Math.min(min,t);max=Math.max(max,t);}
  if(n===Math.floor(steps/2)){
   const saved={...snapshot,state:[...solver.state],climate:solver.climate.snapshot()},loaded=JSON.parse(JSON.stringify(saved));expect(validSnapshot(loaded,count)).toBe(true);
   const restored=new CpuSolver(grid,new Float32Array(loaded.state));restored.climate.restore(loaded.climate);
   expect(restored.state).toEqual(solver.state);expect(restored.climate.snapshot()).toEqual(solver.climate.snapshot());
   // Continue both copies for a real step before selecting the restored one.
   const env=structuredClone(snapshot.environment);restored.advance(1/30,empty,env);
   const checkpoint=solver.climate.checkpoint(),state=solver.state.slice();solver.advance(1/30,empty,env);
   expect(restored.state).toEqual(solver.state);expect(restored.climate.snapshot()).toEqual(solver.climate.snapshot());
   restored.replace(state);restored.climate.restoreCheckpoint(checkpoint);solver=restored;restarted=true;
  }
  if(n%100===0||n===steps-1){
   const current=airInventory(solver),elements=elementalMass(start);for(let f=0;f<STRIDE;f++)current[f]+=lost[f];const after=elementalMass(current),massResidual=current.reduce((a,b)=>a+b)-start.reduce((a,b)=>a+b),energyResidual=totalEnthalpy(solver.state,solver.climate)-initialH-external,elementResidual=Math.max(...(Object.keys(ATOMIC_MASS) as Element[]).map(k=>Math.abs(after[k]-elements[k])/Math.max(1,elements[k])));
   expect(Math.abs(massResidual)/Math.max(1,start.reduce((a,b)=>a+b))).toBeLessThan(2e-6);expect(elementResidual).toBeLessThan(2e-6);expect(Math.abs(energyResidual)/Math.max(1,Math.abs(initialH))).toBeLessThan(1e-9);expect(Math.abs(correction)/Math.max(1,Math.abs(initialH))).toBeLessThan(1e-5);
   const row={step:n+1,min,max,massResidual,energyResidual,elementResidual,correction};progress.push(row);console.log(row);
   mkdirSync('artifacts/methane-resume',{recursive:true});writeFileSync('artifacts/methane-resume/progress.json',JSON.stringify({count,steps,initialH,initialMass:start.reduce((a,b)=>a+b),progress},null,2));
  }
 }
 expect(min).toBeLessThan(-150);expect(restarted).toBe(true);expect(readFileSync(path!)).toEqual(bytes);expect(validSnapshot({...snapshot,state:[...solver.state],climate:solver.climate.snapshot()},count)).toBe(true);
 writeFileSync('artifacts/methane-resume/report.json',JSON.stringify({passed:true,sourceSha256:createHash('sha256').update(bytes).digest('hex'),count,steps,physicalSeconds:steps*2,restarted,initialH,initialMass:start.reduce((a,b)=>a+b),progress},null,2));
},1800000);
