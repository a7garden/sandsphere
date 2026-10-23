import {it,expect} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {CpuSolver,seedPlanet,F,STRIDE,COMMAND_STRIDE,totalMass,totalEnthalpy} from '../src/sim/model';
import {AIR_LAYERS,AIR_RADIUS,AIR_SECONDS} from '../src/sim/layeredAtmosphere';
const env={ambient:22,sunlight:0,sun:[1,0,0],gravity:1,rotationRate:0,climate:true};

it('converges toward the analytic smooth pressure-gradient acceleration on finer sphere grids',()=>{
 const errors=[1,2,3,4].map(level=>{
  const g=createSphere(level),s=seedPlanet(g,'sand',22),a=new CpuSolver(g,s),dt=.001;
  for(let i=0;i<g.count;i++)s[i*STRIDE+F.nitrogen]=.3*Math.exp(.05*g.directions[i*3]);
  a.climate.prepareSurface(s,env);a.climate.air.attach(s);const rt=8.314462618/.028014*(a.climate.air.temperature[0]+273.15),force=-rt*.05*dt*AIR_SECONDS/AIR_RADIUS;
  a.advance(dt,new Float32Array(g.count*COMMAND_STRIDE),env);let squared=0,reference=0;
  for(let i=0;i<g.count;i++){const n=g.directions.subarray(i*3,i*3+3),v=a.climate.air.velocity.subarray(i*AIR_LAYERS*3,i*AIR_LAYERS*3+3);for(let k=0;k<3;k++){const expected=force*((k===0?1:0)-n[0]*n[k]);squared+=(v[k]-expected)**2;reference+=expected**2;}}
  return {cells:g.count,relativeRms:Math.sqrt(squared/reference)};
 });
 console.log('sphere pressure-gradient convergence',errors);for(let k=1;k<errors.length;k++)expect(errors[k].relativeRms).toBeLessThan(errors[k-1].relativeRms);expect(errors.at(-1)!.relativeRms).toBeLessThan(.005);
});

it('runs a moist five-layer world at the production 2562-cell resolution with closed budgets',()=>{
 const g=createSphere(4),s=seedPlanet(g,'sand',22),empty=new Float32Array(g.count*COMMAND_STRIDE);
 for(let i=0;i<g.count;i++){s[i*STRIDE+F.vapor]=.001;if(g.directions[i*3+2]>0)s[i*STRIDE+F.water]=3;}
 const a=new CpuSolver(g,s),mass=totalMass(s),heat=totalEnthalpy(s),start=performance.now();let q=0,escaped=0;
 for(let k=0;k<30;k++){a.advance(1/30,empty,{...env,sunlight:1});q+=a.energyChanges.reduce((x,y)=>x+y,0);escaped+=a.escapeCells.reduce((x,y)=>x+y,0);}
 const result={cells:g.count,steps:30,elapsedMs:performance.now()-start,massResidual:totalMass(a.state)+escaped-mass,energyResidual:totalEnthalpy(a.state,a.climate)-heat-q};console.log('production layered run',result);
 expect(a.state.every(Number.isFinite)).toBe(true);expect(a.climate.air.mass.every(m=>m>=0)).toBe(true);expect(Math.abs(result.massResidual)).toBeLessThan(.005);expect(Math.abs(result.energyResidual)).toBeLessThan(.02);
},120000);
