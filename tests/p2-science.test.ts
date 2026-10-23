import {describe,it,expect} from 'vitest';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,react,totalMass,totalEnthalpy,enthalpy,vaporCapacity,cellPressure} from '../src/sim/model';
import {createSphere,INVALID} from '../src/sim/sphere';
import {PHYSICS_DT} from '../src/sim/clock';
import {saturationPressure,waterActivity,boilingPoint,vaporPressure,REFERENCE_PRESSURE} from '../src/sim/waterPhysics';
import {consumerHabitat} from '../src/sim/ecology';
import {albedo,phaseLimitNotes} from '../src/sim/materialPhysics';
import {cloudEdgeFraction} from '../src/sim/clouds';
import {impactMeteor} from '../src/sim/meteor';
import {buildSectionMesh} from '../src/render/sectionGeometry';
import {depthProfile} from '../src/ui/depthProfile';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
const g=createSphere(1),empty=new Float32Array(g.count*COMMAND_STRIDE);
for(let i=0;i<g.count;i++)g.geometry[i*4+3]=0;
const env=(t:number)=>({ambient:t,sunlight:0,sun:[1,0,0],gravity:1});
function fresh(t=20){const s=new Float32Array(g.count*STRIDE);for(let i=0;i<g.count;i++){s[i*STRIDE+F.temperature]=t;s[i*STRIDE+F.nitrogen]=.3;}return s;}
describe('P2 science and deliberately bounded game physics',()=>{
 it('matches independently published pure water/ice saturation benchmarks and the 1-atm boiling point',()=>{
  expect(saturationPressure(20)).toBeCloseTo(2339.19,0);expect(saturationPressure(100)).toBeCloseTo(101418,0);
  expect(saturationPressure(-20,'ice')).toBeCloseTo(103.25,1);expect(saturationPressure(-20)).toBeGreaterThan(saturationPressure(-20,'ice'));
  expect(boilingPoint(REFERENCE_PRESSURE)).toBeCloseTo(99.974,2);expect(boilingPoint(REFERENCE_PRESSURE*.5)).toBeCloseTo(81.6445,2);
  expect(boilingPoint(REFERENCE_PRESSURE*2)).toBeCloseTo(120.625,2);
  for(const t of [-100,-40,0,100,500,2500])expect(Number.isFinite(saturationPressure(t))).toBe(true);
 });
 it('connects the saturated game mass to its actual molar vapor partial pressure',()=>{
  const s=fresh(),v=vaporCapacity(s,0,20,env(20));
  expect(vaporPressure(v,.3,0,0)).toBeCloseTo(saturationPressure(20),5);
  const stronger=vaporCapacity(s,0,20,{...env(20),gravity:2});expect(stronger).toBeLessThan(v);
  expect(vaporPressure(stronger,.3,0,0,2)).toBeCloseTo(saturationPressure(20),5);
 });
 it('boils at a lower temperature in a lighter atmospheric column, conserving water and heat',()=>{
  const run=(n:number)=>{const s=fresh(90);s[F.nitrogen]=n;s[F.water]=10;const h=enthalpy(s,0),before=totalMass(s);react(s,0,PHYSICS_DT,env(90),g);expect(totalMass(s)).toBeCloseTo(before,5);expect(enthalpy(s,0)).toBeCloseTo(h,2);return s;};
  const thin=run(.15),normal=run(.3);expect(thin[F.water]).toBeLessThan(normal[F.water]-.01);expect(thin[F.temperature]).toBeLessThan(normal[F.temperature]-1);
 });
 it('reduces brine vapor activity and raises its boiling boundary without treating concentrated brine as a marine EOS',()=>{
  const a=waterActivity(10,.36);expect(a).toBeLessThan(1);expect(a).toBeGreaterThan(.9);
  expect(boilingPoint(REFERENCE_PRESSURE,a)).toBeGreaterThan(boilingPoint(REFERENCE_PRESSURE));
  const s=fresh(),e=env(20);expect(vaporCapacity(s,0,20,e,'water',a)).toBeLessThan(vaporCapacity(s,0,20,e));
 });
 it('melts cloud ice using actual reservoir temperature and keeps above-freezing clouds liquid',()=>{
  const warm=fresh(12.5);warm[F.cloudIce]=.09;warm[F.vapor]=vaporCapacity(warm,0,.5,env(12.5),'ice');const h=enthalpy(warm,0);
  react(warm,0,PHYSICS_DT,env(12.5),g);expect(warm[F.cloud]).toBeGreaterThan(0);expect(warm[F.cloudIce]).toBeLessThan(.09);expect(enthalpy(warm,0)).toBeCloseTo(h,3);
  const cool=fresh(1);cool[F.cloud]=.09;cool[F.vapor]=vaporCapacity(cool,0,-11,env(1));react(cool,0,PHYSICS_DT,env(1),g);expect(cool[F.cloudIce]).toBe(0);
 });
 it('sublimates surface ice in dry cold air while spending phase energy and preserving water',()=>{
  const s=fresh(-20);s[F.ice]=10;const before=totalMass(s),h=enthalpy(s,0);react(s,0,PHYSICS_DT,env(-20),g);
  expect(s[F.ice]).toBeLessThan(10);expect(s[F.vapor]).toBeGreaterThan(0);expect(s[F.temperature]).toBeLessThan(-20);
  expect(totalMass(s)).toBeCloseTo(before,6);expect(enthalpy(s,0)).toBeCloseTo(h,2);
 });
 it('prevents consumer growth in fatal heat/cold and returns losses to organic matter and finite decomposition gases',()=>{
  for(const t of [-100,1000]){const s=fresh(t);s[F.soil]=10;s[F.plant]=10;s[F.herbivore]=2;s[F.carnivore]=1;s[F.water]=.3;const before=totalMass(s);
   for(let n=0;n<30;n++)react(s,0,PHYSICS_DT,env(t),g);
   expect(s[F.herbivore]).toBeLessThan(2);expect(s[F.carnivore]).toBeLessThan(1);expect(s[F.soil]*12/30+s[F.charcoal]+s[F.methane]*12/16+s[F.carbonMonoxide]*12/28+s[F.carbonDioxide]*12/44).toBeGreaterThan(10*12/30);expect(totalMass(s)).toBeCloseTo(before,4);
  }
  for(const args of [[22,0,0,0],[22,.3,.3,0],[1000,.3,0,0],[-100,.3,0,0]] as const)expect(consumerHabitat(args[0],args[1],args[2],args[3])).toBe(0);
 });
 it('reduces plant growth with the same cloud-shaded light used for heating and observation',()=>{
  const clear=fresh(22),cloudy=fresh(22),e={...env(22),sunlight:.4,sun:[...g.directions.slice(0,3)]};
  for(const s of [clear,cloudy]){s[F.soil]=10;s[F.plant]=5;s[F.water]=.3;s[F.vapor]=vaporCapacity(s,0,10,e);}cloudy[F.cloud]=.1;
  react(clear,0,PHYSICS_DT,e,g);react(cloudy,0,PHYSICS_DT,e,g);expect(cloudy[F.plant]).toBeLessThan(clear[F.plant]);
 });
 it('does not disperse consumers into an uninhabitable destination',()=>{
  const s=fresh(22);for(let i=0;i<g.count;i++){s[i*STRIDE+F.water]=.3;s[i*STRIDE+F.temperature]=1000;}s[F.temperature]=22;s[F.herbivore]=2;
  const solver=new CpuSolver(g,s);solver.advance(PHYSICS_DT,empty,env(22));
  for(const j of g.neighbors.slice(0,6))if(j!==INVALID)expect(solver.state[j*STRIDE+F.herbivore]).toBe(0);
 });
 it('reheats glass and moves hot silica by a conservative temperature-dependent viscous flow',()=>{
  const run=(t:number)=>{const s=fresh(t);s[F.molten]=10;const solver=new CpuSolver(g,s);const h=totalEnthalpy(s),before=totalMass(s);solver.advance(PHYSICS_DT,empty,env(t));expect(totalMass(solver.state)).toBeCloseTo(before,5);expect(totalEnthalpy(solver.state)-h).toBeCloseTo(solver.energyChanges.reduce((a,b)=>a+b,0),1);return solver.state;};
  const hot=run(1800),slow=run(1450);expect(hot[F.molten]).toBeLessThan(slow[F.molten]);expect([...g.neighbors.slice(0,6)].some(j=>j!==INVALID&&hot[j*STRIDE+F.molten]>0)).toBe(true);
  const s=fresh(1900);s[F.glass]=10;const h=enthalpy(s,0);react(s,0,PHYSICS_DT,env(1900),g);expect(s[F.molten]).toBeGreaterThan(0);expect(enthalpy(s,0)).toBeCloseTo(h,2);
 });
 it('conducts heat faster through iron than ceramic at equal capacities, keeping an energy ledger',()=>{
  const run=(field:number,mass:number)=>{const s=fresh(0);for(let i=0;i<g.count;i++)s[i*STRIDE+field]=mass;s[F.temperature]=100;const solver=new CpuSolver(g,s),before=totalEnthalpy(s);solver.advance(PHYSICS_DT,empty,env(0));expect(totalEnthalpy(solver.state)-before).toBeCloseTo(solver.energyChanges.reduce((a,b)=>a+b,0),3);return solver.state[g.neighbors[0]*STRIDE+F.temperature];};
  expect(run(F.iron,4)).toBeGreaterThan(run(F.ceramic,2)*2);
 });
 it('changes albedo continuously across retired mass thresholds and distinguishes bright salt from dark soil',()=>{
  const s=fresh();s[F.rock]=8;s[F.ice]=.499999;const a=albedo(s,0);s[F.ice]=.500001;expect(Math.abs(albedo(s,0)-a)).toBeLessThan(1e-5);
  s[F.ice]=0;s[F.salt]=10;const salt=albedo(s,0);s[F.salt]=0;s[F.soil]=10;expect(salt).toBeGreaterThan(albedo(s,0));
 });
 it('retains distinct material identities and reports phase-model limits rather than labeling hot iron as a modeled solid',()=>{
  const s=fresh(2000);s[F.iron]=3;s[F.salt]=2;const before=s.slice();expect(phaseLimitNotes(s,0).some(n=>n.startsWith('운철'))).toBe(true);expect(phaseLimitNotes(s,0).some(n=>n.startsWith('소금'))).toBe(true);expect(s).toEqual(before);
  const cold=fresh(-100);expect(phaseLimitNotes(cold,0)).toEqual([]);
  const gas=fresh(20);gas[F.carbonDioxide]=30;expect(phaseLimitNotes(gas,0).some(n=>n.includes('고압 응축'))).toBe(true);
 });
 it('redistributes impact ice and molten stock with their phase energy intact',()=>{
  const grid=createSphere(3),s=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++){s[i*STRIDE+F.temperature]=200;s[i*STRIDE+F.ice]=2;s[i*STRIDE+F.molten]=3;}
  const energy=new Float64Array(4),before=totalMass(s),h=totalEnthalpy(s),result=impactMeteor(s,grid,[...grid.directions.slice(0,3)],0,energy);
  expect(result[F.ice]).toBeLessThan(2);expect(result[F.molten]).toBeLessThan(3);expect(totalMass(result)).toBeCloseTo(before,4);expect(totalEnthalpy(result)-h).toBeCloseTo(energy.reduce((a,b)=>a+b,0),6);
 });
 it('shows actual reheated molten stock in the same section cap and depth composition without changing the solver',()=>{
  const s=fresh(1900);s[F.glass]=10;react(s,0,PHYSICS_DT,env(1900),g);const before=s.slice();
  const cap=buildSectionMesh(new Float32Array([5,0,-1,5,1,1,5,-1,1]),new Float32Array(18),new Uint32Array([0]),s,g,Vector3.Forward(),.22);
  const profile=depthProfile(s,0,g);expect(profile.layers.some(l=>l.components.some(c=>c.id==='molten'&&c.mass>0))).toBe(true);
  expect(cap.data.some((v,i)=>i%4===0&&v>1800)).toBe(true);expect(cap.colors.every(Number.isFinite)).toBe(true);expect(s).toEqual(before);
 });
 it('keeps cold cloud nucleation stable around the 0°C surface roundoff boundary',()=>{
  for(const t of [-.00001,0,.00001]){const s=fresh(t);s[F.water]=10;s[F.vapor]=.1;react(s,0,PHYSICS_DT,env(t),g);expect(s[F.cloud]).toBeGreaterThan(0);expect(s[F.cloudIce]).toBeLessThan(1e-6);}
 });
 it('keeps the large-scale atmospheric diffusion rate consistent as the sphere is refined',()=>{
  const results=[];
  for(const level of [1,2,3,4]){
   const grid=createSphere(level),s=new Float32Array(grid.count*STRIDE);let norm=0,initial=0;
   for(let i=0;i<grid.count;i++){const y=grid.directions[i*3+1];s[i*STRIDE+F.temperature]=20;s[i*STRIDE+F.nitrogen]=.3+.1*y;norm+=y*y;initial+=(s[i*STRIDE+F.nitrogen]-.3)*y;}
   const solver=new CpuSolver(grid,s),commands=new Float32Array(grid.count*COMMAND_STRIDE);
   for(let n=0;n<30;n++)solver.advance(PHYSICS_DT,commands,env(20));
   let final=0;for(let i=0;i<grid.count;i++)final+=(solver.state[i*STRIDE+F.nitrogen]-.3)*grid.directions[i*3+1];
   const decay=1-final/initial;results.push({cells:grid.count,decay});expect(decay).toBeGreaterThan(0);expect(totalMass(solver.state)).toBeCloseTo(totalMass(s),4);
  }
  const rates=results.map(r=>r.decay);expect(Math.max(...rates)/Math.min(...rates)).toBeLessThan(1.12);
  console.info('spatial diffusion convergence',JSON.stringify(results));
 });
 it('mixes legacy cloud tracers symmetrically without prescribing latitude winds',()=>{
  for(let i=0;i<g.count;i++)for(let k=0;k<6;k++){const j=g.neighbors[i*6+k];if(j!==INVALID)expect(cloudEdgeFraction(g,i,j,PHYSICS_DT)).toBeCloseTo(cloudEdgeFraction(g,j,i,PHYSICS_DT),14);}
  const state=fresh();state[F.cloud]=1;const forward=new CpuSolver(g,state.slice()),reverse=new CpuSolver(g,state.slice());
  forward.advance(.2,empty,{...env(20),rotationRate:.05});reverse.advance(.2,empty,{...env(20),rotationRate:-.05});expect(reverse.state).toEqual(forward.state);
 });
});
