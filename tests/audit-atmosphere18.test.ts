/** Alpha18 regression probes for the contracts identified by the alpha17 audit.
 * Run explicitly: AUDIT_ATMOSPHERE18=1 npx vitest run tests/audit-atmosphere18.test.ts --maxWorkers=1 --disableConsoleIntercept
 */
import {afterAll,describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,seedPlanet,type PhysicalState,type Environment} from '../src/sim/model';
import {WeatherClimate,validClimate} from '../src/sim/weatherClimate';
import {AIR_LAYERS,AIR_SPECIES,type LayeredAtmosphere} from '../src/sim/layeredAtmosphere';
import {radiativeFluxes} from '../src/sim/climatePhysics';
import {createDefinedPlanet,createMarsPlanet} from '../src/sim/planetCreation';
import {JUPITER_DEFINITION,planetSupport} from '../src/sim/planetDefinition';

const enabled=process.env.AUDIT_ATMOSPHERE18==='1',grid=createSphere(0);
const reports:Record<string,unknown>[]=[];
const environment:Environment={ambient:50,sunlight:0,sun:[1,0,0],gravity:1,rotationRate:0,climate:true};
type LocalInternals={surfaceExchange:(s:PhysicalState,i:number,dt:number)=>void;precipitation:(s:PhysicalState,i:number,dt:number,precipitated?:Float32Array)=>void;radiation:(s:PhysicalState,i:number,dt:number,e:Environment,energy:Float32Array)=>void;dynamics:(dt:number,e:Environment)=>void};
const internals=(air:LayeredAtmosphere)=>air as unknown as LocalInternals;
function world(){
 const s=new Float64Array(seedPlanet(grid,'sand',50));
 for(let i=0;i<grid.count;i++){s[i*STRIDE+F.sand]=100;s[i*STRIDE+F.water]=1;}
 const c=new WeatherClimate(grid);c.prepareSurface(s,environment);return {s,c,air:c.air};
}
const columnMomentum=(air:LayeredAtmosphere,i=0)=>Array.from({length:AIR_LAYERS},(_,k)=>air.layerMass(i*AIR_LAYERS+k)*air.velocity[(i*AIR_LAYERS+k)*3]).reduce((a,b)=>a+b,0);

afterAll(()=>{
 if(!enabled)return;
 const sources=['layeredAtmosphere','weatherClimate','deepAtmosphere','giantCloudPhysics','planetDefinition','atmosphere'].map(name=>{const path=`src/sim/${name}.ts`;return {path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};});
 mkdirSync('artifacts/stabilization-alpha18',{recursive:true});
 writeFileSync('artifacts/stabilization-alpha18/atmosphere18-report.json',JSON.stringify({createdAt:new Date().toISOString(),command:'AUDIT_ATMOSPHERE18=1 npx vitest run tests/audit-atmosphere18.test.ts --maxWorkers=1 --disableConsoleIntercept',scope:'Alpha18 regression verification of finite atmosphere exchange, gas caching and deep-profile admission',sources,reports},null,2)+'\n');
});

