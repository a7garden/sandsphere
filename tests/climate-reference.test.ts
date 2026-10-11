import {it,expect} from 'vitest';
import {writeFileSync,mkdirSync} from 'node:fs';
import reference from './fixtures/nasa-power-climatology.json';
import {LayeredAtmosphere,AIR_LAYERS,AIR_SECONDS,AIR_Z,COLUMN_KG,CLOUD_VISIBLE_MASS,surfaceEnthalpy} from '../src/sim/layeredAtmosphere';
import {radiativeFluxes,STEFAN_BOLTZMANN} from '../src/sim/climatePhysics';
import {F,STRIDE} from '../src/sim/model';
import {saturationPressure} from '../src/sim/waterPhysics';
import {type SphereGrid} from '../src/sim/sphere';

const grid:SphereGrid={count:1,directions:new Float32Array([1,0,0]),indices:new Uint32Array(),geometry:new Float32Array([1,0,0,0]),neighbors:new Uint32Array(),distances:new Float32Array()};
const months=[31,28.25,31,30,31,30,31,31,30,31,30,31];
function metric(samples:{observed:number;model:number;weight:number}[]){
 const weight=samples.reduce((a,b)=>a+b.weight,0),mean=(key:'observed'|'model')=>samples.reduce((a,b)=>a+b[key]*b.weight,0)/weight,obs=mean('observed'),model=mean('model');
 let covariance=0,vo=0,vm=0,bias=0,square=0;
 for(const s of samples){const d=s.model-s.observed;bias+=d*s.weight;square+=d*d*s.weight;covariance+=(s.observed-obs)*(s.model-model)*s.weight;vo+=(s.observed-obs)**2*s.weight;vm+=(s.model-model)**2*s.weight;}
 return {samples:samples.length,observedSampleMean:obs,modelSampleMean:model,bias:bias/weight,rmse:Math.sqrt(square/weight),correlation:vo*vm>0?covariance/Math.sqrt(vo*vm):null};
}
function column(ts:number,ta:number,rh:number,ps:number,lapse=6.5){
 const state=new Float32Array(STRIDE);state[F.temperature]=ts;state[F.water]=.02;state[F.nitrogen]=ps*1000/(9.81*COLUMN_KG);state[F.carbonDioxide]=state[F.nitrogen]/.028014*.04401*400e-6;
 const air=new LayeredAtmosphere(grid,[]),env={ambient:ta,sunlight:1,sun:[1,0,0],gravity:1,climate:true};air.initialize(state,env);
 // Synthetic vertical profiles. Observations supply surface values only;
 // this assumption is reported, never called an observed sounding.
 for(let k=0;k<AIR_LAYERS;k++){
  air.temperature[k]=Math.max(-150,ta-lapse*Math.min(AIR_Z[k],11000)/1000+.001*Math.max(0,AIR_Z[k]-20000));
  const moles=air.mass[k*6+1]/.028014+air.mass[k*6+3]/.04401,es=saturationPressure(air.temperature[k],air.temperature[k]<0?'ice':'water'),partial=es*rh/100,p=air.pressure(0,k);
  air.mass[k*6]=partial<p?.018015*moles*partial/(p-partial):0;
 }
 air.attach(state);return {state,air,env};
}

it('compares the actual radiation kernel with monthly NASA retrievals and reports profile sensitivity',()=>{
 expect(reference.points).toHaveLength(24);expect(reference.period).toEqual([2001,2020]);
 expect(reference.units.TS).toBe('C');expect(reference.units.PRECTOTCORR).toBe('mm/day');expect(reference.units.CLOUD_AMT).toBe('%');
 const sensitivity=[4,6.5,9].map(lapse=>{
  const lw:{observed:number;model:number;weight:number}[]=[],temperature:typeof lw=[];
  for(const point of reference.points)for(let month=0;month<12;month++){
   const v=point.values,c=column(v.TS[month],v.T2M[month],v.RH2M[month],v.PS[month],lapse),flux=radiativeFluxes(c.air.radiationColumn(c.state,0,c.env,0)),weight=Math.cos(point.latitude*Math.PI/180)*months[month];
   // POWER irradiance is daily kWh/m² -> mean W/m²; not an instantaneous noon flux.
   lw.push({observed:v.CLRSKY_SFC_LW_DWN[month]*1000/24,model:flux.down[0],weight});
   const absorbedSolar=v.ALLSKY_SFC_SW_DWN[month]*1000/24*.85;
   temperature.push({observed:v.TS[month],model:((absorbedSolar+flux.down[0])/STEFAN_BOLTZMANN)**.25-273.15,weight});
  }
  return {lapseKPerKm:lapse,clearSkyDownwardLongwaveWm2:metric(lw),conditionalSurfaceRadiativeBalanceC:metric(temperature),samples:{longwave:lw,conditionalTemperature:temperature}};
 });
 expect(sensitivity.every(s=>Number.isFinite(s.clearSkyDownwardLongwaveWm2.rmse))).toBe(true);
 mkdirSync('artifacts/climate-reference',{recursive:true});
 writeFileSync('artifacts/climate-reference/radiation-observations.json',JSON.stringify({period:reference.period,points:24,monthlySamples:288,sensitivity,status:'diagnostic-only',assumptions:['synthetic constant-RH sounding','surface balance uses observed solar irradiance and albedo 0.15','no sensible/latent/ocean flux in conditional temperature','not a coupled climate prediction','24 sampled points do not form a global map']},null,2));
 console.log('NASA monthly radiation comparison',sensitivity.map(({samples,...metrics})=>metrics));
});

