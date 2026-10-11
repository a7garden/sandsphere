import {CpuSolver,F,STRIDE,COMMAND_STRIDE,MASS_FIELDS,seedWorld,seedPlanet,totalMass,totalEnthalpy,type Snapshot} from '../../src/sim/model';
import {createSphere} from '../../src/sim/sphere';
import {orbitalEnvironment} from '../../src/sim/orbit';
import {advanceOrbit} from '../../src/sim/system';
import {PHYSICS_DT} from '../../src/sim/clock';

export type SoakKind='coast'|'tidal'|'cold'|'dry'|'symmetric';
export function soakWorld(level:number,kind:SoakKind='coast'){
 const grid=createSphere(level),distance=kind==='cold'?1.6:1;
 const initial=kind==='dry'||kind==='symmetric'?seedPlanet(grid,'sand',22):seedWorld(grid,'coast',kind==='cold'?-12:22);
 for(let i=0;i<grid.count;i++){const p=i*STRIDE;
  if(kind==='symmetric'){for(const f of MASS_FIELDS)initial[p+f]=0;initial[p+F.rock]=8;initial[p+F.nitrogen]=.3;}
  if(kind!=='dry'&&kind!=='symmetric'){initial[p+F.water]*=2;initial[p+F.carbonDioxide]=.012;initial[p+F.vapor]=.006;initial[p+F.seed]=.08;if(initial[p+F.water]===0)initial[p+F.water]=.15;}
 }
 const solver=new CpuSolver(grid,initial);if(kind!=='dry'&&kind!=='symmetric')solver.climate.seedLife(initial);
 const snapshot:Snapshot={version:4,preset:'coast',time:0,state:[],environment:{...orbitalEnvironment(distance),climate:true,...(kind==='symmetric'?{sunlight:0}:{})},supplied:0,removed:0,discoveries:[],spin:{angle:0,running:kind!=='symmetric',locked:kind==='tidal',period:120,tilt:kind==='tidal'?0:23.5}};
 return {grid,solver,snapshot,empty:new Float32Array(grid.count*COMMAND_STRIDE),initialMass:totalMass(initial),initialHeat:totalEnthalpy(initial),escaped:0,energy:[0,0,0,0],condensation:0,rain:0,snow:0};
}
export type SoakWorld=ReturnType<typeof soakWorld>;
export function soakSnapshot(w:SoakWorld):Snapshot{return {...structuredClone(w.snapshot),state:[...w.solver.state],climate:w.solver.climate.snapshot(),escaped:w.escaped};}
export function soakStep(w:SoakWorld){
 advanceOrbit(w.snapshot,PHYSICS_DT);w.solver.advance(PHYSICS_DT,w.empty,w.snapshot.environment);
 w.escaped+=w.solver.escapeCells.reduce((a,b)=>a+b,0);w.condensation+=w.solver.condensedCells.reduce((a,b)=>a+b,0);
 for(let i=0;i<w.solver.precipitatedCells.length;i+=2){w.rain+=w.solver.precipitatedCells[i];w.snow+=w.solver.precipitatedCells[i+1];}
 for(let i=0;i<w.solver.energyChanges.length;i++)w.energy[i%4]+=w.solver.energyChanges[i];
}
export function soakMeasure(w:SoakWorld){
 const s=w.solver.state,n=w.grid.count,sums=new Float64Array(STRIDE);let minT=Infinity,maxT=-Infinity,maxWind=0,maxCurrent=0,wind2=0,current2=0,minMass=Infinity;
 const fields={water:[F.water,F.ice,F.vapor,F.cloud,F.cloudIce],gas:[F.vapor,F.nitrogen,F.methane,F.carbonDioxide],cloud:[F.cloud,F.cloudIce],plant:[F.plant]},concentration:Record<string,{maxShare:number;effectiveCells:number}>={};
 for(let i=0;i<n;i++){const p=i*STRIDE,t=s[p+F.temperature];minT=Math.min(minT,t);maxT=Math.max(maxT,t);for(const f of MASS_FIELDS){sums[f]+=s[p+f];minMass=Math.min(minMass,s[p+f]);}const v=Math.hypot(...w.solver.climate.wind.subarray(i*3,i*3+3)),u=Math.hypot(...w.solver.climate.currents.subarray(i*3,i*3+3));maxWind=Math.max(maxWind,v);maxCurrent=Math.max(maxCurrent,u);wind2+=v*v;current2+=u*u;}
 for(const [name,list] of Object.entries(fields)){let sum=0,square=0,max=0;for(let i=0;i<n;i++){let mass=0;for(const f of list)mass+=s[i*STRIDE+f];sum+=mass;square+=mass*mass;max=Math.max(max,mass);}concentration[name]={maxShare:sum?max/sum:0,effectiveCells:square?sum*sum/square:0};}
 const heat=totalEnthalpy(s),mass=totalMass(s);
 return {time:w.snapshot.time,cells:n,minT,maxT,meanT:Array.from({length:n},(_,i)=>s[i*STRIDE+F.temperature]).reduce((a,b)=>a+b,0)/n,minMass,maxWind,maxCurrent,windRms:Math.sqrt(wind2/n),currentRms:Math.sqrt(current2/n),stocks:Object.fromEntries(Object.entries(F).filter(([name])=>name!=='temperature'&&name!=='firing').map(([name,f])=>[name,sums[f]])),concentration,condensation:w.condensation,rain:w.rain,snow:w.snow,escaped:w.escaped,energy:[...w.energy],massResidual:mass+w.escaped-w.initialMass,massRelative:Math.abs(mass+w.escaped-w.initialMass)/w.initialMass,energyResidual:heat-w.initialHeat-w.energy.reduce((a,b)=>a+b,0),energyRelative:Math.abs(heat-w.initialHeat-w.energy.reduce((a,b)=>a+b,0))/Math.max(1,Math.abs(heat),Math.abs(w.initialHeat),Math.abs(w.energy.reduce((a,b)=>a+b,0))),finite:s.every(Number.isFinite)&&w.solver.climate.wind.every(Number.isFinite)&&w.solver.climate.currents.every(Number.isFinite)};
}
