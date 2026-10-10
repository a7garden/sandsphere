import {BackgroundWorlds,advanceOrbit,type PlanetRecord} from '../src/sim/system';
import {describe,it,expect} from 'vitest';
import {WeatherClimate,radiativeHeat,rotateCoriolis,climateColor,validClimate} from '../src/sim/weatherClimate';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,seedPlanet,totalMass,totalEnthalpy} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {validSnapshot} from '../src/sim/storage';
const grid=createSphere(1),env={ambient:18,sunlight:1,sun:[1,0,0],gravity:1,rotationRate:.06,climate:true};
const state=()=>{const s=seedPlanet(grid,'sand',22);for(let i=0;i<grid.count;i++){s[i*STRIDE+F.water]=.15;s[i*STRIDE+F.carbonDioxide]=.02;}return s;};
const zero=new Float32Array(grid.count*COMMAND_STRIDE);
describe('game climate',()=>{
 it('balances absorbed solar and T^4 emission without bath overshoot',()=>{
 const t=20,flux=5.670374419e-8*(t+273.15)**4;
 expect(radiativeHeat(35,t,flux,0,1)).toBeCloseTo(0,5);
 expect(radiativeHeat(35,t,flux*2,0,1)).toBeGreaterThan(0);
 expect(radiativeHeat(35,t,0,0,1)).toBeLessThan(0);
 expect(radiativeHeat(35,t,flux,2,1)).toBeGreaterThan(0);
 expect(radiativeHeat(35,2000,0,0,100)/35+2000).toBeGreaterThan(-100);
 });
 it('Coriolis changes direction, preserves speed and reverses hemispheres',()=>{
 const a=rotateCoriolis([1,0,0],[0,1,0],.06,1),b=rotateCoriolis([1,0,0],[0,-1,0],.06,1);
 // Opposite hemispheres need the same local east/north frame for comparison.
 expect(a[2]).toBeGreaterThan(0);expect(Math.hypot(...a)).toBeCloseTo(1,12);
 const north=[0,Math.SQRT1_2,Math.SQRT1_2],south=[0,-Math.SQRT1_2,Math.SQRT1_2];
 const an=rotateCoriolis([1,0,0],north,.06,1),as=rotateCoriolis([1,0,0],south,.06,1);
 expect(an[1]).toBeLessThan(0);expect(as[1]).toBeGreaterThan(0);expect(b.every(Number.isFinite)).toBe(true);
 });
 it('uniform conditions stay at rest; pressure gradients produce tangent winds',()=>{
 const s=state(),c=new WeatherClimate(grid),energy=new Float32Array(grid.count*4);c.step(s,.03,{...env,sunlight:0},energy);
 expect(c.wind.every(v=>v===0)).toBe(true);
 s[F.nitrogen]=.6;c.step(s,.03,env,energy);expect(c.wind.some(v=>Math.abs(v)>.000001)).toBe(true);
 for(let i=0;i<grid.count;i++)expect(Math.abs([0,1,2].reduce((a,k)=>a+c.wind[i*3+k]*grid.directions[i*3+k],0))).toBeLessThan(1e-7);
 });
 it('advects cloud stock, gas, heat and surface salt without hidden sinks',()=>{
 const s=state(),c=new WeatherClimate(grid),before=totalMass(s),h=totalEnthalpy(s),energy=new Float32Array(grid.count*4);
 for(let i=0;i<grid.count;i++){s[i*STRIDE+F.water]=2;s[i*STRIDE+F.dissolved]=.05;}
 s[F.cloud]=.2;s[F.temperature]=30;s[F.nitrogen]=.9;
 const initialMass=totalMass(s),initialHeat=totalEnthalpy(s);
 for(let k=0;k<60;k++)c.step(s,.03,env,energy);
 expect(totalMass(s)).toBeCloseTo(initialMass,4);
 expect(totalEnthalpy(s)-initialHeat-energy.reduce((a,v)=>a+v,0)).toBeCloseTo(0,2);
 expect(s[F.cloud]).toBeLessThan(.2);expect(s.slice(STRIDE).some((v,i)=>i%STRIDE===F.cloud&&v>0)).toBe(true);
 expect(c.currents.some(v=>Math.abs(v)>1e-6)).toBe(true);expect(s.every(Number.isFinite)).toBe(true);expect(before+h).toBeGreaterThan(0);
 });
 it('has no spontaneous abiogenesis; existing seeds establish on moist sand without organic soil',()=>{
 const sterile=state(),living=state(),c=new WeatherClimate(grid),d=new WeatherClimate(grid),q=new Float32Array(grid.count*4);d.seedLife(living);
 for(let k=0;k<90;k++){c.step(sterile,.03,env,q);d.step(living,.03,env,q);}
 expect(sterile.filter((_,i)=>i%STRIDE===F.plant).every(v=>v===0)).toBe(true);
 expect(living.some((v,i)=>i%STRIDE===F.plant&&v>0)).toBe(true);expect(totalMass(living)).toBeCloseTo(totalMass(state())+grid.count*.08,4);
 const frozen=state(),f=new WeatherClimate(grid);f.seedLife(frozen);for(let i=0;i<grid.count;i++)frozen[i*STRIDE+F.temperature]=-50;f.step(frozen,.03,env,q);
 expect(frozen.filter((_,i)=>i%STRIDE===F.plant).every(v=>v===0)).toBe(true);
 });
 it('full CPU ecology dies back in hostile conditions and retains a seed bank',()=>{
 const s=state();s[F.plant]=.5;const c=new CpuSolver(grid,s);
 for(let k=0;k<100;k++)c.advance(.03,zero,{...env,sunlight:0});
 expect(c.state[F.plant]).toBeLessThan(.5);expect(c.climate.seeds.some(v=>v>0)).toBe(true);
 });
 it('surface currents leave capillary soil water and its salt reservoir in place',()=>{
 const s=state(),c=new WeatherClimate(grid);for(let i=0;i<grid.count;i++){s[i*STRIDE+F.water]=.8;s[i*STRIDE+F.soil]=8;s[i*STRIDE+F.dissolved]=.03;c.currents[i*3]=.02;}
 c.step(s,.03,env,new Float32Array(grid.count*4));expect(c.currents.every(v=>v===0)).toBe(true);expect(s[F.water]).toBeCloseTo(.8,6);expect(s[F.dissolved]).toBeCloseTo(.03,6);
 });
 it('converging winds cool the cloud layer and seed removal prevents recolonization',()=>{
 const a=state(),b=a.slice(),ca=new WeatherClimate(grid),cb=new WeatherClimate(grid),q=new Float32Array(grid.count*4);
 for(let i=0;i<grid.count;i++){const p=i*STRIDE;a[p+F.vapor]=b[p+F.vapor]=.0018;const dot=[0,1,2].reduce((sum,k)=>sum+grid.directions[k]*grid.directions[i*3+k],0);for(let k=0;k<3;k++)ca.wind[i*3+k]=.1*(grid.directions[k]-dot*grid.directions[i*3+k]);}
 ca.step(a,.03,env,q);cb.step(b,.03,env,q);expect(ca.lift[0]).toBeGreaterThan(0);expect(a[F.cloud]).toBeGreaterThan(b[F.cloud]);
 const erased=state(),c=new WeatherClimate(grid);c.seedLife();c.step(erased,.03,env,q);expect(c.seeds.every(v=>v===0)).toBe(true);expect(erased[F.plant]).toBe(0);
 });
 it('physical dormant seeds germinate into biomass at conserved total mass',()=>{
 const s=state(),c=new WeatherClimate(grid);c.seedLife(s);const before=totalMass(s);expect(s[F.soil]).toBe(0);
 c.step(s,.03,env,new Float32Array(grid.count*4));expect(s.some((v,i)=>i%STRIDE===F.plant&&v>0)).toBe(true);expect(totalMass(s)).toBeCloseTo(before,4);
 });
 it('paused climate is exactly inert and resume retains velocity/seeds',()=>{
 const s=state(),a=new CpuSolver(grid,s);a.climate.seedLife();a.advance(.03,zero,env);
 const saved=a.climate.snapshot(),b=new CpuSolver(grid,a.state.slice());b.climate.restore(saved);
 const before=a.state.slice();a.advance(0,zero,env);expect(a.state).toEqual(before);expect(a.climate.snapshot()).toEqual(saved);
 for(let k=0;k<30;k++){a.advance(.03,zero,env);b.advance(.03,zero,env);}
 expect(a.state).toEqual(b.state);expect(a.climate.snapshot()).toEqual(b.climate.snapshot());
 expect(validClimate(saved,grid.count)).toBe(true);expect(validClimate({...saved,wind:[NaN]},grid.count)).toBe(false);
 const snapshot={version:4 as const,preset:'coast' as const,time:1,state:[...a.state],discoveries:[],environment:env,supplied:0,removed:0,climate:a.climate.snapshot()};
 expect(validSnapshot(snapshot,grid.count)).toBe(true);expect(validSnapshot({...snapshot,climate:{...saved,seeds:[1]}},grid.count)).toBe(false);
 });
 it('background worlds and a resumed active solver retain the same climate evolution',()=>{
 const s=state(),seeded=new CpuSolver(grid,s);seeded.climate.seedLife(s);const snapshot={version:4 as const,preset:'coast' as const,time:0,state:[...s],climate:seeded.climate.snapshot(),discoveries:[],environment:{...env,sun:[...env.sun]},supplied:0,removed:0,spin:{angle:0,running:true,period:120,tilt:23.5}};
 const record:PlanetRecord={id:'planet-background',name:'기후',snapshot:structuredClone(snapshot)},active=structuredClone(snapshot),solver=new CpuSolver(grid,s.slice());solver.climate.restore(active.climate);const background=new BackgroundWorlds(grid);
 for(let k=0;k<60;k++){advanceOrbit(active,.03);solver.advance(.03,zero,active.environment);background.step([record],'planet-other',.03);}
 expect(record.snapshot.state).toEqual([...solver.state]);expect(record.snapshot.climate).toEqual(solver.climate.snapshot());
 const resumed=new CpuSolver(grid,new Float32Array(record.snapshot.state));resumed.climate.restore(record.snapshot.climate);advanceOrbit(active,.03);solver.advance(.03,zero,active.environment);background.invalidate(record.id);background.step([record],'planet-other',.03);resumed.advance(.03,zero,active.environment);
 expect(record.snapshot.state).toEqual([...solver.state]);expect(resumed.state).toEqual(solver.state);
 });
 it('layers use actual pressure units and wet/dry air mass categories',()=>{
 const s=state(),c=new WeatherClimate(grid);const color=climateColor('pressure',s,1,env,c);expect(color[0]).toBeLessThan(.9);
 expect(climateColor('airmass',s,0,env,c)).not.toEqual(climateColor('temperature',s,0,env,c));
 });
});