describe.skipIf(!enabled)('alpha18 atmosphere regression verification',()=>{
 it('conserves horizontal air momentum when stationary surface water evaporates',()=>{
  const {s,air}=world();air.velocity.set([100,0,0],0);
  const massBefore=air.layerMass(0),pBefore=massBefore*air.velocity[0],hBefore=air.surfaceEnergy(s,0)+air.columnEnergy(0),waterBefore=s[F.water];
  internals(air).surfaceExchange(s,0,1);
  const massAfter=air.layerMass(0),pAfter=massAfter*air.velocity[0],evaporated=waterBefore-s[F.water];
  reports.push({id:'evaporation-momentum',massBefore,massAfter,evaporated,momentumBefore:pBefore,momentumAfter:pAfter,momentumCreated:pAfter-pBefore,actualVelocity:air.velocity[0],expectedMixedVelocity:pBefore/massAfter,energyResidual:air.surfaceEnergy(s,0)+air.columnEnergy(0)-hBefore});
  expect(evaporated).toBeGreaterThan(0);expect(pAfter).toBeCloseTo(pBefore,12);
 });
 it('carries horizontal momentum with cloud ice settling into the next air layer',()=>{
  const {s,air}=world();air.mass.fill(0);air.temperature.fill(-10);air.velocity.fill(0);
  for(let q=0;q<air.temperature.length;q++)air.mass[q*AIR_SPECIES+1]=.03;
  const q=8,ice=1e-7;air.mass[q*AIR_SPECIES+5]=ice;air.velocity[q*3]=100;
  const pBefore=columnMomentum(air),hBefore=air.surfaceEnergy(s,0)+air.columnEnergy(0),rain=new Float32Array(grid.count*2);
  internals(air).precipitation(s,0,1,rain);
  const pAfter=columnMomentum(air),moved=ice-air.mass[q*AIR_SPECIES+5];
  reports.push({id:'ice-settling-momentum',donorLayer:q,iceBefore:ice,iceMoved:moved,receiverIce:air.mass[(q-1)*AIR_SPECIES+5],receiverVelocity:air.velocity[(q-1)*3],momentumBefore:pBefore,momentumAfter:pAfter,momentumLost:pBefore-pAfter,surfacePrecipitation:[...rain.subarray(0,2)],energyResidual:air.surfaceEnergy(s,0)+air.columnEnergy(0)-hBefore});
  expect(moved).toBeGreaterThan(0);expect(pAfter).toBeCloseTo(pBefore,12);
 });
 it('refreshes gas radiation after equal-mass nitrogen to carbon-dioxide exchange',()=>{
  const p=createMarsPlanet(grid),s=new Float64Array(p.state),c=new WeatherClimate(grid);c.prepareSurface(s,p.environment);const air=c.air;
  air.temperature.fill(-60);air.mass.fill(0);for(let q=0;q<air.temperature.length;q++)air.mass[q*AIR_SPECIES+1]=.0001;
  const energy=new Float32Array(grid.count*4);internals(air).radiation(s,0,0,p.environment,energy);
  const before=air.checkpoint().radiationCache[1];
  for(let k=0;k<AIR_LAYERS;k++){const a=k*AIR_SPECIES;air.mass[a+3]=air.mass[a+1];air.mass[a+1]=0;}
  internals(air).radiation(s,0,0,p.environment,energy);
  const cached=air.checkpoint().radiationCache[1],fresh=radiativeFluxes(air.radiationColumn(s,0,p.environment,1)),expected=fresh.down[0]-fresh.up[0];
  reports.push({id:'gas-radiation-cache',before,cached,expected,cacheErrorWm2:cached-expected,cacheAge:air.checkpoint().radiationCache[0],massPerLayer:.0001,temperature:-60});
  expect(cached).toBeCloseTo(expected,10);
 });
 it('rejects low-gravity deep profiles that exceed the physical height domain before creation',()=>{
  const definition=structuredClone(JUPITER_DEFINITION);definition.preset='custom';definition.surfaceGravity=.0981;
  const support=planetSupport(definition);
  reports.push({id:'low-gravity-deep-save-domain',support,gravity:definition.surfaceGravity,heightSaveLimit:3e6,creationRejected:!support.supported});
  expect(support.supported).toBe(false);expect(()=>createDefinedPlanet(grid,definition)).toThrow();
 });
 it('refreshes gas opacity after the production horizontal advection process changes composition',()=>{
  const p=createMarsPlanet(grid),s=new Float64Array(p.state),c=new WeatherClimate(grid);c.prepareSurface(s,p.environment);const air=c.air;
  air.temperature.fill(-60);air.mass.fill(0);for(let i=0;i<grid.count;i++)for(let k=0;k<AIR_LAYERS;k++)air.mass[(i*AIR_LAYERS+k)*AIR_SPECIES+(i===0?1:3)]=.0001;
  for(let i=0;i<grid.count;i++){const x=grid.directions[i*3],z=grid.directions[i*3+2],length=Math.hypot(x,z);if(length>0)for(let k=0;k<AIR_LAYERS;k++)air.velocity.set([z/length*1000,0,-x/length*1000],(i*AIR_LAYERS+k)*3);}
  const energy=new Float32Array(grid.count*4);internals(air).radiation(s,0,0,p.environment,energy);const initialCache=air.checkpoint().radiationCache.slice(),old=air.mass.slice();
  internals(air).dynamics(1,p.environment);
  const maxMassChange=Math.max(...Array.from({length:AIR_LAYERS},(_,k)=>Math.abs(air.layerMass(k)-.0001)/air.layerMass(k))),maxTemperatureChange=Math.max(...Array.from(air.temperature.subarray(0,AIR_LAYERS),t=>Math.abs(t+60)));
  internals(air).radiation(s,0,0,p.environment,energy);
  const cache=air.checkpoint().radiationCache,fresh=radiativeFluxes(air.radiationColumn(s,0,p.environment,1)),expected=fresh.down[0]-fresh.up[0];
  reports.push({id:'advected-gas-radiation-cache',physicalSeconds:1,initialCO2:old[3],advectedCO2:air.mass[3],maxRelativeLayerMassChange:maxMassChange,maxLayerTemperatureChange:maxTemperatureChange,cacheStillIdentical:cache.every((v,k)=>v===initialCache[k]),cached:cache[1],expected,cacheErrorWm2:cache[1]-expected,cacheAge:cache[0]});
  expect(air.mass[3]).toBeGreaterThan(0);expect(cache[1]).toBeCloseTo(expected,10);
 });
});
