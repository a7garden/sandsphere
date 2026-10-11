import {LayeredAtmosphere,AIR_Z,AIR_DZ,AIR_LAYERS,AIR_SECONDS,COLUMN_KG,surfaceEnthalpy} from '../../src/sim/layeredAtmosphere';
import {radiativeFluxes} from '../../src/sim/climatePhysics';
import {F,STRIDE} from '../../src/sim/model';
import {type SphereGrid} from '../../src/sim/sphere';

/** Production browser kernel, pure reusable real-time benchmark. */
export function runRceExperiment(sst:295|300|305,progress?:(day:number,drift:number)=>void,days=1000){
 const grid:SphereGrid={count:1,directions:new Float32Array([1,0,0]),indices:new Uint32Array(),geometry:new Float32Array(4),neighbors:new Uint32Array(),distances:new Float32Array()},state=new Float32Array(STRIDE),air=new LayeredAtmosphere(grid,[],30),temperature=sst-273.15,solar=551.58*Math.cos(42.05*Math.PI/180),env={ambient:temperature,sunlight:1,sun:[solar/1361,0,0],gravity:1,climate:true},boundary={temperature,albedo:.07,windSpeed:5,ozone:'rcemip' as const};
 state[F.water]=1;state[F.nitrogen]=.3;state[F.temperature]=temperature;air.initialize(state,env);
 const q0=sst===295?.012:sst===300?.01865:.024,tv0=sst*(1+.608*q0),tvt=tv0-.0067*15000;
 const pressure=(z:number):number=>z<=15000?101480*((tv0-.0067*z)/tv0)**(9.81/(287.04*.0067)):pressure(15000)*Math.exp(-9.81*(z-15000)/(287.04*tvt));
 const edges=[0,...AIR_Z.map((z,k)=>z+AIR_DZ[k]/2)];
 for(let k=0;k<AIR_LAYERS;k++){
  const z=AIR_Z[k],q=z<15000?q0*Math.exp(-z/4000-(z/7500)**2):1e-14,mass=(pressure(edges[k])-(k===AIR_LAYERS-1?0:pressure(edges[k+1])))/(9.81*COLUMN_KG),co2=(1-q)*348e-6*.04401/.028014;
  const methane=(1-q)*1650e-9*.016043/.028014;
  air.mass.fill(0,k*6,k*6+6);air.mass[k*6]=mass*q;air.mass[k*6+1]=mass*(1-q-co2-methane);air.mass[k*6+2]=mass*methane;air.mass[k*6+3]=mass*co2;air.temperature[k]=(tv0-.0067*Math.min(15000,z))/(1+.608*q)-273.15;
 }
 air.attach(state);state[F.temperature]=temperature;
 const initialDryMass=AIR_Z.map((_,k)=>air.mass[k*6+1]+air.mass[k*6+2]+air.mass[k*6+3]);
 const initialHeat=surfaceEnthalpy(state,0)+air.totalEnergy(),energy=new Float32Array(4),rain=new Float32Array(2),samples:{day:number;temperature:number[];dailyMaximumTemperatureChangeK:number;precipitationMmDay:number;olrWm2:number;toaNetWm2:number;airRadiativeHeatingWm2:number;cloudWaterPathKgM2:number}[]=[],start=performance.now();let heat=0,precipitation=0;
 for(let day=1;day<=days;day++){
  const old=air.temperature.slice();let dailyRain=0;
  for(let minute=0;minute<48;minute++){
   energy.fill(0);rain.fill(0);air.advance(state,1800/AIR_SECONDS,env,energy,undefined,rain,undefined,boundary);heat+=energy.reduce((a,b)=>a+b,0);dailyRain+=(rain[0]+rain[1])*COLUMN_KG;
  }
  precipitation+=dailyRain;const flux=radiativeFluxes(air.radiationColumn(state,0,env,undefined,boundary.albedo,boundary.ozone)),drift=Math.max(...air.temperature.map((t,k)=>Math.abs(t-old[k])));
  samples.push({day,temperature:[...air.temperature],dailyMaximumTemperatureChangeK:drift,precipitationMmDay:dailyRain,olrWm2:flux.olr,toaNetWm2:flux.toaNet,airRadiativeHeatingWm2:flux.heating.reduce((a,b)=>a+b,0),cloudWaterPathKgM2:(state[F.cloud]+state[F.cloudIce])*COLUMN_KG});
  if(day%100===0)progress?.(day,drift);
 }
 const final=samples.at(-1)!,means=(low:number,high:number)=>AIR_Z.map((_,k)=>samples.slice(low,high).reduce((sum,row)=>sum+row.temperature[k],0)/(high-low)),early=means(800,900),late=means(900,1000),windowDrift=Math.max(...late.map((v,k)=>Math.abs(v-early[k]))),result={status:'RCEMIP-boundary-experiment-not-compliant',configuration:{days,averagingDays:200,sstK:sst,maximumStepSeconds:30,windSpeedMS:5,solarWm2:solar,albedo:.07,co2Ppm:348,ch4Ppb:1650,n2oPpb:306,radiation:'ecCKD 32x32 with Mie/Baum clouds and diffuse solar approximation',radiationMaximumIntervalSeconds:300,convection:'enthalpy/composition entraining buoyancy with dry-air-mass compensated layer exchange',microphysics:'KK warm autoconversion (Nc=100/cm3), Kessler accretion, Lin ice aggregation, diagnostic rain/snow with evaporation/sublimation/melt; residual Stokes ice',cloudOverlap:'maximum-random',initialSounding:'Wing et al. 2018 analytic tropical sounding sampled at 11 centers to 42 km'},elapsedSeconds:(performance.now()-start)/1000,precipitationMm:precipitation,energyResidual:surfaceEnthalpy(state,0)+air.totalEnergy()-initialHeat-heat,stationarity:{projectToleranceKPerDay:.01,passed:days>=1000&&windowDrift<.2,maximum100DayMeanTemperatureDifferenceK:windowDrift,projectWindowToleranceK:.2,finalMaximumTemperatureChangeKPerDay:final.dailyMaximumTemperatureChangeK},protocolDeviations:['Representative-height coordinates with only 11 layers; no vertical-grid convergence','Prescribed Wing ozone/N2O and zero CFC; no atmospheric chemistry', 'Diffuse two-stream solar approximation, not ecRad direct-beam transfer', 'No prognostic rain/snow growth distribution','Air composition uses N2 proxy rather than dry-air EOS','Representative height/pressure coordinates; no vertical-grid convergence','No RCEMIP ensemble output comparison; this is a column development experiment'],dryMassDrift:{initialKgM2:initialDryMass.map(v=>v*COLUMN_KG),finalKgM2:AIR_Z.map((_,k)=>(air.mass[k*6+1]+air.mass[k*6+2]+air.mass[k*6+3])*COLUMN_KG),maximumRelative:Math.max(...AIR_Z.map((_,k)=>Math.abs(air.mass[k*6+1]+air.mass[k*6+2]+air.mass[k*6+3]-initialDryMass[k])/Math.max(1e-20,initialDryMass[k])))},finalLayers:AIR_Z.map((height,k)=>({height,temperature:air.temperature[k],liquidKgM2:air.mass[k*6+4]*COLUMN_KG,iceKgM2:air.mass[k*6+5]*COLUMN_KG,cloudFraction:air.layerCloudFraction(0,k)})),samples};
 if(!air.mass.every(m=>Number.isFinite(m)&&m>=0))throw Error('Nonfinite RCE mass');
 return result;
}
