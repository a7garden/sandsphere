import {describe,it,expect} from 'vitest';
import {F,STRIDE,COMMAND_STRIDE,COMMAND_FIELD,CpuSolver,seedPlanet,totals,totalMass,applyCommand} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {atmosphereState} from '../src/sim/atmosphere';
import {GASES,thermalEscapeFraction} from '../src/sim/gases';
import {FIXED_SUN,localSun,orbitalEnvironment,solarEnergy} from '../src/sim/orbit';
import {snapshotSurface} from '../src/sim/session';
import {validSnapshot} from '../src/sim/storage';

const grid=createSphere(1),calm={ambient:20,sunlight:0,sun:[0,1,0],gravity:1};
function gasState(field:number,mass=.3,temperature=20) {
  const state=new Float32Array(grid.count*STRIDE);
  for(let i=0;i<grid.count;i++){state[i*STRIDE+field]=mass;state[i*STRIDE+F.temperature]=temperature;}
  return state;
}

describe('material atmospheres',()=>{
  it('has no artificial boundary in vacuum and grows with gas mass',()=>{
    const vacuum=atmosphereState(new Float32Array(grid.count*STRIDE),calm);
    expect(vacuum.mass).toBe(0);expect(vacuum.heightKm).toBe(0);expect(vacuum.scaleHeightKm).toBe(0);
    const light=atmosphereState(gasState(F.nitrogen),calm),dense=atmosphereState(gasState(F.nitrogen,.6),calm);
    expect(dense.pressure).toBeCloseTo(2*light.pressure,6);expect(dense.heightKm).toBeGreaterThan(light.heightKm!);
    expect(dense.scaleHeightKm).toBeCloseTo(light.scaleHeightKm,6);
  });
  it('compresses under gravity and expands with absolute temperature and lighter molecules',()=>{
    const normal=atmosphereState(gasState(F.nitrogen),calm),strong=atmosphereState(gasState(F.nitrogen),{...calm,gravity:2});
    expect(strong.pressure).toBeCloseTo(normal.pressure*2,6);expect(strong.scaleHeightKm).toBeCloseTo(normal.scaleHeightKm/2,6);
    expect(strong.heightKm).toBeLessThan(normal.heightKm!);
    const hot=atmosphereState(gasState(F.nitrogen,.3,313.15),calm);
    expect(hot.scaleHeightKm/normal.scaleHeightKm).toBeCloseTo(2,5);
    expect(atmosphereState(gasState(F.methane),calm).heightKm).toBeGreaterThan(normal.heightKm!);
    expect(atmosphereState(gasState(F.carbonDioxide),calm).heightKm).toBeLessThan(normal.heightKm!);
  });
  it('reports mole fractions rather than incorrectly treating mass fractions as composition',()=>{
    const state=gasState(F.nitrogen,.028014);
    for(let i=0;i<grid.count;i++)state[i*STRIDE+F.methane]=.016043;
    const a=atmosphereState(state,calm);
    expect(a.species.find(g=>g.id==='nitrogen')!.fraction).toBeCloseTo(.5,6);
    expect(a.species.find(g=>g.id==='methane')!.fraction).toBeCloseTo(.5,6);
    expect(a.molarMass).toBeCloseTo((.028014+.016043)/2,6);
  });
  it('diffuses all gases without negative mass, including a large step',()=>{
    const state=new Float32Array(grid.count*STRIDE),commands=new Float32Array(grid.count*COMMAND_STRIDE);
    for(let i=0;i<grid.count;i++)state[i*STRIDE+F.temperature]=20;
    commands[COMMAND_FIELD.nitrogen]=30;commands[COMMAND_FIELD.methane]=10;commands[COMMAND_FIELD.carbonDioxide]=20;
    const solver=new CpuSolver(grid,state);solver.advance(.5,commands,calm);
    for(let n=0;n<150;n++)solver.advance(.1,new Float32Array(commands.length),calm);
    const t=totals(solver.state);
    expect(t[F.nitrogen]).toBeCloseTo(30,4);expect(t[F.methane]).toBeCloseTo(10,4);expect(t[F.carbonDioxide]).toBeCloseTo(20,4);
    for(const gas of GASES)for(let i=0;i<grid.count;i++)expect(solver.state[i*STRIDE+gas.field]).toBeGreaterThanOrEqual(0);
  });
  it('accounts for weak-gravity gas escape without destroying or inventing material',()=>{
    const state=gasState(F.methane),solver=new CpuSolver(grid,state),commands=new Float32Array(grid.count*COMMAND_STRIDE);
    const before=totalMass(state);let escaped=0;
    for(let n=0;n<100;n++){solver.advance(.1,commands,{...calm,gravity:.01});escaped+=solver.escapeCells.reduce((s,v)=>s+v,0);}
    expect(escaped).toBeGreaterThan(before*.5);expect(totalMass(solver.state)+escaped).toBeCloseTo(before,4);
    expect(thermalEscapeFraction(80,.01,.016043,1)).toBeGreaterThan(thermalEscapeFraction(20,.01,.016043,1));
    expect(thermalEscapeFraction(20,.01,.016043,1)).toBeGreaterThan(thermalEscapeFraction(20,.01,.04401,1));
    expect(thermalEscapeFraction(20,1,.016043,1)).toBeLessThan(1e-6);
  });
  it('condenses vapor into regional clouds before precipitation',()=>{
    const state=gasState(F.nitrogen),commands=new Float32Array(grid.count*COMMAND_STRIDE);
    state[F.vapor]=2;state[F.temperature]=-5;
    state[STRIDE+F.vapor]=2;state[STRIDE+F.temperature]=40;
    const before=totalMass(state),solver=new CpuSolver(grid,state);solver.advance(.05,commands,calm);
    expect(solver.condensedCells[0]).toBeGreaterThan(solver.condensedCells[1]);
    expect(solver.condensedCells[0]).toBeGreaterThan(0);
    expect(totals(solver.state)[F.cloud]+totals(solver.state)[F.cloudIce]).toBeGreaterThan(0);
    expect(solver.precipitatedCells.every(v=>v===0)).toBe(true);
    expect(totalMass(solver.state)+solver.escapeCells.reduce((s,v)=>s+v,0)).toBeCloseTo(before,4);
    solver.replace(gasState(F.methane));
    expect(solver.condensedCells.every(v=>v===0)).toBe(true);
    expect(solver.escapeCells.every(v=>v===0)).toBe(true);
  });
  it('includes queued gases in snapshots and the removal budget',()=>{
    const live=gasState(F.nitrogen),pending=new Float32Array(grid.count*COMMAND_STRIDE);
    pending[COMMAND_FIELD.methane]=10;pending[5]=.5;
    const result=snapshotSurface(live,pending,[]);
    expect(result.pendingRemoved).toBeCloseTo((.3+10)/2,5);
    expect(totalMass(result.state)+result.pendingRemoved).toBeCloseTo(totalMass(live)+10,5);
    expect(result.state[F.methane]).toBe(5);expect(live[F.methane]).toBe(0);
    const command=new Float32Array(pending.length);command[5]=1;applyCommand(result.state,0,command);
    expect(result.state[F.nitrogen]+result.state[F.methane]).toBe(0);
  });
});

