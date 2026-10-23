import {describe,it,expect} from 'vitest';
import {mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CpuSolver,F,STRIDE,MASS_FIELDS,COMMAND_STRIDE,totalMass,totalEnthalpy,type Snapshot,type Environment} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {GASES} from '../src/sim/gases';
import {ATOMIC_MASS,elementalMass,type Element} from '../src/sim/chemistry';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {largeInventoryScenario,largeInventoryStocks,LARGE_SAND,LARGE_WATER} from './helpers/largeInventoryScenario';

// The absolute mass limit is the original acceptance criterion. Large inputs
// must not turn it into a looser relative tolerance.
const limits={massKg:.002,elementsRelative:2e-6,energyLedgerRelative:2e-7,numericalRelative:5e-4};
const elements=Object.keys(ATOMIC_MASS) as Element[];
const sourcePaths=[...readdirSync('src/sim').filter(p=>/\.(ts|wgsl)$/.test(p)&&p!=='browserStorage.ts').sort().map(p=>`src/sim/${p}`),'tests/large-inventory-conservation.test.ts','tests/helpers/largeInventoryScenario.ts'];
const hashes=()=>Object.fromEntries(sourcePaths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const initialHashes=hashes(),runId=new Date().toISOString().replace(/[:.]/g,'-');

function report(name:string,data:Record<string,unknown>){
 const root='artifacts/large-inventory',path=`${root}/${runId}`;mkdirSync(path,{recursive:true});
 const json=JSON.stringify({runId,limits,sourceSha256:initialHashes,sourceUnchangedDuringRun:JSON.stringify(hashes())===JSON.stringify(initialHashes),...data},null,2);
 writeFileSync(`${path}/${name}.json`,json);writeFileSync(`${root}/${name}.json`,json);
}

function run(layered:boolean,steps:number){
 const grid=createSphere(1),p=largeInventoryScenario(grid,layered),empty=new Float32Array(grid.count*COMMAND_STRIDE),heat=empty.slice();heat[4]=2;
 let solver=new CpuSolver(grid,p.state.slice()),shadow:CpuSolver|undefined,shadowEnvironment:Environment|undefined,environment=p.environment,restarts=0;
 const initial=largeInventoryStocks(solver),initialMass=totalMass(solver.state,solver.climate),initialEnergy=totalEnthalpy(solver.state,solver.climate),initialElements=elementalMass(initial),lost=new Float64Array(STRIDE),energy=[0,0,0,0],samples=[];
 let absoluteNumerical=0,absolutePhysical=0,maxPhaseChange=0,maxWaterRedistribution=0,maxDryCellWater=0,maxMassResidual=0,maxElementRelative=0,maxEnergyRelative=0;
 const snapshot=():Snapshot=>({version:11,preset:'coast',state:[...solver.state],climate:solver.climate.snapshot(),environment:structuredClone(environment),planet:{primary:'rock'},time:solverTime,supplied:0,removed:0,discoveries:[]});
 let solverTime=0;
 function account(){
  for(let k=0;k<solver.energyChanges.length;k++){
   const value=solver.energyChanges[k];energy[k%4]+=value;
   if(k%4===3)absoluteNumerical+=Math.abs(value);else absolutePhysical+=Math.abs(value);
  }
  for(let i=0;i<grid.count;i++)for(let k=0;k<GASES.length;k++)lost[GASES[k].field]+=solver.escapeCells[i*GASES.length+k];
 }
 function sample(step:number){
  const stock=largeInventoryStocks(solver),withLost=stock.map((v,f)=>v+lost[f]),mass=withLost.reduce((a,b)=>a+b,0),after=elementalMass(withLost);
  const massResidual=mass-initial.reduce((a,b)=>a+b,0),elementResiduals=Object.fromEntries(elements.map(e=>[e,after[e]-initialElements[e]]));
  const elementRelative=Math.max(...elements.map(e=>Math.abs(after[e]-initialElements[e])/Math.max(1,initialElements[e])));
  const energyResidual=totalEnthalpy(solver.state,solver.climate)-initialEnergy-energy.reduce((a,b)=>a+b,0),energyRelative=Math.abs(energyResidual)/Math.max(1,Math.abs(initialEnergy));
  const phaseChange=Math.abs(stock[F.water]-initial[F.water])+Math.abs(stock[F.ice]-initial[F.ice])+Math.abs(stock[F.vapor]-initial[F.vapor])+Math.abs(stock[F.cloud]-initial[F.cloud])+Math.abs(stock[F.cloudIce]-initial[F.cloudIce]);
  let waterRedistribution=0;for(let i=0;i<grid.count;i++)waterRedistribution+=Math.abs(solver.state[i*STRIDE+F.water]-p.state[i*STRIDE+F.water]);
  maxPhaseChange=Math.max(maxPhaseChange,phaseChange);maxWaterRedistribution=Math.max(maxWaterRedistribution,waterRedistribution);
  maxDryCellWater=Math.max(maxDryCellWater,solver.state[F.water]+solver.climate.air.surfaceMassCarry[F.water]);
  maxMassResidual=Math.max(maxMassResidual,Math.abs(massResidual));maxElementRelative=Math.max(maxElementRelative,elementRelative);maxEnergyRelative=Math.max(maxEnergyRelative,energyRelative);
  return {step,massResidual,totalMassResidual:totalMass(solver.state,solver.climate)+lost.reduce((a,b)=>a+b,0)-initialMass,elementRelative,elementResiduals,energyResidual,energyRelative,energy:[...energy],absoluteNumerical,absolutePhysical,numericalRelative:absoluteNumerical/Math.max(1,Math.abs(initialEnergy)),phaseChange,waterRedistribution,waterAtDryCell:solver.state[F.water],stocks:[...stock],restarts};
 }
 function restart(){
  const serialized=JSON.stringify(snapshot()),raw=JSON.parse(serialized);expect(validSnapshot(raw,grid.count)).toBe(true);
  const upgraded=upgradeSnapshot(raw,grid.count);expect(JSON.stringify(raw)).toBe(serialized);
  shadow=new CpuSolver(grid,new Float32Array(upgraded.state));shadow.climate.restore(upgraded.climate);
  shadowEnvironment=upgraded.environment;
  expect(shadow.state).toEqual(solver.state);expect(shadow.climate.snapshot()).toEqual(solver.climate.snapshot());
 }
 const name=`${layered?'layered':'simple'}-${steps}`;
 try{
  // Original diagnostic supplied a paused heat command, then a second at n=15.
  solver.advance(0,heat,environment);account();
  for(let n=0;n<steps;n++){
   const commands=n===15?heat:empty;
   solver.advance(1/30,commands,environment);
   if(shadow){
    shadow.advance(1/30,commands,shadowEnvironment!);
    expect(shadow.state).toEqual(solver.state);expect(shadow.climate.snapshot()).toEqual(solver.climate.snapshot());
    expect(shadow.energyChanges).toEqual(solver.energyChanges);expect(shadow.escapeCells).toEqual(solver.escapeCells);
    solver=shadow;shadow=undefined;environment=shadowEnvironment!;shadowEnvironment=undefined;restarts++;
   }
   account();solverTime+=1/30;const row=sample(n+1);
   if(n===29&&steps===60||n===59||(n+1)%1000===0||n===steps-1){
    samples.push(row);report(name,{status:'running',layered,steps,cells:grid.count,initialMass,initialEnergy,samples});
    if(n+1<steps&&((n+1)%1000===0||steps===60&&n===29))restart();
   }
  }
  const row=sample(steps),finalSerialized=JSON.stringify(snapshot()),finalRaw=JSON.parse(finalSerialized);
  expect(validSnapshot(finalRaw,grid.count)).toBe(true);expect(validSnapshot(upgradeSnapshot(finalRaw,grid.count),grid.count)).toBe(true);
  expect(JSON.stringify(finalRaw)).toBe(finalSerialized);expect(solver.state.every(Number.isFinite)).toBe(true);
  for(let q=0;q<solver.state.length;q+=STRIDE)for(const f of MASS_FIELDS){
   expect(solver.state[q+f]).toBeGreaterThanOrEqual(0);
   expect(solver.state[q+f]+solver.climate.air.surfaceMassCarry[q+f]).toBeGreaterThanOrEqual(0);
   expect(Math.abs(solver.climate.air.surfaceMassCarry[q+f])).toBeLessThanOrEqual(Math.max(2**-149,Math.abs(solver.state[q+f])*2**-23));
  }
  const result={layered,steps,cells:grid.count,initialMass,initialEnergy,maxMassResidual,maxElementRelative,maxEnergyRelative,maxPhaseChange,maxWaterRedistribution,maxDryCellWater,restarts,samples,last:row};
  report(name,{status:'measured',...result});console.info('large inventory',JSON.stringify({layered,steps,initialMass,initialEnergy,maxMassResidual,maxElementRelative,maxEnergyRelative,numericalRelative:row.numericalRelative,maxPhaseChange,maxWaterRedistribution,maxDryCellWater,restarts}));
  expect(row.totalMassResidual).toBeCloseTo(row.massResidual,8);
  expect(maxMassResidual).toBeLessThan(limits.massKg);expect(maxElementRelative).toBeLessThan(limits.elementsRelative);
  expect(maxEnergyRelative).toBeLessThan(limits.energyLedgerRelative);expect(row.numericalRelative).toBeLessThan(limits.numericalRelative);
  if(!layered)expect(maxPhaseChange).toBeGreaterThan(.001);
  expect(maxWaterRedistribution).toBeGreaterThan(.001);expect(maxDryCellWater).toBeGreaterThan(.001);
  expect(restarts).toBe(steps===10000?9:1);
  expect(hashes()).toEqual(initialHashes);
  report(name,{status:'passed',...result});
 }catch(error){report(name,{status:'failed',layered,steps,cells:grid.count,initialMass,initialEnergy,error:String(error),maxMassResidual,maxElementRelative,maxEnergyRelative,maxPhaseChange,maxWaterRedistribution,restarts,samples,last:sample(solverTime*30),snapshot:snapshot()});throw error;}
}

describe('original large inventory conservation',()=>{
 it('preserves the original 400 sand / 1000 water stress fixture',()=>{
  const grid=createSphere(1),{state}=largeInventoryScenario(grid);
  expect(grid.count).toBe(42);expect(state[F.sand]).toBe(LARGE_SAND);expect(state[F.water]).toBe(0);
  for(let i=1;i<grid.count;i++)expect(state[i*STRIDE+F.water]).toBe(LARGE_WATER);
  expect(totalMass(state)).toBe(41748.59999716282);
 });
 it.each([false,true])('retains .002 kg absolute mass after the original 60 steps (layered=%s)',layered=>run(layered,60),30000);
 it.each([false,true])('retains .002 kg through 10,000 steps and nine JSON resumes (layered=%s)',layered=>run(layered,10000),300000);
});
