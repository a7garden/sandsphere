import {createServer} from 'vite';
import {writeFile} from 'node:fs/promises';
import {root,sourceManifest} from './source-manifest.mjs';

// Solver-only audit. Never reads saved worlds, inventory or browser storage.
const server=await createServer({root,server:{middlewareMode:true},appType:'custom'});
try {
  const M=await server.ssrLoadModule('/src/sim/model.ts');
  const S=await server.ssrLoadModule('/src/sim/sphere.ts');
  const E=await server.ssrLoadModule('/src/sim/ecology.ts');
  const C=await server.ssrLoadModule('/src/sim/clouds.ts');
  const grid=S.createSphere(4),commands=new Float32Array(grid.count*M.COMMAND_STRIDE);
  const fresh=t=>{const s=new Float32Array(grid.count*M.STRIDE);for(let i=0;i<grid.count;i++)s[i*M.STRIDE+M.F.temperature]=t;return s;};
  const env=(t,gravity=3)=>({ambient:t,sunlight:0,sun:[1,0,0],gravity});
  const set=(s,values)=>{for(const [name,v] of Object.entries(values))s[M.F[name]]=v;return s;};
  const fields=(s,names)=>Object.fromEntries(names.map(name=>[name,s[M.F[name]]]));
  // Constant-cp reference consistent with pure-water phase changes in the engine.
  // Glass and ceramic references are UNDEFINED by the engine: do not infer their measured enthalpies.
  const energy=s=>{let h=0;for(let i=0;i<grid.count;i++){const p=i*M.STRIDE;h+=M.capacity(s,i)*s[p+M.F.temperature]+2475*s[p+M.F.vapor]-334*(s[p+M.F.ice]+s[p+M.F.cloudIce]);}return h;};
  const results={};

  results.brineFreeze=[0,.36,2].map(dissolved=>{
    const s=set(fresh(-10),{water:10,dissolved}),before=energy(s),tf=M.freezingPoint(10,dissolved);
    M.react(s,0,0,env(-10),grid);
    return {dissolved,dt:0,initialFreezingPoint:tf,...fields(s,['water','ice','dissolved','temperature']),finalFreezingPoint:M.freezingPoint(s[M.F.water],s[M.F.dissolved]),energyResidual:energy(s)-before,predictedReferenceResidual:-s[M.F.ice]*2.08*tf};
  });
  results.boilingBoundary=[99.9,100,100.1,120].map(t=>{
    const s=set(fresh(t),{water:10});M.react(s,0,1/30,env(t),grid);
    return {initialTemperature:t,dt:1/30,...fields(s,['water','vapor','cloud','temperature'])};
  });
  results.pause={};
  for(const [name,t,values] of [['boiling',120,{water:10}],['crystallization',20,{dissolved:1}],['freeze',-10,{water:10}]]){
    const s=set(fresh(t),values);M.react(s,0,0,env(t),grid);
    results.pause[name]={dt:0,...fields(s,['water','ice','vapor','salt','dissolved','temperature'])};
  }
  {
    const s=set(fresh(.1),{cloudIce:10,vapor:M.saturation(.1-C.CLOUD_COOLING)}),before=energy(s),precip=new Float32Array(grid.count*2);
    M.react(s,0,1/30,env(.1),grid,undefined,undefined,precip);
    results.precipitationBoundary={initialTemperature:.1,initialCloudIce:10,dt:1/30,...fields(s,['water','ice','cloudIce','vapor','temperature']),rainDiagnostic:precip[0],snowDiagnostic:precip[1],energyResidual:energy(s)-before};
  }
  {
    const s=set(fresh(-1),{water:10,dissolved:.36,cloud:1,vapor:M.saturation(-1-C.CLOUD_COOLING)});
    M.react(s,0,1/30,env(-1),grid);
    results.brineRain={initialTemperature:-1,initialFreezingPoint:M.freezingPoint(10,.36),dt:1/30,...fields(s,['water','ice','dissolved','temperature']),finalFreezingPoint:M.freezingPoint(s[M.F.water],s[M.F.dissolved])};
  }
  {
    const s=set(fresh(1000),{clay:1,firing:29}),cmd=new Float32Array(commands.length);
    cmd[M.COMMAND_FIELD.clay]=100;cmd[4]=100*(1000-20);
    M.applyCommand(s,0,cmd);const afterInput=fields(s,['clay','firing','temperature']);
    M.react(s,0,1,env(1000),grid);
    results.freshClayHistory={initialClay:1,initialFiring:29,addedClay:100,externalHeat:98000,dt:1,afterInput,...fields(s,['clay','ceramic','firing','temperature'])};
  }
  results.foodWebExtreme=[-100,22,1000].map(t=>{
    const suitability=E.habitat(t,.2,0,0,1),before=[10,10,2,1],after=E.foodWeb(...before,suitability,1);
    return {temperature:t,suitability,dt:1,before,after,biomassResidual:after.reduce((a,b)=>a+b,0)-23};
  });
  {
    const s=fresh(-20);for(let i=0;i<grid.count;i++)s[i*M.STRIDE+M.F.vapor]=M.saturation(-20-C.CLOUD_COOLING);s[M.F.cloudIce]=1;
    const before=energy(s),mass=M.totalMass(s),solver=new M.CpuSolver(grid,s);
    solver.advance(.1,commands,env(-20));
    results.cloudIceTransport={dt:.1,energyResidual:energy(solver.state)-before,massResidual:M.totalMass(solver.state)-mass,sourceCloudIce:solver.state[M.F.cloudIce],totalCloudIce:M.totals(solver.state)[M.F.cloudIce]};
  }
  {
    const s=set(fresh(20),{nitrogen:100}),before=energy(s);
    M.react(s,0,1,env(20,.03),grid);
    const removed=100-s[M.F.nitrogen];
    results.escapeEnergy={dt:1,gravity:.03,removed,temperature:s[M.F.temperature],energyChange:energy(s)-before,predictedMeanEnthalpyChange:-removed*1.04*20};
  }
  results.phaseCoverage=[['glass',1900],['iron',2000],['ceramic',2000],['salt',1000]].map(([material,t])=>{
    const s=set(fresh(t),{[material]:10});M.react(s,0,1,env(t),grid);
    return {material,initialTemperature:t,dt:1,...fields(s,[material,'molten','dissolved','temperature'])};
  });
  {
    const s=set(fresh(1000),{clay:10,firing:29.9}),before=M.capacity(s,0)*1000;
    M.react(s,0,.2,env(1000),grid);
    results.ceramicSensibleHeat={dt:.2,...fields(s,['clay','ceramic','temperature']),sensibleHeatChange:M.capacity(s,0)*s[M.F.temperature]-before};
  }
  results.cloudPhasePolicy=[-1,1,12.5,14.5].map(t=>{
    const s=set(fresh(t),{cloudIce:.09,vapor:M.saturation(t-C.CLOUD_COOLING)});
    M.react(s,0,1/30,env(t),grid);
    return {initialColumnTemperature:t,initialDiagnosticAirTemperature:t-C.CLOUD_COOLING,...fields(s,['cloud','cloudIce','temperature'])};
  });
  results.rotationSign={positive:C.cloudWind(.8,.6,0,[1,0,0],.05),negative:C.cloudWind(.8,.6,0,[1,0,0],-.05)};
  {
    const source=set(fresh(20),{water:1000}),runs=[];
    for(const dt of [4/30,.8,1/30,1/60,1/120]){
      const solver=new M.CpuSolver(grid,new Float32Array(source)),steps=Math.round(4/dt);
      for(let n=0;n<steps;n++)solver.advance(dt,commands,env(20));
      runs.push({dt,steps,elapsed:steps*dt,waterAtSource:solver.state[M.F.water],totalMass:M.totalMass(solver.state)});
    }
    results.stepSensitivity=runs;
  }
  const evidence={...await sourceManifest(['src/sim/atmosphere.ts','src/sim/orbit.ts','src/sim/meteor.ts','src/sim/storage.ts','src/sim/optics.ts']),gridCount:grid.count,units:'game mass, °C, game seconds; energy in constant-cp game units',conditions:{reactionIsolation:'Ambient equals initial temperature and sunlight=0 to suppress external thermal forcing. High ambient values are solver-only isolation, outside normal UI range.',energyReference:{water:0,ice:-334,cloud:0,cloudIce:-334,vapor:2475,baseCapacity:28},limitations:'CPU numerical probes; WGSL inspected statically, not executed on a GPU. No measured materials calibration or player incidence estimate.'},results};
  await writeFile(new URL('./cell-condition-evidence.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
} finally {await server.close();}