describe('planet creation and fixed sunlight',()=>{
  it('creates the chosen main material and actual initial gas stock',()=>{
    for(const primary of ['sand','clay','water','ice'] as const) {
      const state=seedPlanet(grid,primary,18,'methane',2),t=totals(state);
      expect(t[F[primary]]).toBeGreaterThan(t[F.rock]*3);
      expect(t[F.methane]).toBeCloseTo(grid.count*.6,5);expect(t[F.nitrogen]).toBe(0);
    }
    expect(atmosphereState(seedPlanet(grid,'rock',18,'none'),calm).mass).toBe(0);
  });
  it('derives energy from distance and keeps solar direction independent of the camera',()=>{
    expect(solarEnergy(2)).toBe(.25);expect(solarEnergy(.5)).toBe(4);
    expect(orbitalEnvironment(1).ambient).toBeCloseTo(18,8);
    expect(orbitalEnvironment(1.8).ambient).toBeLessThan(0);
    expect(localSun(0,0)).toEqual(FIXED_SUN);
    expect(localSun(Math.PI/2,0)[0]).toBeCloseTo(-FIXED_SUN[2],8);
    expect(localSun(Math.PI/2,0)[2]).toBeCloseTo(FIXED_SUN[0],8);
    expect(localSun(0,90)[1]).toBeCloseTo(-FIXED_SUN[0],8);
    expect(Math.hypot(...localSun(1.4,73))).toBeCloseTo(1,8);
  });
  it('restores new planet controls and rejects invalid gravity or lost-mass values',()=>{
    const saved={version:1,preset:'coast',planet:{primary:'ice'},state:[...seedPlanet(grid,'ice',-30,'methane')],time:10,discoveries:[],environment:orbitalEnvironment(1.8,.01),supplied:0,removed:0,escaped:12,spin:{angle:1,running:true,tilt:60,period:40}};
    expect(validSnapshot(saved,grid.count)).toBe(true);
    expect(validSnapshot({...saved,environment:{...saved.environment,gravity:0}},grid.count)).toBe(false);
    expect(validSnapshot({...saved,escaped:-1},grid.count)).toBe(false);
    expect(validSnapshot({...saved,spin:{...saved.spin,tilt:181}},grid.count)).toBe(false);
    expect(validSnapshot({...saved,planet:{primary:'unknown'}},grid.count)).toBe(false);
  });
});
