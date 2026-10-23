import {validLayered} from '../src/sim/layeredAtmosphere';
import {hydraulicScenario} from './helpers/hydraulicScenario';
import {airInventory} from './helpers/airInventory';
import {GASES} from '../src/sim/gases';
import {elementalMass,ATOMIC_MASS,type Element} from '../src/sim/chemistry';
import {describe,it,expect} from 'vitest';
import {OceanDynamics,validOcean,WATER_COLUMN_METERS,movingMass} from '../src/sim/oceanDynamics';
import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,enthalpy,totalMass,totalEnthalpy,type Snapshot} from '../src/sim/model';
import {validSnapshot} from '../src/sim/storage';
import {impactMeteor} from '../src/sim/meteor';
import {oceanScenario} from './helpers/oceanScenario';
function pair(bed=1,receiver=0,gravity=9.81){
 const grid=createSphere(0);for(let i=0;i<grid.count;i++)grid.geometry[i*4+3]=0;
 const j=grid.neighbors[0],a=Array.from(grid.directions.slice(0,3)),b=Array.from(grid.directions.slice(j*3,j*3+3)),d=b.map((v,k)=>v-a[k]),length=Math.hypot(...d),edge={i:0,j,distance:2*Math.asin(length/2),t:d.map(v=>v/length)},o=new OceanDynamics(grid,[edge]),state=new Float32Array(grid.count*STRIDE),ledger=new Float32Array(grid.count*4);
 for(let i=0;i<grid.count;i++){state[i*STRIDE+F.rock]=1;state[i*STRIDE+F.temperature]=20;}state[F.water]=2;state[j*STRIDE+F.rock]=bed;state[j*STRIDE+F.water]=receiver;o.configure(state,gravity);o.reconcile(state,ledger);ledger.fill(0);
 const thermal=()=>Array.from({length:grid.count},(_,i)=>enthalpy(state,i)).reduce((a,b)=>a+b),energy=()=>thermal()+o.energy(),numerical=()=>ledger.reduce((a,b,i)=>a+(i%4===3?b:0),0);
 return {grid,j,edge,o,state,ledger,thermal,energy,numerical};
}
describe('hydraulic parcels use finite gravitational energy',()=>{
 it('keeps a lake at rest over uneven bed geometry',()=>{const p=pair(2,1),before=p.state.slice(),h=p.energy();for(let i=0;i<100;i++)p.o.transport(p.state,1,1000,p.ledger);expect(p.state).toEqual(before);expect(p.o.kineticEnergy()).toBe(0);expect(p.energy()).toBe(h);});
 it('creates flow into a dry lower neighbor and turns potential into kinetic energy and mixing heat',()=>{
  const p=pair(),h=p.energy(),heat=p.thermal(),m=totalMass(p.state);p.o.transport(p.state,.1,1000,p.ledger);
  expect(p.state[p.j*STRIDE+F.water]).toBeGreaterThan(0);expect(p.o.potential.reduce((a,b)=>a+b)-p.o.datum).toBeLessThan(0);expect(p.o.kineticEnergy()).toBeGreaterThan(0);expect(p.thermal()).toBeGreaterThan(heat);expect(totalMass(p.state)).toBeCloseTo(m,6);expect(p.energy()-h-p.numerical()).toBeCloseTo(0,9);
  const k=p.o.kineticEnergy(),heatBefore=p.thermal();p.o.drag(p.state,600,p.ledger);expect(p.o.kineticEnergy()).toBeCloseTo(k*Math.exp(-2),10);expect(p.thermal()).toBeGreaterThan(heatBefore);expect(p.energy()-h-p.numerical()).toBeCloseTo(0,9);
 });
 it('does not flow through a higher dry barrier or when gravity is absent',()=>{for(const p of [pair(5),pair(1,0,0)]){const before=p.state.slice();p.o.transport(p.state,100,1000,p.ledger);expect(p.state).toEqual(before);expect(p.o.kineticEnergy()).toBe(0);}});
 it('pays uphill motion with forward kinetic energy and cannot buy it with heat',()=>{
  const p=pair(5),normal=Array.from(p.grid.directions.slice(0,3)),norm=Math.hypot(...normal);for(let k=0;k<3;k++)normal[k]/=norm;const dot=p.edge.t.reduce((a,v,k)=>a+v*normal[k],0),t=p.edge.t.map((v,k)=>v-dot*normal[k]),len=Math.hypot(...t);for(let k=0;k<3;k++)p.o.momentum[k]=p.o.mass[0]*100*t[k]/len;
  const h=p.energy();p.o.transport(p.state,.01,1000,p.ledger);expect(p.state[p.j*STRIDE+F.water]).toBeGreaterThan(0);expect(p.o.potential.reduce((a,b)=>a+b)-p.o.datum).toBeGreaterThan(0);expect(p.energy()-h-p.numerical()).toBeCloseTo(0,9);
  const blocked=pair(5);blocked.state[F.temperature]=4000;const before=blocked.state.slice();blocked.o.transport(blocked.state,10,1000,blocked.ledger);expect(blocked.state).toEqual(before);
 });
 it('accounts for terrain displacement as work, and for gravity edits as external work',()=>{
  const p=pair(),h=p.energy();p.state[F.rock]+=1;const before=p.energy();p.o.reconcile(p.state,p.ledger);expect(p.energy()-before-p.numerical()).toBeCloseTo(0,9);
  p.ledger.fill(0);const old=p.energy();p.o.configure(p.state,19.62,p.ledger);const external=p.ledger.reduce((a,b,i)=>a+(i%4===1?b:0),0);expect(external).toBeGreaterThan(0);expect(p.energy()-old-external).toBeCloseTo(0,5);expect(p.o.datum).toBeGreaterThan(0);expect(h).toBeGreaterThan(0);
 });
 it('preserves legacy kinetic stock and establishes a fixed potential datum without changing temperature',()=>{
  const p=pair();p.o.momentum[1]=2;const fresh=p.o.snapshot(),old={version:1 as const,ready:fresh.ready,mass:fresh.mass,momentum:fresh.momentum,boundaryImpulse:fresh.boundaryImpulse};expect(validOcean(old,p.grid.count)).toBe(true);
  const o=new OceanDynamics(p.grid,[p.edge]);o.restore(old);const before=p.state.slice(),k=o.energy();o.configure(p.state,9.81);expect(p.state).toEqual(before);expect(o.energy()).toBeCloseTo(k,12);expect(o.momentum).toEqual(p.o.momentum);const datum=o.datum;o.transport(p.state,.1,1000,p.ledger);expect(o.datum).toBe(datum);
  const resume=new OceanDynamics(p.grid,[p.edge]);resume.restore(JSON.parse(JSON.stringify(o.snapshot())));expect(resume.snapshot()).toEqual(o.snapshot());
 });
 it('canonicalizes empty potential and underflowed display velocities across JSON',()=>{
  const p=pair();p.state[F.water]=0;p.state[F.dissolved]=-1e-15;expect(Object.is(movingMass(p.state,0),-0)).toBe(false);p.state[F.dissolved]=0;p.grid.geometry[3]=-1;expect(Object.is(p.o.potentialAt(p.state,0),-0)).toBe(false);
  p.o.mass[0]=1;p.o.momentum[0]=-1e-100;const velocity=new Float32Array(p.grid.count*3);p.o.velocities(velocity,1e6);expect(Object.is(velocity[0],-0)).toBe(false);
  const old=p.o.snapshot();old.version=1;expect(validOcean(old,p.grid.count)).toBe(false);
 });
 it('bounds a very large hydraulic step by finite inventories and available head',()=>{const p=pair();const h=p.energy(),m=totalMass(p.state);p.o.transport(p.state,1e8,1000,p.ledger);expect(p.state.every(Number.isFinite)).toBe(true);expect(p.state[F.water]).toBeGreaterThan(0);expect(totalMass(p.state)).toBeCloseTo(m,6);expect(p.energy()-h-p.numerical()).toBeCloseTo(0,9);});
 it('converges the drainage trajectory as the timestep decreases',()=>{
  const run=(parts:number)=>{const p=pair();for(let n=0;n<100*parts;n++){p.o.transport(p.state,.001/parts,1000,p.ledger);p.o.drag(p.state,.06/parts,p.ledger);}return p.state[p.j*STRIDE+F.water];};const a=run(1),b=run(2),c=run(4);expect(Math.abs(c-b)).toBeLessThan(Math.abs(b-a));console.log('hydraulic refinement',{a,b,c});
 });
 it('runs a closed 10,000 step drainage, preserves mass/energy and exactly resumes',()=>{
  const p=pair(),h=p.energy(),m=totalMass(p.state),initial=p.o.potential.reduce((a,b)=>a+b);let accumulated=0,resumed:OceanDynamics|undefined,copy:Float32Array|undefined;
  for(let n=0;n<10000;n++){p.ledger.fill(0);p.o.transport(p.state,.03,1000,p.ledger);p.o.drag(p.state,1.8,p.ledger);p.o.reconcile(p.state,p.ledger);accumulated+=p.numerical();
   if(resumed&&n<5100){const l=new Float32Array(p.ledger.length);resumed.transport(copy!,.03,1000,l);resumed.drag(copy!,1.8,l);resumed.reconcile(copy!,l);expect(copy).toEqual(p.state);expect(resumed.snapshot()).toEqual(p.o.snapshot());}
   if(n===4999){resumed=new OceanDynamics(p.grid,[p.edge]);resumed.restore(JSON.parse(JSON.stringify(p.o.snapshot())));copy=p.state.slice();}
  }
  const mass=totalMass(p.state)-m,residual=p.energy()-h-accumulated;expect(Math.abs(mass)).toBeLessThan(2e-5);expect(Math.abs(residual)).toBeLessThan(1e-6);expect(p.o.potential.reduce((a,b)=>a+b)).toBeLessThan(initial);expect(p.state[p.j*STRIDE+F.water]).toBeCloseTo(1,2);console.log('hydraulic closed soak',{mass,residual,numerical:accumulated,water:p.state[p.j*STRIDE+F.water],kinetic:p.o.kineticEnergy(),heightMetres:WATER_COLUMN_METERS});
 },30000);
 it('runs 10,000 fully coupled head-driven steps with element budgets and exact JSON resume',()=>{
  const grid=createSphere(0),p=hydraulicScenario(grid,true),s=new CpuSolver(grid,p.state),empty=new Float32Array(grid.count*COMMAND_STRIDE);s.climate.restore(p.climate);
  const initial=airInventory(s),m=initial.reduce((a,b)=>a+b),h=totalEnthalpy(s.state,s.climate),atoms=elementalMass(initial),lost=new Float64Array(STRIDE);let external=0,numerical=0,peak=0,resumed:CpuSolver|undefined;
  const save=():Snapshot=>({version:11,preset:'coast',time:0,state:[...s.state],climate:s.climate.snapshot(),environment:p.environment,planet:{primary:'rock'},supplied:0,removed:0,discoveries:[]});
  for(let n=0;n<10000;n++){
   s.advance(1/30,empty,p.environment);peak=Math.max(peak,s.climate.ocean.kineticEnergy());for(let k=0;k<s.energyChanges.length;k++)if(k%4===3)numerical+=s.energyChanges[k];else external+=s.energyChanges[k];
   for(let i=0;i<grid.count;i++)for(let k=0;k<GASES.length;k++)lost[GASES[k].field]+=s.escapeCells[i*GASES.length+k];
   if(resumed&&n<5100){resumed.advance(1/30,empty,p.environment);expect(resumed.state).toEqual(s.state);expect(resumed.climate.snapshot()).toEqual(s.climate.snapshot());}
   if(n===4999){const record=JSON.parse(JSON.stringify(save()));expect(validSnapshot(record,grid.count)).toBe(true);resumed=new CpuSolver(grid,new Float32Array(record.state));resumed.climate.restore(record.climate);}
  }
  const stock=airInventory(s);for(let f=0;f<STRIDE;f++)stock[f]+=lost[f];const end=elementalMass(stock),mass=stock.reduce((a,b)=>a+b)-m,residual=totalEnthalpy(s.state,s.climate)-h-external-numerical,elementResidual=Math.max(...Object.keys(ATOMIC_MASS).map(k=>Math.abs(end[k as Element]-atoms[k as Element])/Math.max(1,atoms[k as Element])));
  expect(peak).toBeGreaterThan(0);expect(s.state.every(Number.isFinite)).toBe(true);expect(stock.every(v=>v>=0)).toBe(true);expect(validSnapshot(save(),grid.count)).toBe(true);expect(Math.abs(mass)/m).toBeLessThan(2e-5);expect(elementResidual).toBeLessThan(2e-5);expect(Math.abs(residual)/Math.abs(h)).toBeLessThan(2e-7);
  console.log('coupled hydraulic soak',{m,h,mass,residual,elementResidual,external,numerical,peak,remainingWater:s.state[F.water],barrierWater:s.state[grid.neighbors[0]*STRIDE+F.water]});
 },120000);
 it('carries sub-ULP evaporation demand while exchanging only actual withdrawn water',()=>{
  const grid=createSphere(0),p=oceanScenario(grid),s=new CpuSolver(grid,p.state);s.climate.restore(p.climate);s.climate.prepareSurface(s.state,p.environment);s.climate.air.velocity.set(s.climate.air.velocity.map(v=>v||0));
  const air=s.climate.air,exchange=air as unknown as {surfaceExchange(state:Float32Array,i:number,dt:number):void},mass=airInventory(s).reduce((a,b)=>a+b),water=s.state[F.water];
  exchange.surfaceExchange(s.state,0,1e-6);expect(s.state[F.water]).toBe(water);expect(air.snapshot()!.evaporationCarry![0]).toBeGreaterThan(0);
  for(let n=0;n<10000;n++)exchange.surfaceExchange(s.state,0,.1);
  expect(s.state[F.water]).toBeLessThan(water);expect(airInventory(s).reduce((a,b)=>a+b)-mass).toBeCloseTo(0,10);
  const saved=air.snapshot()!,copy=JSON.parse(JSON.stringify(saved));expect(validLayered(copy,grid.count)).toBe(true);air.restore(copy);expect(air.snapshot()).toEqual(saved);
  copy.version=6;delete copy.evaporationCarry;delete copy.surfaceHeatCarry;delete copy.geometryScale;delete copy.boundaryImpulse;delete copy.gasRadiationCache;expect(validLayered(copy,grid.count)).toBe(true);air.restore(copy);expect(air.snapshot()!.evaporationCarry!.every(v=>v===0)).toBe(true);
 });
 it('exports water/terrain potential in paused tools and meteor edits, and saves consistent state',()=>{
  const grid=createSphere(0),p=oceanScenario(grid),s=new CpuSolver(grid,p.state),empty=new Float32Array(grid.count*COMMAND_STRIDE);s.climate.restore(p.climate);const h=totalEnthalpy(s.state,s.climate);empty[0]=1;s.advance(0,empty,p.environment);expect(totalEnthalpy(s.state,s.climate)-h-s.energyChanges.reduce((a,b)=>a+b)).toBeCloseTo(0,4);
  const initial=totalEnthalpy(s.state,s.climate),ledger=new Float64Array(4),after=impactMeteor(s.state,grid,[...grid.directions.slice(0,3)],36,ledger,s.climate);expect(totalEnthalpy(after,s.climate)-initial-ledger.reduce((a,b)=>a+b)).toBeCloseTo(0,8);
  const snapshot:Snapshot={version:11,preset:'coast',time:0,state:[...after],climate:s.climate.snapshot(),environment:p.environment,planet:{primary:'rock'},supplied:0,removed:0,discoveries:[]};expect(validSnapshot(snapshot,grid.count)).toBe(true);
 });
});