it('audits one-day production column temperature, precipitation and cloud occurrence against annual reference values',()=>{
 const duration=86400,rows=[],start=performance.now();
 for(const point of reference.points){
  const annual=(key:keyof typeof point.values)=>point.values[key].reduce((a,b,k)=>a+b*months[k],0)/365.25,c=column(annual('TS'),annual('T2M'),annual('RH2M'),annual('PS')),energy=new Float32Array(4),rain=new Float32Array(2),escape=new Float32Array(4);
  // Annual-mean Frierson forcing, not the API solar surface flux. Clear
  // latitudinal forcing is independent of the observed cloud/rain targets.
  const sine=Math.sin(point.latitude*Math.PI/180),solar=1361/4*(1+1.4*(1-3*sine*sine)/4);c.env.sun=[solar/1361,0,0];
  const initialEnergy=surfaceEnthalpy(c.state,0)+c.air.totalEnergy();
  let precipitation=0,cloudySeconds=0,temperatureSum=0,q=0;
  for(let second=0;second<duration;second+=60){
   energy.fill(0);rain.fill(0);escape.fill(0);c.air.advance(c.state,60/AIR_SECONDS,c.env,energy,undefined,rain,escape);
   precipitation+=(rain[0]+rain[1])*COLUMN_KG;q+=energy.reduce((a,b)=>a+b,0);
   cloudySeconds+=60*c.air.cloudFraction(0);
   temperatureSum+=c.state[F.temperature]*60;
  }
  const surfaceEnergy=surfaceEnthalpy(c.state,0);
  expect(c.air.mass.every(m=>m>=0&&Number.isFinite(m))).toBe(true);expect(c.air.temperature.every(Number.isFinite)).toBe(true);
  rows.push({latitude:point.latitude,longitude:point.longitude,weight:Math.cos(point.latitude*Math.PI/180),temperature:{observed:annual('TS'),model:temperatureSum/duration},precipitation:{observed:annual('PRECTOTCORR'),model:precipitation*86400/duration},cloud:{observed:annual('CLOUD_AMT'),model:100*cloudySeconds/duration},energyResidual:surfaceEnergy+c.air.totalEnergy()-initialEnergy-q});
 }
 const comparison={temperatureC:metric(rows.map(r=>({...r.temperature,weight:r.weight}))),precipitationMmDay:metric(rows.map(r=>({...r.precipitation,weight:r.weight}))),cloudFractionPercent:metric(rows.map(r=>({...r.cloud,weight:r.weight})))};
 const result={status:'not-validated',durationSeconds:duration,elapsedSeconds:(performance.now()-start)/1000,comparison,rows,climateAcceptance:{passed:false,reasons:['Only one transient day, initialized with reference means; no spin-up or climatological averaging','Independent wet columns omit horizontal dynamics and real land/ocean boundary conditions','Statistical subgrid cloud area now matches the comparison variable, but cloud closure is not independently validated','500-m air layer cannot validate 2-m temperature','The browser core has not undergone Held–Suarez; benchmarks of a separate Julia reference solver do not validate this core']},targets:{description:'Provisional project targets, not published benchmark tolerances',surfaceTemperatureRmseC:3,precipitationRmseMmDay:1,cloudFractionRmsePercentagePoints:15}};
 mkdirSync('artifacts/climate-reference',{recursive:true});writeFileSync('artifacts/climate-reference/column-observations.json',JSON.stringify(result,null,2));
 console.log('NASA one-day column audit',comparison,`(${result.elapsedSeconds.toFixed(1)}s)`);
},300000);
