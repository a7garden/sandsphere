/** Opt-in alpha.19 reaudit. These are invariant probes, not production fixes.
 * REAUDIT19_AIR=1 npx vitest run tests/reaudit19-air.test.ts --maxWorkers=1 --disableConsoleIntercept
 */
import {afterAll,describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createSphere} from '../src/sim/sphere';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,seedPlanet,totalMass,totalEnthalpy,type Environment,type Snapshot} from '../src/sim/model';
import {WeatherClimate,validClimate} from '../src/sim/weatherClimate';
import {AIR_LAYERS,AIR_SPECIES,type LayeredAtmosphere} from '../src/sim/layeredAtmosphere';
import {waterEquilibrium,waterStateAtTemperature} from '../src/sim/phaseEquilibrium';
import {saturationPressure} from '../src/sim/waterPhysics';
import {SPECIFIC_HEAT,MATERIAL_ENERGY,MIN_THERMODYNAMIC_TEMPERATURE} from '../src/sim/thermodynamics';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {GASES,thermalEscapeFraction,bindingParameter} from '../src/sim/gases';
import {validSnapshot} from '../src/sim/storage';
import {airInventory} from './helpers/airInventory';
import {stabilityScenario} from './helpers/stabilityScenario';
import {elementalMass,ATOMIC_MASS,type Element} from '../src/sim/chemistry';
const enabled=process.env.REAUDIT19_AIR==='1',grid=createSphere(0);
const environment:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,rotationRate:0,climate:true,body:sandboxDefinition('rock')};
const sourcePaths=['layeredAtmosphere','spectralRadiation','phaseEquilibrium','conservativeTransport','weatherClimate','climatePhysics','model','thermodynamics','gases','planetDefinition'].map(n=>`src/sim/${n}.ts`).concat('tests/reaudit19-air.test.ts');
const hashes=()=>sourcePaths.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
const startHashes=hashes(),reports:Record<string,unknown>[]=[];
type Internals={phase(q:number,i:number,k:number):void;dynamics(dt:number,e:Environment):void;clearFlux():void;commit():void};
const local=(air:LayeredAtmosphere)=>air as unknown as Internals;
function world(){const s=new Float64Array(seedPlanet(grid,'sand',20));const c=new WeatherClimate(grid);c.prepareSurface(s,environment);return {s,c,air:c.air};}
function save(s:CpuSolver,e:Environment):Snapshot{return {version:11,preset:'coast',time:0,state:[...s.state],environment:e,climate:s.climate.snapshot(),planet:{primary:'rock'},supplied:0,removed:0,discoveries:[]};}
afterAll(()=>{if(!enabled)return;mkdirSync('artifacts/reaudit19/air',{recursive:true});writeFileSync('artifacts/reaudit19/air/probes.json',JSON.stringify({createdAt:new Date().toISOString(),command:'REAUDIT19_AIR=1 npx vitest run tests/reaudit19-air.test.ts --maxWorkers=1 --disableConsoleIntercept',startHashes,endHashes:hashes(),reports},null,2)+'\n');});
describe.skipIf(!enabled)('alpha.19 air reaudit',()=>{
 it('preserves target enthalpy through pure-steam production phase equilibrium',()=>{
  const water=.03,enthalpy=water*1200,pressure=5e4,r=waterEquilibrium(0,0,water,enthalpy,pressure,0);
  reports.push({id:'pure-steam-equilibrium',water,enthalpy,pressure,result:r,residual:r.energy-enthalpy});
  const {s,c,air}=world();air.mass.fill(0);air.velocity.fill(0);air.temperature.fill(20);air.mass[0]=.03;air.temperature[0]=20;
  const before=air.layerEnergy(0),states=[];
  for(let n=0;n<8;n++){local(air).phase(0,0,0);states.push({temperature:air.temperature[0],vapor:air.mass[0],liquid:air.mass[4],ice:air.mass[5],pressure:air.pressure(0,0),energyResidual:air.layerEnergy(0)-before});}
  reports.push({id:'pure-steam-production-phase',states});
  expect(air.layerEnergy(0)).toBeCloseTo(before,12);expect(r.energy).toBeCloseTo(enthalpy,8);
 });
 it('diagnostic: a zero-flux commit preserves a finite trace reservoir',()=>{
  const {air}=world();air.mass.fill(0);air.dustMass.fill(0);air.velocity.fill(0);air.temperature.fill(20);air.mass[1]=1e-20;
  const before={temperature:air.temperature[0],energy:air.layerEnergy(0),mass:air.layerMass(0)};
  local(air).clearFlux();local(air).commit();
  const after={temperature:air.temperature[0],energy:air.layerEnergy(0),mass:air.layerMass(0)};
  reports.push({id:'trace-zero-flux',before,after,energyChange:after.energy-before.energy,numerical:air.checkpoint().roundoff[0]});console.log('trace',before,after);
  expect(after.mass).toBe(before.mass);expect(after.temperature).toBe(before.temperature);
 });
 it('diagnostic: supported pure-steam CPU path starts valid and remains above boiling after phase allocation',()=>{
  const s=seedPlanet(grid,'sand',20);for(let i=0;i<grid.count;i++){for(const f of [F.nitrogen,F.methane,F.carbonDioxide,F.oxygen,F.carbonMonoxide])s[i*STRIDE+f]=0;s[i*STRIDE+F.vapor]=.03;}
  const solver=new CpuSolver(grid,s);solver.climate.prepareSurface(solver.state,environment);solver.climate.air.attach(solver.state);
  const input=save(solver,environment),initialValid=validSnapshot(input,grid.count),before=solver.climate.air.snapshot();
  solver.advance(1/3600,new Float32Array(grid.count*COMMAND_STRIDE),environment);
  const air=solver.climate.air,states=Array.from({length:AIR_LAYERS},(_,q)=>({temperature:air.temperature[q],vapor:air.mass[q*AIR_SPECIES],liquid:air.mass[q*AIR_SPECIES+4],ice:air.mass[q*AIR_SPECIES+5],pressure:air.pressure(0,q),saturation:saturationPressure(air.temperature[q])}));
  const invalid=states.filter(r=>r.liquid+r.ice>1e-10&&r.saturation>r.pressure*1.01);
  reports.push({id:'pure-steam-full-cpu',input,initialValid,finalValid:validClimate(solver.climate.snapshot(),grid.count),before,states,invalid,ledger:[...solver.energyChanges]});
  expect(initialValid).toBe(true);expect(invalid).toEqual([]);
 });
 it('diagnostic: subkelvin low-binding CPU escape',()=>{
  const temperature=Math.fround(MIN_THERMODYNAMIC_TEMPERATURE),body=sandboxDefinition('rock',.01);body.radiusMeters=1000;
  const e={...environment,gravity:.01,ambient:20,body},s=new Float32Array(grid.count*STRIDE);
  for(let i=0;i<grid.count;i++){s[i*STRIDE+F.rock]=8;s[i*STRIDE+F.temperature]=temperature+1e-3;s[i*STRIDE+F.nitrogen]=.3;}
  const solver=new CpuSolver(grid,s);solver.climate.prepareSurface(solver.state,e);solver.climate.air.temperature.fill(temperature);
  for(let i=0;i<grid.count;i++){solver.state[i*STRIDE+F.temperature]=temperature;solver.climate.air.surfaceHeatCarry[i]=0;}
  solver.climate.air.attach(solver.state);const before=solver.climate.snapshot(),input=save(solver,e);let error:string|undefined;
  try{solver.advance(1/30,new Float32Array(grid.count*COMMAND_STRIDE),e);}catch(cause){error=String(cause);}
  const lambda=bindingParameter(temperature,.01,.028014,1000),actualLambda=.01*9.81*1000*.028014/(8.314462618*(temperature+273.15));
  const direct=new WeatherClimate(grid);direct.restore(before);const physical=direct.physicalSurface(new Float32Array(input.state));let directError:string|undefined;
  try{direct.air.advance(physical,1/30,e,new Float32Array(grid.count*4));}catch(cause){directError=String(cause);}
  const control=new CpuSolver(grid,new Float32Array(input.state));control.climate.restore(before);let controlError:string|undefined;try{control.advance(1/30,new Float32Array(grid.count*COMMAND_STRIDE),{...e,body:{...body,radiusMeters:1e6}});}catch(cause){controlError=String(cause);}
  reports.push({id:'subkelvin-low-binding',input,temperature,kelvin:temperature+273.15,initialValid:validSnapshot(input,grid.count),error,directError,directMinTemperature:Math.min(...direct.air.temperature),belowFloor:temperature-Math.min(...direct.air.temperature),controlError,lambda,actualLambda,actualFraction:thermalEscapeFraction(temperature,.01,.028014,1/30,1000),unflooredFraction:-Math.expm1(-1/30*.15*(1+actualLambda)*Math.exp(-actualLambda)),atomicRollback:JSON.stringify(solver.climate.snapshot())===JSON.stringify(before)});
  expect(validSnapshot(input,grid.count)).toBe(true);expect(error).toBeUndefined();
 });
 it('inverts 240 seeded ordinary moist states with finite stocks and energy',()=>{
  let seed=0x61a19,maxEnergyResidual=0,maxTemperatureResidual=0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;},failures=[];
  for(let n=0;n<240;n++){const dryMass=.05+random(),water=.0001+random()*.02,pressure=30000+random()*120000,temperature=-150+random()*240,potential=random()*20,at=waterStateAtTemperature(dryMass*1.04,dryMass/.028014,water,pressure,potential,temperature),r=waterEquilibrium(dryMass*1.04,dryMass/.028014,water,at.energy,pressure,potential),energyResidual=Math.abs(r.energy-at.energy),temperatureResidual=Math.abs(r.temperature-temperature);maxEnergyResidual=Math.max(maxEnergyResidual,energyResidual);maxTemperatureResidual=Math.max(maxTemperatureResidual,temperatureResidual);if(energyResidual>1e-7||temperatureResidual>1e-6)failures.push({n,dryMass,water,pressure,temperature,r,energyResidual,temperatureResidual});}
  reports.push({id:'seeded-ordinary-equilibrium',seed:'0x61a19',count:240,maxEnergyResidual,maxTemperatureResidual,failures});expect(failures).toEqual([]);
 });
 it('keeps 600 moist CPU steps finite, conservative and exact across two JSON restarts',()=>{
  const p=stabilityScenario(grid,'layered-water'),solver=new CpuSolver(grid,p.state),empty=new Float32Array(grid.count*COMMAND_STRIDE);solver.climate.restore(p.climate);
  const initialMass=totalMass(solver.state,solver.climate),initialEnergy=totalEnthalpy(solver.state,solver.climate),initialElements=elementalMass(airInventory(solver)),lost=new Float64Array(STRIDE),channels=[0,0,0,0];let copy:CpuSolver|undefined,restarts=0,numericalAbsolute=0;
  for(let n=1;n<=600;n++){solver.advance(1/30,empty,p.environment);if(copy){copy.advance(1/30,empty,p.environment);expect(copy.state).toEqual(solver.state);expect(copy.climate.snapshot()).toEqual(solver.climate.snapshot());copy=undefined;restarts++;}for(let q=0;q<solver.energyChanges.length;q++){channels[q%4]+=solver.energyChanges[q];if(q%4===3)numericalAbsolute+=Math.abs(solver.energyChanges[q]);}for(let i=0;i<grid.count;i++)for(let f=0;f<GASES.length;f++)lost[GASES[f].field]+=solver.escapeCells[i*GASES.length+f];if(n===200||n===400){const json=JSON.parse(JSON.stringify(save(solver,p.environment)));expect(validSnapshot(json,grid.count)).toBe(true);copy=new CpuSolver(grid,new Float32Array(json.state));copy.climate.restore(json.climate);}}
  const final=airInventory(solver);for(let f=0;f<STRIDE;f++)final[f]+=lost[f];const end=elementalMass(final),massResidual=final.reduce((a,b)=>a+b)-initialMass,energyResidual=totalEnthalpy(solver.state,solver.climate)-initialEnergy-channels.reduce((a,b)=>a+b),elementResidual=Math.max(...(Object.keys(ATOMIC_MASS) as Element[]).map(e=>Math.abs(end[e]-initialElements[e])/Math.max(1,initialElements[e])));
  reports.push({id:'moist-long-restart',steps:600,physicalSeconds:1200,restarts,massResidual,energyResidual,elementResidual,channels,numericalAbsolute,finalValid:validSnapshot(save(solver,p.environment),grid.count)});expect(solver.climate.air.mass.every(m=>m>=0&&Number.isFinite(m))).toBe(true);expect(Math.abs(massResidual)).toBeLessThan(1e-6);expect(Math.abs(energyResidual)).toBeLessThan(1e-5);expect(elementResidual).toBeLessThan(1e-8);expect(restarts).toBe(2);
 },60000);
});
