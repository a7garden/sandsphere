import {describe,it,expect} from 'vitest';
import {F,STRIDE,COMMAND_STRIDE,CpuSolver,react,saturation,totalMass,totals,capacity,ICE_LATENT,WATER_LATENT,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';
import {cloudWind,CLOUD_COOLING} from '../src/sim/clouds';
import {atmosphereState} from '../src/sim/atmosphere';
import {atmosphereOptics} from '../src/sim/optics';
import {upgradeSnapshot,validSnapshot} from '../src/sim/storage';

const grid=createSphere(1),calm={ambient:20,sunlight:0,sun:[1,0,0],gravity:1,rotationRate:0};
function stateAt(temperature=20){const state=new Float32Array(grid.count*STRIDE);for(let i=0;i<grid.count;i++)state[i*STRIDE+F.temperature]=temperature;return state;}
const latent=WATER_LATENT+(4.18-2)*100;
function energy(state:Float32Array,i=0){const p=i*STRIDE;return capacity(state,i)*state[p+F.temperature]+state[p+F.vapor]*latent-(state[p+F.ice]+state[p+F.cloudIce])*ICE_LATENT;}

describe('persistent cloud cycle',()=>{
  it('never overdraws a tiny cloud phase when a mixed cloud fully evaporates',()=>{
    for(let n=1;n<=100;n++){
      const s=stateAt(40);s[F.cloud]=n*1e-13;s[F.cloudIce]=n*1e-6;
      const before=totalMass(s);react(s,0,.2,{...calm,ambient:40},grid);
      expect(s[F.cloud]).toBeGreaterThanOrEqual(0);expect(s[F.cloudIce]).toBeGreaterThanOrEqual(0);
      expect(totalMass(s)).toBeCloseTo(before,8);
    }
  });
  it('holds small clouds aloft instead of raining at every condensation',()=>{
    const s=stateAt();s[F.vapor]=saturation(20-CLOUD_COOLING)+.1;
    const before=totalMass(s),precip=new Float32Array(grid.count*2);
    react(s,0,.1,calm,grid,undefined,undefined,precip);
    expect(s[F.cloud]).toBeGreaterThan(0);expect(s[F.water]).toBe(0);expect(precip[0]).toBe(0);
    expect(totalMass(s)).toBeCloseTo(before,6);
    const persisted=s[F.cloud];react(s,0,0,calm,grid);
    expect(s[F.cloud]).toBe(persisted);
  });
  it('returns clouds to vapor in dry air while spending latent heat',()=>{
    const s=stateAt(40);s[F.cloud]=.12;const before=totalMass(s);
    react(s,0,.2,{...calm,ambient:40},grid);
    expect(s[F.cloud]).toBeLessThan(.12);expect(s[F.vapor]).toBeGreaterThan(0);expect(s[F.temperature]).toBeLessThan(40);
    expect(totalMass(s)).toBeCloseTo(before,6);
  });
  it('rains from a sufficiently wet cloud and re-evaporates some rain in dry air',()=>{
    const wet=stateAt(),dry=stateAt();wet[F.cloud]=dry[F.cloud]=1;wet[F.vapor]=saturation(20-CLOUD_COOLING);
    const wetDrops=new Float32Array(grid.count*2),dryDrops=new Float32Array(grid.count*2),before=totalMass(wet),initialEnergy=energy(wet);
    react(wet,0,.1,calm,grid,undefined,undefined,wetDrops);react(dry,0,.1,calm,grid,undefined,undefined,dryDrops);
    expect(wetDrops[0]).toBeGreaterThan(0);expect(wet[F.water]).toBeCloseTo(wetDrops[0],6);expect(wetDrops[1]).toBe(0);
    expect(dryDrops[0]).toBeLessThan(wetDrops[0]);expect(dry[F.vapor]).toBeGreaterThan(0);
    expect(totalMass(wet)).toBeCloseTo(before,6);expect(energy(wet)).toBeCloseTo(initialEnergy,3);
  });
  it('settles ice clouds as snow without creating water or losing phase energy',()=>{
    const s=stateAt(-20);s[F.cloudIce]=1;s[F.vapor]=saturation(-20-CLOUD_COOLING);
    const precip=new Float32Array(grid.count*2),before=totalMass(s),initialEnergy=energy(s);
    react(s,0,.1,{...calm,ambient:-20},grid,undefined,undefined,precip);
    expect(precip[1]).toBeGreaterThan(0);expect(precip[0]).toBe(0);expect(s[F.ice]).toBeCloseTo(precip[1],6);
    expect(totalMass(s)).toBeCloseTo(before,6);expect(energy(s)).toBeCloseTo(initialEnergy,3);
  });
  it('advects clouds across cell boundaries and conserves all water phases for a large step',()=>{
    const s=stateAt();s[F.cloud]=2;s[F.cloudIce]=1;s[F.vapor]=.4;
    const before=totalMass(s),solver=new CpuSolver(grid,s),commands=new Float32Array(grid.count*COMMAND_STRIDE);
    solver.advance(1,commands,{...calm,rotationRate:Math.PI/10});
    const cloudElsewhere=solver.state.filter((v,i)=>i>=STRIDE&&(i%STRIDE===F.cloud||i%STRIDE===F.cloudIce)).reduce((a,v)=>a+v,0);
    expect(cloudElsewhere).toBeGreaterThan(0);expect(totalMass(solver.state)).toBeCloseTo(before,5);
    for(let i=0;i<grid.count;i++)for(const field of [F.water,F.ice,F.vapor,F.cloud,F.cloudIce])expect(solver.state[i*STRIDE+field]).toBeGreaterThanOrEqual(0);
    solver.replace(stateAt());expect(solver.precipitatedCells.every(v=>v===0)).toBe(true);
  });
  it('changes upper-air transport with rotation and shades solar heating',()=>{
    const slow=cloudWind(.8,.3,.52,[1,0,0],0),fast=cloudWind(.8,.3,.52,[1,0,0],Math.PI/10);
    expect(fast).not.toEqual(slow);
    // Above the condensation range, excess vapor leaves cloud stock unchanged.
    // This isolates shading from evaporative cooling and phase-change heat.
    const clear=stateAt(220),cloudy=stateAt(220);cloudy[F.cloud]=.1;cloudy[F.vapor]=clear[F.vapor]=40;
    // Compensate thermal capacity so the difference is cloud shading, not added thermal inertia.
    clear[F.rock]=.1*4.18/.84;
    const lit={...calm,sunlight:1,sun:[...grid.directions.slice(0,3)]};react(clear,0,.1,lit,grid);react(cloudy,0,.1,lit,grid);
    expect(cloudy[F.cloud]).toBeCloseTo(.1,6);expect(cloudy[F.vapor]).toBe(40);
    expect(cloudy[F.temperature]).toBeLessThan(clear[F.temperature]);
  });
});

describe('composition-dependent atmospheric optics',()=>{
  it('has no optical atmosphere in vacuum and increases opacity with gas stock',()=>{
    const s=stateAt();expect(atmosphereOptics(atmosphereState(s,calm),calm).opacity).toBe(0);
    s[F.nitrogen]=grid.count*.3;const thin=atmosphereOptics(atmosphereState(s,calm),calm);
    s[F.nitrogen]*=4;expect(atmosphereOptics(atmosphereState(s,calm),calm).opacity).toBeGreaterThan(thin.opacity);
  });
  it('separates methane absorption from sunlight-dependent warm haze',()=>{
    const s=stateAt();for(let i=0;i<grid.count;i++)s[i*STRIDE+F.methane]=.3;
    const atmosphere=atmosphereState(s,calm),clear=atmosphereOptics(atmosphere,calm),hazy=atmosphereOptics(atmosphere,{...calm,sunlight:2});
    expect(clear.color[2]).toBeGreaterThan(clear.color[0]);expect(hazy.haze).toBeGreaterThan(clear.haze);expect(hazy.color[0]).toBeGreaterThan(clear.color[0]);
  });
});

describe('cloud save compatibility',()=>{
  it('extends legacy cells without altering any existing stock, temperature or world setting',()=>{
    const legacy:Snapshot={version:1,preset:'coast',state:Array(32).fill(0),time:123,environment:calm,supplied:5,removed:2,escaped:1,discoveries:[],spin:{angle:1,running:true,tilt:23.5,period:120}};
    for(let i=0;i<2;i++)for(let f=0;f<16;f++)legacy.state[i*16+f]=Math.fround(f===F.temperature?-5+i:f*.125+i);
    expect(validSnapshot(legacy,2)).toBe(true);const upgraded=upgradeSnapshot(legacy,2);
    expect(upgraded.version).toBe(3);expect(upgraded.state.length).toBe(2*STRIDE);expect(upgraded.time).toBe(123);expect(upgraded.spin).toEqual(legacy.spin);
    for(let i=0;i<2;i++){expect(upgraded.state.slice(i*STRIDE,i*STRIDE+16)).toEqual(legacy.state.slice(i*16,i*16+16));expect(upgraded.state[i*STRIDE+F.cloud]+upgraded.state[i*STRIDE+F.cloudIce]).toBe(0);}
    upgraded.state[F.cloud]=.1;upgraded.state[F.cloudIce]=.2;expect(validSnapshot(upgraded,2)).toBe(true);expect(upgradeSnapshot(upgraded,2).state).toEqual(upgraded.state);
  });
});
