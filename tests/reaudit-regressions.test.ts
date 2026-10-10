import {describe,it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {CpuSolver,F,STRIDE,COMMAND_STRIDE,MASS_FIELDS,equilibrateWater,freezingPoint,totalMass,enthalpy,capacity,emptyStock,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {PHYSICS_DT} from '../src/sim/clock';
import {snapshotSurface} from '../src/sim/session';
import {validSnapshot,upgradeSnapshot} from '../src/sim/storage';
import {prepareSystemSave,validSystem,BackgroundWorlds,type SystemSave} from '../src/sim/system';
import {advanceProgress,freshProgress} from '../src/sim/progress';
import {SectionView} from '../src/render/sectionView';
import {columnGeometry} from '../src/render/columnGeometry';
import {buildSectionMesh} from '../src/render/sectionGeometry';
import {precipitationSample} from '../src/render/precipitation';

const env={ambient:-20,sunlight:0,sun:[1,0,0],gravity:1};
const snapshot=(s:Float32Array):Snapshot=>({version:3,preset:'winter',state:[...s],time:0,environment:{...env},supplied:0,removed:0,discoveries:[],paused:false});
const envelope=(s:Snapshot):SystemSave=>({version:2,savedAt:0,activeId:'planet-first',planets:[{id:'planet-first',name:'First',snapshot:s}],stock:emptyStock(),progress:freshProgress()});
const cold=(count=1)=>{const s=new Float32Array(count*STRIDE);for(let i=0;i<count;i++){s[i*STRIDE+8]=-20;s[i*STRIDE+4]=.8;s[i*STRIDE+5]=4;}return s;};
describe('R01/R02: conservative, reversible water/ice/salt equilibrium',()=>{
 it('keeps the audited 0.8/4kg complete freeze nonnegative and persistable',()=>{
  const s=cold(),mass=totalMass(s),h=enthalpy(s,0);equilibrateWater(s,0);
  expect(s[F.water]).toBe(0);expect(s[F.dissolved]).toBe(0);
  expect(totalMass(s)).toBeCloseTo(mass,6);expect(enthalpy(s,0)).toBeCloseTo(h,4);expect(validSnapshot(snapshot(s),1)).toBe(true);
 });
 it('finds the audited saturated mixed brine instead of taking the fresh-water solid endpoint',()=>{
  const s=cold();s[F.dissolved]=.028;const h=enthalpy(s,0),mass=totalMass(s);equilibrateWater(s,0);
  expect(s[F.water]).toBeCloseTo(.0542422817,5);expect(s[F.ice]).toBeCloseTo(4.74575773,5);
  expect(s[F.temperature]).toBeCloseTo(-14.29411765,4);expect(s[F.temperature]).toBeCloseTo(freezingPoint(s[4],s[7]),4);
  expect(s[F.salt]).toBeGreaterThan(0);expect(totalMass(s)).toBeCloseTo(mass,6);expect(enthalpy(s,0)).toBeCloseTo(h,4);
 });
 it('allows frozen salt to return to brine on warming, with no invented salt or thermal reset',()=>{
  const s=cold();s[8]=-40;s[7]=.028;equilibrateWater(s,0);expect(s[4]).toBe(0);expect(s[7]).toBe(0);
  s[8]=-5;const h=enthalpy(s,0),salt=s[6]+s[7];equilibrateWater(s,0);
  expect(s[4]).toBeGreaterThan(0);expect(s[7]).toBeGreaterThan(0);expect(s[6]+s[7]).toBeCloseTo(salt,7);expect(enthalpy(s,0)).toBeCloseTo(h,4);
 });
 it('uses concentration rather than an absolute mass floor for microscopic brine',()=>{
  for(const scale of [1e-8,1e-4,1,100])expect(freezingPoint(scale,.035*scale)).toBeCloseTo(freezingPoint(1,.035),10);
  expect(freezingPoint(0,0)).toBe(0);
 });
 it('checks nonnegativity, salt/water/enthalpy and mixed-phase residual across phase boundaries',()=>{
  for(const [water,ice] of [[.8,4],[.1,.3],[30,10],[.00001,.00004]])for(const salt of [0,.028,2])for(const temperature of [-100,-30,-15,-14.295,-14.293,-13,-1,0,1,20,100]){
   const s=new Float32Array(STRIDE);s[4]=water;s[5]=ice;s[7]=salt;s[8]=temperature;
   const total=s[4]+s[5],saltTotal=s[6]+s[7],h=enthalpy(s,0),scale=Math.max(1,capacity(s,0)*Math.abs(s[8])+s[5]*334);
   equilibrateWater(s,0);for(const field of MASS_FIELDS)expect(s[field]).toBeGreaterThanOrEqual(0);
   expect(Math.abs(s[4]+s[5]-total)/Math.max(1,total)).toBeLessThan(2e-7);
   expect(Math.abs(s[6]+s[7]-saltTotal)/Math.max(1,saltTotal)).toBeLessThan(2e-7);
   expect(Math.abs(enthalpy(s,0)-h)/scale).toBeLessThan(1e-6);
   if(s[4]>1e-5&&s[5]>1e-5)expect(Math.abs(s[8]-freezingPoint(s[4],s[7]))).toBeLessThan(.0002);
  }
 });
 it('saves/reloads each cold solver step and resumes bit-for-bit with uninterrupted CPU evolution',()=>{
  const grid=createSphere(1),commands=new Float32Array(grid.count*COMMAND_STRIDE),solver=new CpuSolver(grid,cold(grid.count));
  let resumed:CpuSolver|undefined;
  for(let step=0;step<120;step++){
   solver.advance(PHYSICS_DT,commands,env);resumed?.advance(PHYSICS_DT,commands,env);
   const captured=snapshotSurface(solver.state,commands,[]).state;
   for(let p=0;p<captured.length;p+=STRIDE)for(const f of MASS_FIELDS)expect(captured[p+f]).toBeGreaterThanOrEqual(0);
   const saved=prepareSystemSave(envelope(snapshot(captured)),grid.count),loaded=JSON.parse(JSON.stringify(saved));
   expect(validSystem(loaded,grid.count)).toBe(true);
   if(step===59)resumed=new CpuSolver(grid,new Float32Array(upgradeSnapshot(loaded.planets[0].snapshot,grid.count).state));
  }
  expect(resumed!.state).toEqual(solver.state);
 });
 it('continues a background cold planet and persists all planets without changing the active one',()=>{
  const grid=createSphere(1),system=envelope(snapshot(cold(grid.count))),active=structuredClone(system.planets[0]);
  system.planets.push({id:'planet-second',name:'Second',snapshot:snapshot(cold(grid.count))});
  const background=new BackgroundWorlds(grid);
  for(let n=0;n<30;n++){background.step(system.planets,system.activeId,.2);expect(validSystem(prepareSystemSave(system,grid.count),grid.count)).toBe(true);}
  expect(system.planets[0]).toEqual(active);
 });
 it('repairs only legacy complement roundoff on copies while preserving water and salt totals',()=>{
  const s=cold();s[4]=-1.7881393432617188e-7;s[5]=4.800000190734863;s[7]=s[4]*.36;s[6]=.028-s[7];s[8]=-13.861;
  const legacy=snapshot(s),before=structuredClone(legacy),h=enthalpy(s,0),water=s[4]+s[5],salt=s[6]+s[7];
  expect(validSnapshot(legacy,1)).toBe(true);const restored=upgradeSnapshot(legacy,1);
  expect(restored.state[4]).toBe(0);expect(restored.state[7]).toBe(0);expect(restored.state[5]).toBe(water);expect(restored.state[6]).toBe(salt);
  expect(Math.abs(enthalpy(new Float32Array(restored.state),0)-h)/Math.max(1,Math.abs(h))).toBeLessThan(1e-7);expect(legacy).toEqual(before);
  for(const field of [F.water,F.dissolved,F.cloud]){const invalid=structuredClone(legacy);invalid.state[field]=-.01;expect(validSnapshot(invalid,1)).toBe(false);}
  const invalid=envelope({...legacy,state:legacy.state.map((v,i)=>i===F.water?-.01:v)});expect(()=>prepareSystemSave(invalid,1)).toThrow();
 });
});
describe('R04: warehouse destination and persisted completion',()=>{
 it('requires the second-created planet rather than the first or third recipient',()=>{
  const system=envelope(snapshot(cold()));system.planets[0].snapshot.transferredIn=1;
  const p=freshProgress(),stock=emptyStock();expect(advanceProgress(p,system.planets,stock)).not.toContain('transfer');
  system.planets.push({id:'planet-second',name:'Second',snapshot:snapshot(cold())},{id:'planet-third',name:'Third',snapshot:{...snapshot(cold()),transferredIn:2}});
  expect(advanceProgress(p,system.planets,stock)).not.toContain('transfer');
  system.planets[1].snapshot.transferredIn=.1;expect(advanceProgress(p,system.planets,stock)).toContain('transfer');
  const persisted=JSON.parse(JSON.stringify(p));system.planets[1].snapshot.transferredIn=0;
  expect(advanceProgress(persisted,system.planets,stock)).not.toContain('transfer');expect(persisted.completed).toContain('transfer');
 });
});
describe('R03/R05: section precipitation ownership, clear and phase',()=>{
 it('shares intensity and rain/snow phase, retains paused data, and clears even while hidden',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('world',scene),grid=createSphere(1),state=cold(grid.count),before=state.slice(),section=new SectionView(scene,root,grid);
  const terrain=new Float32Array([5,0,-1,5,1,1,5,-1,1]),water=new Float32Array(18),owners=new Uint32Array([0]);
  const update=()=>section.update(terrain,water,owners,state,Vector3.Forward(),.22);
  const data=()=>Array.from(section.mesh.getVerticesData('sectionData')!),fractions=()=>Array.from(section.mesh.getVerticesData('snowFraction')!);
  const rain=new Float32Array(grid.count*2);rain[0]=.001;const snow=rain.slice();snow[0]=0;snow[1]=.001;
  section.setVisible(true);section.showRain(true);section.setPrecipitation(rain,PHYSICS_DT);update();const rainData=data();
  expect(fractions().every(v=>v===0)).toBe(true);
  section.setPrecipitation(snow,PHYSICS_DT);update();expect(data()).toEqual(rainData);expect(fractions().slice(3).every(v=>v===1)).toBe(true);
  section.setPrecipitation(new Float32Array(rain.length),0);update();expect(data()).toEqual(rainData);
  rain[0]=.0005;rain[1]=.0005;section.setPrecipitation(rain,PHYSICS_DT);update();expect(fractions().slice(3).every(v=>v===.5)).toBe(true);
  const intensity=data()[15];expect(intensity).toBeCloseTo(precipitationSample(rain[0],rain[1],PHYSICS_DT).intensity);
  section.showRain(false);section.clearPrecipitation();update();section.showRain(true);update();
  expect(data().filter((_,i)=>i%4===3).every(v=>v===0)).toBe(true);expect(fractions().every(v=>v===0)).toBe(true);expect(state).toEqual(before);
  scene.dispose();engine.dispose();
 });
 it('renders the corrected residual brine as liquid beside solid ice with the same cell temperature',()=>{
  const grid=createSphere(1),s=cold(grid.count);s[F.dissolved]=.028;equilibrateWater(s,0);
  const before=s.slice(),column=columnGeometry(s,0,grid);
  expect(column.water).toBeGreaterThan(0);expect(column.waterRadius).toBeGreaterThan(column.solidRadius);
  const r=column.solidRadius,w=column.waterRadius,terrain=new Float32Array([r,0,-1,r,1,1,r,-1,1]),water=new Float32Array([w,0,-1,w,1,1,w,-1,1,0,0,0,0,0,0,0,0,0]);
  const cap=buildSectionMesh(terrain,water,new Uint32Array([0]),s,grid,Vector3.Forward(),.22);
  expect(cap.data.filter((_,i)=>i%4===2)).toContain(2);
  expect(cap.data.filter((_,i)=>i%4===0).slice(3).every(t=>t===s[F.temperature])).toBe(true);
  expect(cap.owners.slice(1).every(owner=>owner===0)).toBe(true);expect(s).toEqual(before);
 });
 it('normalizes the rate across dt and ignores the same tiny diagnostic amounts as the surface',()=>{
  expect(precipitationSample(.001,.003,.1)).toEqual(precipitationSample(.004,.012,.4));
  expect(precipitationSample(.5e-6,.5e-6,PHYSICS_DT)).toEqual({intensity:0,snowFraction:0});
 });
});
