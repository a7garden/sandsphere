import {describe,it,expect} from 'vitest';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,react,totalMass,totalEnthalpy,capacity} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {atmosphereState,pressureBoundary,atmosphereReadout,BOUNDARY_PRESSURE} from '../src/sim/atmosphere';
import {thermalEscapeFraction,bindingParameter,escapeRegime,ESCAPE_MODEL_RADIUS,GASES} from '../src/sim/gases';
import {BATH_CONDUCTANCE,bathHeat,thermalTarget} from '../src/sim/climate';
import {PHYSICS_DT} from '../src/sim/clock';
import {buildSectionMesh} from '../src/render/sectionGeometry';
import {depthProfile} from '../src/ui/depthProfile';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
const grid=createSphere(1),env={ambient:20,sunlight:0,sun:[1,0,0],gravity:1};
function fresh(t=20){const s=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++){s[i*STRIDE+F.temperature]=t;s[i*STRIDE+F.rock]=8;}return s;}
describe('P3 model domains and conservative game simplifications',()=>{
 it('inverts the spherical hydrostatic pressure law and approaches the planar thin-shell limit',()=>{
  const p=1,H=8.8,r=ESCAPE_MODEL_RADIUS/1000,b=pressureBoundary(p,H),h=b.heightKm!;
  expect(p*Math.exp(-r/H*h/(r+h))).toBeCloseTo(BOUNDARY_PRESSURE,12);
  expect(h).toBeGreaterThan(H*Math.log(p/BOUNDARY_PRESSURE));
  expect(pressureBoundary(p,.01).heightKm!/(.01*Math.log(p/BOUNDARY_PRESSURE))).toBeCloseTo(1,3);
 });
 it('distinguishes a nonexistent finite pressure level from a capped finite level and hidden thin gas',()=>{
  const unbounded=pressureBoundary(1,300),limited=pressureBoundary(1,100);
  expect(unbounded.heightKm).toBeNull();expect(unbounded.kind).toBe('unbounded');expect(unbounded.displayHeightKm).toBe(250);
  expect(limited.kind).toBe('finite');expect(limited.heightKm).toBeGreaterThan(250);expect(limited.displayHeightKm).toBe(250);expect(limited.heightLimited).toBe(true);
  expect(pressureBoundary(.001,1000)).toEqual({heightKm:0,displayHeightKm:0,heightLimited:false,kind:'hidden'});
 });
 it('uses the same reference radius for scale height and gas binding, detecting the hottest local gas',()=>{
  const s=fresh();for(let i=0;i<grid.count;i++)s[i*STRIDE+F.nitrogen]=.3;
  const normal=atmosphereState(s,env);expect(normal.minimumBinding*normal.scaleHeightKm).toBeCloseTo(1000,8);expect(normal.profileValid).toBe(true);
  s[F.temperature]=2000;s[F.methane]=.001;
  const weak=atmosphereState(s,{...env,gravity:.03});
  expect(weak.minimumBinding).toBeCloseTo(bindingParameter(2000,.03,.016043),10);expect(weak.escapeRegime).toBe('weak-binding');expect(weak.profileValid).toBe(false);
 });
 it('never presents an unbounded approximation as a measured kilometre height and leaves source cells intact',()=>{
  const s=fresh();for(let i=0;i<grid.count;i++)s[i*STRIDE+F.methane]=3;
  const before=s.slice(),info=atmosphereState(s,{...env,gravity:.01}),reading=atmosphereReadout(info);
  expect(info.heightKm).toBeNull();expect(reading.height).toBe('유한 경계 없음');expect(reading.note).toContain('표시 상한');expect(reading.regime).toContain('근사');expect(s).toEqual(before);
  const trace=fresh();trace[F.methane]=1e-8;expect(atmosphereState(trace,env).minimumBinding).toBeGreaterThan(6);
  const vacuum=atmosphereState(fresh(),env);expect(atmosphereReadout(vacuum).regime).toBe('기체 없음');expect(vacuum.profileValid).toBe(false);
 });
 it('keeps accelerated escape bounded, monotonic and independent of time subdivision for a fixed state',()=>{
  const f=(t:number,g:number,dt:number)=>thermalEscapeFraction(t,g,.016043,dt),a=f(20,.01,.5);
  expect(1-(1-a)**2).toBeCloseTo(f(20,.01,1),14);expect(f(20,.01,0)).toBe(0);expect(f(20,.01,-1)).toBe(0);
  expect(f(2000,.01,1)).toBeGreaterThan(f(20,.01,1));expect(f(20,.01,1)).toBeGreaterThan(f(20,.03,1));
  for(const gas of GASES)for(const g of [.01,.03,1,3])for(const t of [-100,20,2500]){const value=thermalEscapeFraction(t,g,gas.molarMass,100);expect(value).toBeGreaterThanOrEqual(0);expect(value).toBeLessThanOrEqual(1);}
  expect(escapeRegime(2.9)).toBe('weak-binding');expect(escapeRegime(3)).toBe('transition');expect(escapeRegime(6)).toBe('jeans-shaped');
 });
 it('retains tiny nonzero escape without exponential cancellation',()=>{
  const loss=thermalEscapeFraction(20,1,.016043,PHYSICS_DT);expect(loss).toBeGreaterThan(0);expect(loss).toBeLessThan(Number.EPSILON);
 });
 it('conserves weak-gravity gas mass plus escaped stock and accounts for exported mean enthalpy',()=>{
  const s=fresh();for(let i=0;i<grid.count;i++){s[i*STRIDE+F.methane]=3;s[i*STRIDE+F.nitrogen]=.3;}
  const solver=new CpuSolver(grid,s.slice()),commands=new Float32Array(grid.count*COMMAND_STRIDE);let lost=0,q=0,escapeHeat=0;
  for(let n=0;n<300;n++){solver.advance(PHYSICS_DT,commands,{...env,gravity:.01});lost+=solver.escapeCells.reduce((a,b)=>a+b,0);q+=solver.energyChanges.reduce((a,b)=>a+b,0);escapeHeat+=solver.energyChanges.reduce((a,b,i)=>a+(i%4===2?b:0),0);}
  expect(lost).toBeGreaterThan(50);expect(totalMass(solver.state)+lost).toBeCloseTo(totalMass(s),4);
  expect(escapeHeat).toBeLessThan(0);expect(Math.abs(totalEnthalpy(solver.state)-totalEnthalpy(s)-q)).toBeLessThan(Math.abs(q)*1e-8+.001);
  expect(solver.state[F.temperature]).toBeCloseTo(20,5);
 });
 it('integrates the fixed-capacity external bath exactly without overshoot even at large dt',()=>{
  const c=35,t=300,target=100,dt=200,q=bathHeat(c,t,target,dt),middle=t+bathHeat(c,t,target,dt/2)/c;
  expect(q).toBeCloseTo(c*(target-t)*(1-Math.exp(-BATH_CONDUCTANCE*dt/c)),10);
  expect(c*(middle-t)+bathHeat(c,middle,target,dt/2)).toBeCloseTo(q,10);
  expect(t+q/c).toBeGreaterThan(target);expect(t+q/c).toBeLessThan(t);expect(bathHeat(c,t,target,0)).toBe(0);
  const s=fresh(300),energy=new Float32Array(grid.count*4),initial=totalEnthalpy(s);
  react(s,0,dt,{...env,ambient:100},grid,undefined,undefined,undefined,energy);
  expect(s[F.temperature]).toBeGreaterThanOrEqual(100);expect(s[F.temperature]).toBeLessThan(300);
  expect(totalEnthalpy(s)-initial).toBeCloseTo(energy.reduce((a,b)=>a+b,0),3);
 });
 it('derives the simple-mode equilibrium from the ambient bath and absorbed solar flux',()=>{
  expect(thermalTarget(20,1,0,.38)).toBe(20);expect(thermalTarget(20,1,1,.72)).toBeLessThan(thermalTarget(20,1,1,.12));
  const s=fresh(300),before=s.slice();react(s,0,0,env,grid);expect(s).toEqual(before);
 });
 it('uses the actual bath-adjusted temperature and gas mass in the section cap and depth profile',()=>{
  const s=fresh(300),energy=new Float32Array(grid.count*4),escaped=new Float32Array(grid.count*4);s[F.methane]=3;
  react(s,0,1,{...env,gravity:.01},grid,escaped,undefined,undefined,energy);const before=s.slice();
  const cap=buildSectionMesh(new Float32Array([5,0,-1,5,1,1,5,-1,1]),new Float32Array(18),new Uint32Array([0]),s,grid,Vector3.Forward(),.22);
  expect(cap.data.some((v,i)=>i%4===0&&Math.abs(v-s[F.temperature])<1e-4)).toBe(true);
  expect(depthProfile(s,0,grid).layers.some(l=>l.components.some(c=>c.id==='rock'&&c.mass===s[F.rock]))).toBe(true);expect(escaped[2]).toBeGreaterThan(0);expect(energy[0]).toBeLessThan(0);expect(energy[2]).toBeLessThan(0);expect(s).toEqual(before);
 });
 it('converges large-scale heat conduction across sphere refinements after factoring out the known bath',()=>{
  const results=[];
  for(const level of [1,2,3,4]){const g=createSphere(level),s=new Float32Array(g.count*STRIDE);let initial=0;
   for(let i=0;i<g.count;i++){const y=g.directions[i*3+1];s[i*STRIDE+F.rock]=8;s[i*STRIDE+F.temperature]=20+10*y;initial+=(s[i*STRIDE+F.temperature]-20)*y;}
   const solver=new CpuSolver(g,s.slice()),commands=new Float32Array(g.count*COMMAND_STRIDE),h=totalEnthalpy(s);let q=0;
   for(let n=0;n<300;n++){solver.advance(PHYSICS_DT,commands,env);q+=solver.energyChanges.reduce((a,b)=>a+b,0);}
   let final=0;for(let i=0;i<g.count;i++)final+=(solver.state[i*STRIDE+F.temperature]-20)*g.directions[i*3+1];
   const decay=1-final/initial/Math.exp(-BATH_CONDUCTANCE*10/capacity(s,0));results.push({cells:g.count,decay});expect(decay).toBeGreaterThan(0);expect(Math.abs(totalEnthalpy(solver.state,solver.climate)-h-q)/Math.max(1,Math.abs(h))).toBeLessThan(1e-6);
  }
  expect(Math.max(...results.map(r=>r.decay))/Math.min(...results.map(r=>r.decay))).toBeLessThan(1.12);console.info('P3 thermal spatial convergence',JSON.stringify(results));
 },60000);
});
