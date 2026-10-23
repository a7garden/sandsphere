import {describe,it,expect} from 'vitest';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,applyCommand,react,enthalpy,totalEnthalpy,totalMass,freezingPoint,saturation} from '../src/sim/model';
import {createSphere,INVALID} from '../src/sim/sphere';
import {BackgroundWorlds,advanceOrbit,type PlanetRecord} from '../src/sim/system';
import {PHYSICS_DT,SimulationClock} from '../src/sim/clock';
import {impactMeteor} from '../src/sim/meteor';
import {heatForTarget} from '../src/sim/toolHeat';
const grid=createSphere(1),empty=new Float32Array(grid.count*COMMAND_STRIDE);
const fresh=(t:number)=>{const s=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++)s[i*STRIDE+F.temperature]=t;return s;};
const calm=(t:number)=>({ambient:t,sunlight:0,sun:[1,0,0],gravity:3});
describe('scientific game contract',()=>{
 it('heats arriving mass with its new heat capacity and does not repeat a queued target',()=>{
  const s=fresh(20),queued=empty.slice();queued[0]=2;
  queued[4]=heatForTarget(s,0,80,'heat',queued);expect(queued[4]).toBeCloseTo((28+2*4.18)*60,3);
  expect(heatForTarget(s,0,80,'heat',queued)).toBe(0);
  const after=s.slice();applyCommand(after,0,queued);expect(after[F.temperature]).toBeCloseTo(80,4);
 });
 it('accounts for an in-flight GPU command before requesting another thermal edit',()=>{
  const s=fresh(20),active=empty.slice(),queued=empty.slice();active[4]=28*80;
  expect(heatForTarget(s,0,100,'heat',queued,active)).toBe(0);
  queued[4]=heatForTarget(s,0,-20,'cool',queued,active);expect(queued[4]).toBe(-28*120);
  expect(heatForTarget(s,0,-20,'cool',queued,active)).toBe(0);
 });
 it('leaves a paused cell and tiny clay history bit-for-bit unchanged without a command',()=>{
  const s=fresh(-10.713238);s[F.clay]=.0005;s[F.firing]=29.99999;s[F.water]=10;s[F.dissolved]=.36;
  const solver=new CpuSolver(grid,s.slice());for(let n=0;n<30;n++)solver.advance(0,empty,calm(-10));
  expect(solver.state).toEqual(s);expect(solver.energyChanges.every(v=>v===0)).toBe(true);
 });
 it('paused commands do not advance any reaction, even after adding heat',()=>{
  const s=fresh(-10);s[F.water]=10;s[F.dissolved]=.36;s[F.clay]=1;s[F.firing]=29;
  const solver=new CpuSolver(grid,s),commands=empty.slice();commands[4]=10000;
  const expected=s.slice();applyCommand(expected,0,commands);solver.advance(0,commands,calm(-10));
  expect(solver.state).toEqual(expected);expect([...solver.precipitatedCells]).toEqual([...new Float32Array(grid.count*2)]);
 });
 it('does not grant fresh clay the old batch exposure',()=>{
  const s=fresh(1000);s[F.clay]=1;s[F.firing]=29;
  const commands=empty.slice();commands[2]=100;commands[4]=98000;applyCommand(s,0,commands);
  expect(s[F.firing]).toBeCloseTo(29/101,6);react(s,0,1,calm(1000),grid);
  expect(s[F.clay]).toBe(101);expect(s[F.ceramic]).toBe(0);
 });
 it('carries the mass-weighted firing dose with transported clay',()=>{
  const s=fresh(20);s[F.clay]=500;s[F.firing]=24;
  const before=12000,solver=new CpuSolver(grid,s);solver.advance(PHYSICS_DT,empty,calm(20));
  let dose=0;for(let i=0;i<grid.count;i++)dose+=solver.state[i*STRIDE+F.clay]*solver.state[i*STRIDE+F.firing];
  expect(Math.abs(dose-before)).toBeLessThan(.002);
  const neighbor=[...grid.neighbors.slice(0,6)].find(i=>i!==INVALID)!;
  expect(solver.state[neighbor*STRIDE+F.clay]).toBeGreaterThan(0);expect(solver.state[neighbor*STRIDE+F.firing]).toBeCloseTo(24,4);
 });
 it('preserves brine energy and reaches the freezing point of the concentrated liquid',()=>{
  const s=fresh(-10);s[F.water]=10;s[F.dissolved]=.36;const h=enthalpy(s,0),mass=totalMass(s);
  react(s,0,PHYSICS_DT,calm(-10),grid);
  expect(enthalpy(s,0)).toBeCloseTo(h,3);expect(totalMass(s)).toBeCloseTo(mass,5);
  expect(s[F.ice]).toBeGreaterThan(0);expect(s[F.temperature]).toBeCloseTo(freezingPoint(s[F.water],s[F.dissolved]),4);
 });
 it('keeps surface evaporation at the 100°C boundary',()=>{
  for(const t of [99.9,100,100.1]){const s=fresh(t);s[F.water]=10;react(s,0,PHYSICS_DT,calm(t),grid);expect(s[F.vapor]).toBeGreaterThan(0);}
 });
 it('settles rain and its latent heat before final ground phase selection',()=>{
  const s=fresh(.1);s[F.cloudIce]=10;s[F.vapor]=saturation(.1-12);const h=enthalpy(s,0),precip=new Float32Array(grid.count*2);
  react(s,0,PHYSICS_DT,calm(.1),grid,undefined,undefined,precip);
  expect(enthalpy(s,0)).toBeCloseTo(h,3);expect(s[F.ice]).toBeGreaterThan(0);
  if(s[F.water]>1e-6)expect(s[F.temperature]).toBeCloseTo(0,4);else expect(s[F.temperature]).toBeLessThanOrEqual(0);
  expect(precip[1]).toBeGreaterThan(0);
  const brine=fresh(-1);brine[F.water]=10;brine[F.dissolved]=.36;brine[F.cloud]=1;brine[F.vapor]=saturation(-13);
  react(brine,0,PHYSICS_DT,calm(-1),grid);expect(brine[F.ice]).toBe(0);
 });
 it('conserves declared energy through firing, melting and glass formation',()=>{
  for(const [t,fields] of [[1800,{clay:10,firing:30,sand:10}],[1000,{molten:10}]] as const){
   const s=fresh(t);for(const [field,v]of Object.entries(fields))s[F[field as keyof typeof F]]=v;
   const h=enthalpy(s,0);react(s,0,PHYSICS_DT,calm(t),grid);expect(enthalpy(s,0)).toBeCloseTo(h,1);
  }
 });
 it('accounts for tool, environment, escape and rounding without discarding heat',()=>{
  const s=fresh(20);s[F.nitrogen]=100;const solver=new CpuSolver(grid,s),commands=empty.slice();commands[4]=1000000;commands[12]=2;
  const before=totalEnthalpy(solver.state);solver.advance(PHYSICS_DT,commands,{...calm(20),gravity:.03});
  expect(totalEnthalpy(solver.state)-before).toBeCloseTo(solver.energyChanges.reduce((a,b)=>a+b,0),0);
  expect(Math.abs(solver.energyChanges[3])/commands[4]).toBeLessThan(1e-6);expect(solver.state[F.temperature]).toBeGreaterThan(2500);
 });
 it('produces identical trajectories when the same elapsed time is batched',()=>{
  const s=fresh(20);s[F.water]=1000;const one=new CpuSolver(grid,s.slice()),batch=new CpuSolver(grid,s.slice());
  for(let n=0;n<24;n++)one.advance(PHYSICS_DT,empty,calm(20));batch.advance(.8,empty,calm(20));
  expect(batch.state).toEqual(one.state);expect(totalMass(batch.state)).toBeCloseTo(1000,3);
 });
 it('uses the active orbit and integration steps for a background planet',()=>{
  const s=fresh(20);s[F.water]=100;const environment={...calm(20),rotationRate:Math.PI/60,orbitDistance:1};
  const snapshot={version:3 as const,preset:'coast' as const,time:0,state:[...s],discoveries:[],supplied:0,removed:0,environment,spin:{angle:0,running:true,period:120}};
  const planets:PlanetRecord[]=[{id:'planet-1',name:'test',snapshot:structuredClone(snapshot)}];
  const active=structuredClone(snapshot),solver=new CpuSolver(grid,s.slice());
  for(let n=0;n<6;n++){advanceOrbit(active,PHYSICS_DT);solver.advance(PHYSICS_DT,empty,active.environment);}
  new BackgroundWorlds(grid).step(planets,'other',.2);expect(planets[0].snapshot.state).toEqual([...solver.state]);expect(planets[0].snapshot.time).toBeCloseTo(active.time,12);
 });
 it('retains simulation backlog and never derives steps from camera frames',()=>{
  const clock=new SimulationClock();clock.add(1,4);expect(clock.take(4)).toBe(4);expect(clock.backlog).toBeCloseTo(4-4/30,10);
  let steps=4;while(clock.backlog>=PHYSICS_DT-1e-8)steps+=clock.take();expect(steps).toBe(120);
 });
 it('preserves clay dose through impact redistribution',()=>{
  const s=fresh(20);for(let i=0;i<grid.count;i++){s[i*STRIDE+F.clay]=10;s[i*STRIDE+F.firing]=i%5;}
  const dose=(v:Float32Array)=>{let sum=0;for(let i=0;i<grid.count;i++)sum+=v[i*STRIDE+F.clay]*v[i*STRIDE+F.firing];return sum;};
  expect(dose(impactMeteor(s,grid,[...grid.directions.slice(0,3)],0))).toBeCloseTo(dose(s),3);
 });
 it('retains all meteor heat above the former temperature ceiling',()=>{
  const s=fresh(20),ledger=new Float64Array(4),after=impactMeteor(s,grid,[...grid.directions.slice(0,3)],50000,ledger);
  expect(ledger[1]).toBe(50000*1800);expect(Math.abs(ledger[3])/ledger[1]).toBeLessThan(1e-6);
  expect(totalEnthalpy(after)-totalEnthalpy(s)).toBeCloseTo(ledger[1]+ledger[3],5);
  expect(after.filter((_,i)=>i%STRIDE===F.temperature).some(t=>t>2500)).toBe(true);
 });
});
