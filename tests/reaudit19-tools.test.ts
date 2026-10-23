import {describe,it,expect} from 'vitest';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,totalMass,seedPlanet,totals,type Environment} from '../src/sim/model';
import {impactMeteor} from '../src/sim/meteor';
import {WeatherClimate} from '../src/sim/weatherClimate';
import {surfaceCapacity} from '../src/sim/layeredAtmosphere';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {waterEquilibrium} from '../src/sim/phaseEquilibrium';
import {bindingParameter,thermalEscapeFraction,GAS_CONSTANT} from '../src/sim/gases';
import {validClimate} from '../src/sim/weatherClimate';
const enabled=process.env.REAUDIT19==='1';
const paths=['src/sim/phaseEquilibrium.ts','src/sim/gases.ts','src/sim/meteor.ts','src/sim/layeredAtmosphere.ts','src/sim/model.ts'];
function receipt(name:string,data:unknown){mkdirSync('artifacts/reaudit19/tools',{recursive:true});writeFileSync(`artifacts/reaudit19/tools/${name}.json`,JSON.stringify({sources:Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),data},null,2)+'\n');}
describe.skipIf(!enabled)('alpha18 audit of tool external budgets',()=>{
 it('checks that pure steam phase allocation solves its supplied energy',()=>{
  const target=36,result=waterEquilibrium(0,0,.03,target,50000,0),residual=result.energy-target;
  receipt('independent-pure-steam',{target,result,residual});
  expect(Math.abs(residual)).toBeLessThan(1e-8);
 });
 it('checks incoming meteor mass away from coarse-grid vertices',()=>{
  const result=[];
  for(const level of [0,1,2]){
   const grid=createSphere(level),s=seedPlanet(grid,'sand',20),before=totalMass(s),ledger=new Float64Array(4),direction=[1,0,0];
   const out=impactMeteor(s,grid,direction,36,ledger),added=totalMass(out)-before,iron=totals(out)[F.iron];
   result.push({level,cells:grid.count,added,iron,ledger:[...ledger]});
  }
  receipt('meteor-footprint',result);console.log('meteor footprint',result);
  expect(result.every(r=>Math.abs(r.added-36)<.002)).toBe(true);
 });
 it('checks the cold binding law against the actual positive Kelvin inventory',()=>{
  const temperature=Math.fround(-273.14),kelvin=temperature+273.15,gravity=.01,radius=1000,molar=.028014,dt=1/30;
  const actual=bindingParameter(temperature,gravity,molar,radius),expected=gravity*9.81*radius*molar/(GAS_CONSTANT*kelvin),fraction=thermalEscapeFraction(temperature,gravity,molar,dt,radius),expectedFraction=-Math.expm1(-dt*.15*(1+expected)*Math.exp(-expected));
  receipt('cold-binding',{temperature,kelvin,actual,expected,fraction,expectedFraction,ratio:fraction/expectedFraction});console.log('cold binding',{actual,expected,fraction,expectedFraction});
  expect(actual).toBeCloseTo(expected,10);
 });
 it('checks meteor surface heat independently of aggregate-air cancellation',()=>{
  const result=[];
  for(const atmosphericStock of [.3,1e16]){
   const grid=createSphere(1),s=new Float64Array(seedPlanet(grid,'sand',20)),c=new WeatherClimate(grid),e:Environment={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,climate:true,body:sandboxDefinition('rock')};
   for(let i=0;i<grid.count;i++){s[i*STRIDE+F.nitrogen]=.3;s[i*STRIDE+F.temperature]=i===0?300:20;}
   c.prepareSurface(s,e);c.air.mass[1]=atmosphericStock;c.air.attach(s);const published=c.publishSurface(s);
   const thermal=()=>Array.from({length:grid.count},(_,i)=>c.air.surfaceEnergy(c.physicalSurface(published),i)).reduce((a,b)=>a+b,0);
   const before=thermal(),beforePotential=c.ocean.energy(),beforeC=c.air.surfaceCapacity(s,0),subtractedC=surfaceCapacity(s,0),ledger=new Float64Array(4);
   const out=impactMeteor(published,grid,[...grid.directions.subarray(0,3)],36,ledger,c),actual=c.physicalSurface(out),after=Array.from({length:grid.count},(_,i)=>c.air.surfaceEnergy(actual,i)).reduce((a,b)=>a+b,0);
   result.push({atmosphericStock,validClimate:validClimate(c.snapshot(),grid.count),beforeC,subtractedC,thermalDelta:after-before,potentialDelta:c.ocean.energy()-beforePotential,external:ledger[1],numerical:ledger[3],surfaceBudget:after-before+c.ocean.energy()-beforePotential-ledger[1],temperature:out[F.temperature]});
  }
  receipt('meteor-capacity',result);console.log('meteor capacity',result);
  expect(result.every(r=>Math.abs(r.surfaceBudget)<1e-5)).toBe(true);
 });
});
