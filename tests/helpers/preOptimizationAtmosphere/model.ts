// @ts-nocheck -- immutable pre-optimization fixture; production nominal types may evolve.
// Only import paths differ; normalize them to verify the original captured source SHA-256.
import {assertFiniteStepOutputs} from './physicalState';
import type {PhysicalState} from './physicalState';
export type {PhysicalState} from './physicalState';
import {admitLocalChange,type LocalMechanics} from './mechanicalBoundary';
import {oceanEnergy} from './oceanDynamics';
import {solidThickness} from './solidMechanics';
import {SOOT,particleSettlingSpeed} from './aerosolPhysics';
import {roundedSurfaceStock} from './co2Ice';
import {stoichiometricReaction,reactInventory} from './materialReaction';
import {WeatherClimate,pioneerRootability,type ClimateSnapshot} from './weatherClimate';
import {bathHeat,absorbedSolarHeat} from './climate';
import {habitat,consumerHabitat,reactEcosystem,openSurfaceWater} from './ecology';
import {AnimalNavigation} from './animalNavigation';
import { HEIGHT_SCALE, INVALID, NEIGHBORS, type SphereGrid } from './sphere';
import {GASES,thermalEscapeFraction} from './gases';
import {cloudEdgeFraction,RAIN_THRESHOLD,SNOW_THRESHOLD} from './clouds';
import {columnPressure,saturationMass,boilingPoint,waterActivity,type WaterPhase} from './waterPhysics';
import {albedo,transmittedLight,conductivity,pairConductance,edgeScale,meltMobility,GLASS_SOFTENING} from './materialPhysics';
import {physicsSteps} from './clock';
import {airMassWidth,AIR_FIELDS,AIR_LAYERS,LEGACY_AIR_LAYERS,AIR_Z,ATMOSPHERE_MIRRORS,type LayeredAtmosphere} from './layeredAtmosphere';
import {BASE_CAPACITY,SPECIFIC_HEAT,MATERIAL_ENERGY,SUPPLY_TEMPERATURE,ENERGY_CHANNELS,phaseChangeEnergy,thermalEnergy,MIN_THERMODYNAMIC_TEMPERATURE,assertThermodynamicTemperature,writeFloat32ThermalEnergy} from './thermodynamics';
import {assertPlanetSupport,isDeepAtmosphere,physicalRadius as planetRadius,type PlanetDefinition} from './planetDefinition';
import {deepSnapshotEnergy,deepSnapshotMass,deepMassWidth,hasDeepGas} from './deepAtmosphere';
import {DEEP_FIELDS} from './giantCloudPhysics';

export const STRIDE = 40;
export const COMMAND_STRIDE = 20;
/** Command slot 7 limits erasure to editable surface matter. Zero keeps legacy whole-cell erasure. */
export const SURFACE_ERASE = 7;
export const F = {
  sand:0, clay:1, ceramic:2, glass:3, water:4, ice:5, salt:6,
  dissolved:7, temperature:8, vapor:9, firing:10, molten:11, rock:12,
  nitrogen:13, methane:14, carbonDioxide:15, cloud:16, cloudIce:17, soil:18, plant:19, herbivore:20, carnivore:21, iron:22, seed:23,
  carbonDioxideIce:24, surfaceDust:25, airborneDust:26, oxygen:27, photonEnergy:33, charcoal:34, carbonMonoxide:35, soot:36,
  hydrogen:28,helium:29,
  ammonia:30,ammoniaCloud:31,ammoniaIce:32,
} as const;
const EVAPORATE_WATER=stoichiometricReaction([[F.water,1]],[[F.vapor,1]]);
const FIRE_CLAY=stoichiometricReaction([[F.clay,1]],[[F.ceramic,1]]);
const MELT_SAND=stoichiometricReaction([[F.sand,1]],[[F.molten,1]]);
const SOFTEN_GLASS=stoichiometricReaction([[F.glass,1]],[[F.molten,1]]);
const SETTLE_SOOT=stoichiometricReaction([[F.soot,1]],[[F.charcoal,1]],{exactTransfer:true});
const SOLIDIFY_GLASS=stoichiometricReaction([[F.molten,1]],[[F.glass,1]]);
export const SURFACE_ERASE_FIELDS = [F.sand,F.clay,F.ceramic,F.glass,F.water,F.ice,F.salt,F.dissolved,F.molten,F.soil,F.plant,F.herbivore,F.carnivore,F.iron,F.seed,F.carbonDioxideIce,F.surfaceDust,F.charcoal];
export const PRODUCTS=['ice','ceramic','glass','plant','herbivore','carnivore','iron'] as const;
export type Product=typeof PRODUCTS[number];
export type Stock=Record<Product,number>;
export const emptyStock=():Stock=>({ice:0,ceramic:0,glass:0,plant:0,herbivore:0,carnivore:0,iron:0});
export const isProduct=(id:string):id is Product=>(PRODUCTS as readonly string[]).includes(id);
export type SurfaceMaterial = 'sand' | 'water' | 'clay' | 'salt' | 'soil' | Product;
export const SURFACE_MATERIALS:SurfaceMaterial[]=['sand','water','clay','salt','soil',...PRODUCTS];
export type GasMaterial = 'nitrogen' | 'methane' | 'carbonDioxide' | 'oxygen';
export type Material = SurfaceMaterial | GasMaterial;
export const COMMAND_FIELD:Record<Material,number> = {water:0,sand:1,clay:2,salt:3,nitrogen:8,methane:9,carbonDioxide:10,oxygen:11,ice:12,ceramic:13,glass:14,soil:15,plant:16,herbivore:17,carnivore:18,iron:19};
export const isGas = (material:Material):material is GasMaterial => ['nitrogen','methane','carbonDioxide','oxygen'].includes(material);
export type Tool = 'observe' | 'pour' | 'heat' | 'cool' | 'erase' | 'collect' | 'orbit' | 'meteor';
export type Preset = 'coast' | 'winter' | 'kiln';
export type PlanetMaterial = 'rock' | 'sand' | 'clay' | 'water' | 'ice';
export interface Environment { ambient:number; sunlight:number; sun:readonly number[]; gravity?:number; orbitDistance?:number; rotationRate?:number; orbitAngle?:number; climate?:boolean; body?:PlanetDefinition; }
export interface Snapshot {
  version:1|2|3|4|5|6|7|8|9|10|11; preset:Preset; time:number; state:number[]; discoveries:string[];
  environment:Environment; supplied:number; removed:number;
  savedAt?:number;
  planet?:{primary:PlanetMaterial};
  escaped?:number;
  transferredIn?:number;
  transferredOut?:number;
  paused?:boolean;
  spin?:{angle:number;running:boolean;locked?:boolean;tilt?:number;period?:number;azimuth?:number;elevation?:number};
  climate?:ClimateSnapshot;
  weather?:{kind:'rain'|'cold'|'warm';remaining:number;duration:number;ambient:number;sunlight:number;direction:number[]};
}
export const DEFAULT_ENVIRONMENT:Environment = {ambient:18,sunlight:1,sun:[-0.65,0.72,0.35],gravity:1};
export const MASS_FIELDS = [0,1,2,3,4,5,6,7,9,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,34,35,36];
const GAS_FIELDS = [...GASES.map(g=>g.field),F.soot];
const CP = SPECIFIC_HEAT;
export const gravityMultiplier = (e:Environment) => e.gravity??1;
export const WATER_LATENT = phaseChangeEnergy(F.water,F.vapor,100);
export const ICE_LATENT = MATERIAL_ENERGY[F.water]-MATERIAL_ENERGY[F.ice];
const VAPOR_OFFSET=MATERIAL_ENERGY[F.vapor]-MATERIAL_ENERGY[F.water];
const SUBLIMATION_OFFSET=MATERIAL_ENERGY[F.vapor]-MATERIAL_ENERGY[F.ice];
const VAPORIZATION_CP=SPECIFIC_HEAT[F.vapor]-SPECIFIC_HEAT[F.water];

export function capacity(state:PhysicalState,i:number) {
  const p=i*STRIDE;
  if(state[p+F.hydrogen]+state[p+F.helium]>0)return DEEP_FIELDS.reduce((c,f)=>c+state[p+f]*CP[f],0);
  let c=BASE_CAPACITY;
  for(let f=0;f<CP.length;f++) c+=state[p+f]*CP[f];
  return c;
}
/** Historical API name: includes phase AND chemical material potentials. */
export function phaseEnergy(state:PhysicalState,i:number){const p=i*STRIDE;let h=state[p+F.photonEnergy];for(const f of MASS_FIELDS)h+=state[p+f]*MATERIAL_ENERGY[f];return h;}
export function enthalpy(state:PhysicalState,i:number){return thermalEnergy(capacity(state,i),state[i*STRIDE+F.temperature],phaseEnergy(state,i));}
export function totalEnthalpy(state:PhysicalState,climate?:ClimateSnapshot|WeatherClimate){
 if(climate instanceof WeatherClimate&&climate.giant.ready)return climate.giant.totalEnergy();
 if(climate&&!(climate instanceof WeatherClimate)&&climate.giant)return deepSnapshotEnergy(climate.giant);
 if(climate instanceof WeatherClimate)return climate.energy(state);
 if(state instanceof Float32Array&&climate?.surfaceMassCarry){const physical=new Float64Array(state);for(let p=0;p<physical.length;p+=STRIDE)for(const f of MASS_FIELDS)physical[p+f]+=climate.surfaceMassCarry[p+f];state=physical;}
 let h=0;for(let i=0;i<state.length/STRIDE;i++)h+=enthalpy(state,i);
 const a=climate&&!(climate instanceof WeatherClimate)?climate.atmosphere:undefined;
 if(a)for(let i=0;i<state.length/STRIDE;i++){const layers=a.version===1?LEGACY_AIR_LAYERS:AIR_LAYERS,width=airMassWidth(a);let actual=0;for(let k=0;k<layers;k++){const q=i*layers+k;let m=0,c=0,phase=0;for(let f=0;f<width;f++){const mass=a.mass[q*width+f];m+=mass;c+=mass*CP[AIR_FIELDS[f]];phase+=mass*MATERIAL_ENERGY[AIR_FIELDS[f]];}const dust=a.dustMass?.[q]??0;m+=dust;c+=dust*CP[F.airborneDust];const v=q*3;actual+=c*a.temperature[q]+phase+m*(9.81*AIR_Z[k]*(a.geometryScale??1)+.5*(a.velocity[v]**2+a.velocity[v+1]**2+a.velocity[v+2]**2))/1000;}const p=i*STRIDE;h+=actual+(a.surfaceHeatCarry?.[i]??0)-ATMOSPHERE_MIRRORS.reduce((sum,f)=>sum+state[p+f]*(CP[f]*state[p+F.temperature]+MATERIAL_ENERGY[f]),0);}
 if(climate&&!(climate instanceof WeatherClimate)&&!a&&climate.surfaceHeatCarry)for(const heat of climate.surfaceHeatCarry)h+=heat;
 if(climate&&!(climate instanceof WeatherClimate)&&climate.ocean)h+=oceanEnergy(climate.ocean);
 return h;
}

/** Fast-mixed liquid/ice/salt equilibrium at conserved column enthalpy.
 * Salt partitions reversibly at the game solubility limit; no brine EOS is claimed.
 * Solve liquid mass directly and use the saturated-brine limit at zero liquid. */
export type SurfaceThermal=Pick<LayeredAtmosphere,'surfaceEnergy'|'setSurfaceEnergy'|'surfaceTemperature'|'surfaceCapacity'|'surfacePhaseEnergy'>;
export function equilibrateWater(s:PhysicalState,i:number,mechanics?:LocalMechanics,thermal?:SurfaceThermal){
  const p=i*STRIDE,total=s[p+F.water]+s[p+F.ice],salt=s[p+F.salt]+s[p+F.dissolved];
  if(total===0&&s[p+F.dissolved]===0)return;
  const capacityOf=(state:PhysicalState,index:number)=>thermal?thermal.surfaceCapacity(state,index):capacity(state,index);
  const phaseOf=(state:PhysicalState,index:number)=>thermal?thermal.surfacePhaseEnergy(state,index):phaseEnergy(state,index);
  const setHeat=(h:number)=>{if(thermal)thermal.setSurfaceEnergy(s,i,h);else s[p+F.temperature]=(h-phaseOf(s,i))/capacityOf(s,i);};
  const initialPotential=mechanics?.potential(s,i)??0,initialEnergy=thermal?thermal.surfaceEnergy(s,i):enthalpy(s,i);
  const oldWater=s[p+F.water],oldDissolved=s[p+F.dissolved];
  const commitPhase=(water:number,dissolved:number)=>admitLocalChange(s,i,STRIDE,fraction=>{
   const liquid=oldWater+(water-oldWater)*fraction,solution=oldDissolved+(dissolved-oldDissolved)*fraction;
   const oldIce=s[p+F.ice],oldSalt=s[p+F.salt];
   if(liquid<=total*.5){s[p+F.water]=liquid;s[p+F.ice]=Math.max(0,total-s[p+F.water]);}
   else {s[p+F.ice]=total-liquid;s[p+F.water]=Math.max(0,total-s[p+F.ice]);}
   // Never create a small new phase if the source cannot represent its debit.
   // Complete equilibrium can cross Float32 binades, so complementary writes
   // retain their explicitly measured bounded material rounding.
   if(liquid<oldWater&&s[p+F.water]===oldWater||liquid>oldWater&&s[p+F.ice]===oldIce){s[p+F.water]=oldWater;s[p+F.ice]=oldIce;}
   if(solution<=salt*.5){s[p+F.dissolved]=solution;s[p+F.salt]=Math.max(0,salt-s[p+F.dissolved]);}
   else {s[p+F.salt]=salt-solution;s[p+F.dissolved]=Math.max(0,salt-s[p+F.salt]);}
   if(solution<oldDissolved&&s[p+F.dissolved]===oldDissolved||solution>oldDissolved&&s[p+F.salt]===oldSalt){s[p+F.dissolved]=oldDissolved;s[p+F.salt]=oldSalt;}
  },{energy:()=>initialEnergy,potential:mechanics?.potential??(()=>0),accept:mechanics?.accept??(()=>{}),
   capacity:capacityOf,phase:phaseOf,setEnergy:(_state,_index,target)=>setHeat(target)});
  if(total<=0){commitPhase(0,0);return;}
  const oldIce=s[p+F.ice],base=capacityOf(s,i)-s[p+F.water]*CP[F.water]-oldIce*CP[F.ice];
  const otherPhase=phaseOf(s,i)+oldIce*ICE_LATENT;
  const at=(water:number)=>{
    const ice=total-water,dissolved=Math.min(salt,water*.36),tf=water>0?freezingPoint(water,dissolved):(salt>0?freezingPoint(1,.36):0);
    const c=base+water*CP[F.water]+ice*CP[F.ice];
    let potential=0;
    if(mechanics){const old=[s[p+F.water],s[p+F.ice],s[p+F.salt],s[p+F.dissolved]];s[p+F.water]=water;s[p+F.ice]=ice;s[p+F.salt]=salt-dissolved;s[p+F.dissolved]=dissolved;potential=mechanics.potential(s,i);[F.water,F.ice,F.salt,F.dissolved].forEach((f,k)=>s[p+f]=old[k]);}
    return {temperature:(initialEnergy+(initialPotential-potential)-otherPhase+ICE_LATENT*ice)/c,tf};
  };
  let water=total;const liquid=at(total),solid=at(0);
  if(liquid.temperature<liquid.tf){
    if(solid.temperature<=solid.tf)water=0;
    else {let lo=0,hi=total;for(let n=0;n<24;n++){const mid=(lo+hi)/2,v=at(mid);if(v.temperature>v.tf)lo=mid;else hi=mid;}water=(lo+hi)/2;}
  }
  // Solve an actual freeze/melt/dissolution extent at fixed H+U. Near the
  // positive-Kelvin boundary even an equilibrium conversion can exhaust the
  // constant-capacity model's thermal budget; retain the remaining feedstock.
  const dissolved=Math.min(salt,water*.36);
  if(water===oldWater&&dissolved===oldDissolved)return;
  commitPhase(water,dissolved);
}
export function solidHeight(state:PhysicalState,i:number,grid:SphereGrid) {
  const p=i*STRIDE;
  if(state[p+F.hydrogen]+state[p+F.helium]>0)return 0;
  return grid.geometry[i*4+3]+solidThickness(state,p);
}
/** Game approximation anchored at fresh water 0°C and marine salinity about -2°C. */
export function freezingPoint(water:number,dissolved:number) {
  const total=water+dissolved;return total>0?-Math.min(18,54*dissolved/total):0;
}
export const saturation=saturationMass;
export function vaporCapacity(s:PhysicalState,i:number,t:number,e:Environment,phase:WaterPhase='water',activity=1){const p=i*STRIDE;return saturationMass(t,phase,s[p+F.nitrogen],s[p+F.methane],s[p+F.carbonDioxide],gravityMultiplier(e),activity,s[p+F.oxygen],s[p+F.carbonMonoxide]);}
export function cellPressure(s:PhysicalState,i:number,e:Environment){const p=i*STRIDE;return columnPressure(s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide]+s[p+F.oxygen]+s[p+F.carbonMonoxide],gravityMultiplier(e));}
export function cellHabitat(s:PhysicalState,i:number,e:Environment,field:number,grid:SphereGrid){const p=i*STRIDE;if(field!==F.plant)return consumerHabitat(s[p+8],s[p+4],s[p+7],s[p+5],field===F.carnivore);const exposure=Math.max(0,grid.directions[i*3]*e.sun[0]+grid.directions[i*3+1]*e.sun[1]+grid.directions[i*3+2]*e.sun[2]);return habitat(s[p+8],s[p+4],s[p+7],s[p+5],transmittedLight(exposure,e.sunlight,s[p+16],s[p+17]))*(e.climate?pioneerRootability(s,p):1);}
export function totals(state:PhysicalState,climate?:ClimateSnapshot|WeatherClimate){
 const result=new Float64Array(STRIDE),deep=climate instanceof WeatherClimate?(climate.giant.ready?climate.giant:undefined):climate?.giant;
 if(deep){const width=climate instanceof WeatherClimate?DEEP_FIELDS.length:deepMassWidth(deep as NonNullable<ClimateSnapshot['giant']>);for(let q=0;q<deep.temperature.length;q++)for(let f=0;f<width;f++)result[DEEP_FIELDS[f]]+=deep.mass[q*width+f];return result;}
 const air=climate instanceof WeatherClimate?(climate.air.ready?climate.air:undefined):climate?.atmosphere;
 const carry=state instanceof Float32Array&&!(climate instanceof WeatherClimate)?climate?.surfaceMassCarry:undefined;
 for(let p=0;p<state.length;p+=STRIDE)for(let f=0;f<STRIDE;f++)if(!air||!(ATMOSPHERE_MIRRORS as readonly number[]).includes(f))result[f]+=climate instanceof WeatherClimate?climate.air.surfaceStock(state,p+f):state[p+f]+(carry?.[p+f]??0);
 if(air){
  if(climate instanceof WeatherClimate){for(let q=0;q<climate.air.temperature.length;q++){for(let f=0;f<AIR_FIELDS.length;f++)result[AIR_FIELDS[f]]+=climate.air.mass[q*AIR_FIELDS.length+f];result[F.airborneDust]+=climate.air.dustMass[q];}}
  else {const saved=air as NonNullable<ClimateSnapshot['atmosphere']>,width=airMassWidth(saved),layers=saved.version===1?LEGACY_AIR_LAYERS:AIR_LAYERS;for(let q=0;q<state.length/STRIDE*layers;q++){for(let f=0;f<width;f++)result[AIR_FIELDS[f]]+=saved.mass[q*width+f];result[F.airborneDust]+=saved.dustMass?.[q]??0;}}
 }
 return result;
}
export function totalMass(state:PhysicalState,climate?:ClimateSnapshot|WeatherClimate){
 if(climate instanceof WeatherClimate&&climate.giant.ready)return climate.giant.totalMass();
 if(climate&&!(climate instanceof WeatherClimate)&&climate.giant)return deepSnapshotMass(climate.giant);
 const stock=totals(state,climate);return MASS_FIELDS.reduce((mass,f)=>mass+stock[f],0);
}
export function seedWorld(grid:SphereGrid,preset:Preset='coast',temperature?:number) {
  const state=new Float32Array(grid.count*STRIDE);
  const hot=[0.48,0.37,-0.79];
  for(let i=0;i<grid.count;i++) {
    const p=i*STRIDE, x=grid.directions[i*3],y=grid.directions[i*3+1],z=grid.directions[i*3+2];
    const base=grid.geometry[i*4+3]+8;
    state[p+F.rock]=8;
    state[p+F.nitrogen]=0.3;
    state[p+F.sand]=Math.max(0,2.4+2.1*Math.sin(x*3.2-y+z*2));
    state[p+F.clay]=Math.max(0,Math.sin(y*4.7+x*2.2-z*3.3)-0.5)*1.1;
    state[p+F.water]=Math.max(0,10.25-base-state[p+F.sand]-state[p+F.clay]);
    state[p+F.temperature]=temperature??(preset==='winter' ? 2 : 20);
    if(state[p+F.water]>2 && Math.sin(x*11+y*6+z*4)>0.75) state[p+F.dissolved]=state[p+F.water]*0.06;
    if(preset==='kiln') {
      const dot=x*hot[0]+y*hot[1]+z*hot[2];
      if(dot>0.975) {
        state[p+F.sand]=0;state[p+F.clay]=9;state[p+F.water]=0;
        state[p+F.temperature]=1050;state[p+F.firing]=12;
      }
    }
  }
  return state;
}
export function environmentFor(preset:Preset):Environment {
  return {...DEFAULT_ENVIRONMENT,ambient:preset==='winter'?-18:18,sunlight:preset==='winter'?0.12:1};
}

/** Representative material columns; the fixed spherical interior is not a separate volume solver. */
export function seedPlanet(grid:SphereGrid,primary:PlanetMaterial,temperature:number,gas:GasMaterial|'none'='nitrogen',gasAmount=1) {
  const state=seedWorld(grid,'coast',temperature);
  const rockLevel=primary==='rock'?sphericalRockLevel(grid):0;
  for(let i=0;i<grid.count;i++) {
    const p=i*STRIDE;
    if(primary==='rock'){for(const field of MASS_FIELDS)state[p+field]=0;state[p+F.rock]=rockLevel-grid.geometry[i*4+3];}
    if(primary!=='rock') {
      for(const field of MASS_FIELDS)state[p+field]=0;
      state[p+F.rock]=2;
      if(primary==='sand'||primary==='clay')state[p+F[primary]]=8+2*Math.sin(grid.directions[i*3]*3.2+grid.directions[i*3+1]*2.4);
      if(primary==='water')state[p+F.water]=Math.max(3,24-grid.geometry[i*4+3]);
      if(primary==='ice')state[p+F.ice]=Math.max(3,16-grid.geometry[i*4+3]/1.09);
    }
    for(const field of [F.nitrogen,F.methane,F.carbonDioxide,F.oxygen])state[p+field]=0;
    if(gas!=='none')state[p+F[gas]]=.3*gasAmount;
  }
  return state;
}

function sphericalRockLevel(grid:SphereGrid) {
  let terrain=0;
  for(let i=0;i<grid.count;i++)terrain+=grid.geometry[i*4+3];
  return 8+terrain/grid.count;
}

/** Correct untouched rock planets saved before the spherical bedrock generator. */
export function spherizeLegacyRockPlanet(snapshot:Snapshot,grid:SphereGrid) {
  if(snapshot.planet?.primary!=='rock'||snapshot.state.length!==grid.count*STRIDE)return false;
  const original=snapshot.state;
  for(let i=0;i<grid.count;i++){
    const p=i*STRIDE;
    if(Math.abs(original[p+F.rock]-8)>1e-5)return false;
    for(const field of SURFACE_ERASE_FIELDS)if(Math.abs(original[p+field])>1e-5)return false;
  }
  const state=new Float32Array(original);
  const level=sphericalRockLevel(grid);
  for(let i=0;i<grid.count;i++){
    const heat=enthalpy(state,i),p=i*STRIDE;
    state[p+F.rock]=Math.fround(level-grid.geometry[i*4+3]);
    state[p+F.temperature]=(heat-phaseEnergy(state,i))/capacity(state,i);
  }
  snapshot.state=[...state];
  return true;
}

export interface Solver {
  readonly backend:'WebGPU'|'CPU';
  readonly climate:WeatherClimate;
  state:Float32Array;
  escapeCells:Float32Array;
  condensedCells:Float32Array;
  precipitatedCells:Float32Array;
  energyChanges:Float32Array;
  feedingCells:Float32Array;
  step(dt:number,commands:PhysicalState,environment:Environment):Promise<void>;
  replace(state:Float32Array):void;
  dispose():void;
}

export class CpuSolver implements Solver {
  readonly backend='CPU';
  readonly climate:WeatherClimate;
  private prepared:Float64Array;
  private next:Float64Array;
  private animalNavigation:AnimalNavigation;
  escapeCells:Float32Array;
  condensedCells:Float32Array;
  precipitatedCells:Float32Array;
  energyChanges:Float32Array;
  feedingCells:Float32Array;
  constructor(readonly grid:SphereGrid,public state:Float32Array) {
    this.climate=new WeatherClimate(grid);
    this.animalNavigation=new AnimalNavigation(grid);
    this.prepared=new Float64Array(state.length);this.next=new Float64Array(state.length);
    this.escapeCells=new Float32Array(grid.count*GASES.length);
    this.condensedCells=new Float32Array(grid.count);
    this.precipitatedCells=new Float32Array(grid.count*2);
    this.energyChanges=new Float32Array(grid.count*ENERGY_CHANNELS);
    this.feedingCells=new Float32Array(grid.count*2);
  }
  replace(state:Float32Array) {this.climate.syncSurfaceProjection(state);this.state=new Float32Array(state);this.escapeCells.fill(0);this.condensedCells.fill(0);this.precipitatedCells.fill(0);this.energyChanges.fill(0);this.feedingCells.fill(0);}
  dispose() {}
  async step(dt:number,commands:PhysicalState,environment:Environment) {
    this.advance(dt,commands,environment);
  }
  advance(dt:number,commands:PhysicalState,environment:Environment) {
    assertPlanetSupport(environment.body,this.climate.giant.ready?this.climate.giant.height:undefined);
    if(!isDeepAtmosphere(environment.body)&&hasDeepGas(this.state))throw new Error('수소·헬륨 상태는 깊은 대기 경계가 필요합니다.');
    this.escapeCells.fill(0);this.condensedCells.fill(0);this.precipitatedCells.fill(0);this.energyChanges.fill(0);this.feedingCells.fill(0);
    if(dt<=0&&!commands.some(v=>v!==0))return;
    const steps=physicsSteps(dt),empty=steps.length>1?new Float32Array(commands.length):commands;
    this.climate.syncSurfaceProjection(this.state);
    const before=this.state.slice(),climate=this.climate.checkpoint();
    try{for(let n=0;n<steps.length;n++){this.advanceSingle(steps[n],n===0?commands:empty,environment);assertFiniteStepOutputs(this.state,this.energyChanges,this.escapeCells,this.condensedCells,this.precipitatedCells,this.feedingCells);}}
    catch(error){{this.state=before;if(climate)this.climate.restoreCheckpoint(climate);this.escapeCells.fill(0);this.condensedCells.fill(0);this.precipitatedCells.fill(0);this.energyChanges.fill(0);this.feedingCells.fill(0);}throw error;}
  }
  private advanceSingle(dt:number,commands:PhysicalState,environment:Environment) {
    if(isDeepAtmosphere(environment.body)){this.climate.stepGiant(this.state,dt,commands,environment,this.energyChanges);return;}
    const {grid}=this, n=grid.count;
    this.prepared.set(this.climate.physicalSurface(this.state));
    prepareSurfaceStep(this.prepared,commands,environment,this.climate,this.energyChanges);
    if(dt<=0){this.climate.step(this.prepared,0,environment,this.energyChanges);this.state=this.climate.publishSurface(this.prepared);return;}
    this.next.set(this.prepared);
    finishSurfaceThermalTransport(this.prepared,this.next,dt,environment,grid,this.climate.air,this.energyChanges);
    finishSurfaceStep(this.next,dt,environment,grid,this,this.animalNavigation);
    this.state=this.climate.publishSurface(this.next);
  }
}

/** Shared host finite-volume material and heat exchange. Every physical stock
 * is Float64 during evolution on both backends. The F32 public/GPU projection
 * is published only after all processes, with its low material bits retained. */
export function finishSurfaceThermalTransport(source:PhysicalState,target:PhysicalState,dt:number,e:Environment,grid:SphereGrid,thermal:SurfaceThermal&{surfaceHeatCarry:Float64Array},ledger:Float32Array,_legacyFlux?:Float32Array){
 if(dt<=0)return;
 const count=grid.count,temperature=new Float64Array(count),capacities=new Float64Array(count),conductivities=new Float64Array(count),habitats=new Float64Array(count),sensible=new Float64Array(count),cloudScale=new Float64Array(count);
 target.set(source);
 for(let i=0;i<count;i++){
  capacities[i]=capacity(source,i);sensible[i]=capacities[i]*source[i*STRIDE+F.temperature]+thermal.surfaceHeatCarry[i];temperature[i]=source[i*STRIDE+F.temperature]+thermal.surfaceHeatCarry[i]/capacities[i];conductivities[i]=conductivity(source,i*STRIDE);habitats[i]=cellHabitat(source,i,e,F.plant,grid);
  let total=0;if(!e.climate)for(let k=0;k<NEIGHBORS;k++){const j=grid.neighbors[i*NEIGHBORS+k];if(j!==INVALID)total+=cloudEdgeFraction(grid,i,j,dt);}
  cloudScale[i]=Math.min(1,.45/Math.max(1e-8,total));
 }
 for(let i=0;i<count;i++)for(let k=0;k<NEIGHBORS;k++){
  const edge=i*NEIGHBORS+k,j=grid.neighbors[edge];if(j===INVALID||j<=i)continue;
  const p=i*STRIDE,q=j*STRIDE,spatial=edgeScale(grid.distances[edge]);
  const exchange=(field:number,amount:number)=>{
   target[p+field]+=amount;target[q+field]-=amount;
   const heat=amount*(CP[field]*(amount>=0?temperature[j]:temperature[i])+MATERIAL_ENERGY[field]);
   sensible[i]+=heat;sensible[j]-=heat;
  };
  for(const field of [F.cloud,F.cloudIce]){
   const fraction=e.climate?0:cloudEdgeFraction(grid,i,j,dt);
   exchange(field,source[q+field]*fraction*cloudScale[j]-source[p+field]*fraction*cloudScale[i]);
  }
  exchange(F.plant,(source[q+F.plant]*habitats[i]-source[p+F.plant]*habitats[j])*Math.min(dt*.004*spatial,1/NEIGHBORS));
  for(const field of GAS_FIELDS)exchange(field,(source[q+field]-source[p+field])*Math.min(dt*(field===F.vapor||field===F.soot?.28:.6)*spatial,1/NEIGHBORS));
  const heat=(temperature[j]-temperature[i])*Math.min(dt*pairConductance(conductivities[i],conductivities[j])*spatial,Math.min(capacities[i],capacities[j])/(2*NEIGHBORS));sensible[i]+=heat;sensible[j]-=heat;
 }
 // sensible also contains transferred material reference energy; the source
 // reference is added once here. All internal edge exchanges cancel in pairs.
 for(let i=0;i<count;i++)thermal.setSurfaceEnergy(target,i,sensible[i]+phaseEnergy(source,i));
}

/** Backend-independent command boundary. Atmosphere mirrors are detached
 * before tools/transport and restored only after the shared process step. */
export function prepareSurfaceStep(state:PhysicalState,commands:PhysicalState,environment:Environment,climate:WeatherClimate,energy:Float32Array){
 climate.prepareSurface(state,environment,energy);
 for(let i=0;i<state.length/STRIDE;i++){assertThermodynamicTemperature(state[i*STRIDE+F.temperature]);const before=enthalpy(state,i)+climate.air.surfaceHeatCarry[i];applyCommand(state,i,commands,undefined,climate.air.surfaceHeatCarry);assertThermodynamicTemperature(state[i*STRIDE+F.temperature]);energy[i*ENERGY_CHANNELS+1]+=enthalpy(state,i)+climate.air.surfaceHeatCarry[i]-before;}
 climate.surfaceSupplies(state,commands,COMMAND_STRIDE,energy);
}

/** One local physics/ecology implementation for CPU, WebGPU and their workers.
 * GPU acceleration changes transport execution, never reaction semantics. */
export function finishSurfaceStep(state:PhysicalState,dt:number,environment:Environment,grid:SphereGrid,
 diagnostics:Pick<Solver,'climate'|'escapeCells'|'condensedCells'|'precipitatedCells'|'energyChanges'|'feedingCells'>,navigation:AnimalNavigation){
 const {climate,escapeCells,condensedCells,precipitatedCells,energyChanges,feedingCells}=diagnostics;
 if(dt>0){
  climate.ocean.reconcile(state,energyChanges);
  climate.ocean.transportSolids(state,dt,energyChanges);
  const mechanics={potential:(s:PhysicalState,i:number)=>climate.ocean.columnPotential(s,i),accept:(s:PhysicalState,i:number)=>climate.ocean.acceptPotential(s,i)};
  for(let i=0;i<grid.count;i++)react(state,i,dt,environment,grid,escapeCells,condensedCells,precipitatedCells,energyChanges,feedingCells,mechanics,climate.air);
  navigation.move(state,dt,environment,energyChanges);
 }
 climate.step(state,dt,environment,energyChanges,condensedCells,precipitatedCells,escapeCells,feedingCells);
 for(let i=0;i<grid.count;i++)assertThermodynamicTemperature(state[i*STRIDE+F.temperature]);
}

/** Drowning transfers stored chemical energy into surface heat. */
export function drownConsumers(s:PhysicalState,i:number){
  const p=i*STRIDE;
  if(openSurfaceWater(s[p+F.water],s[p+F.soil])){
    const heat=enthalpy(s,i);
    s[p+F.soil]+=s[p+F.herbivore]+s[p+F.carnivore];s[p+F.herbivore]=0;s[p+F.carnivore]=0;
    s[p+F.temperature]=(heat-phaseEnergy(s,i))/capacity(s,i);
  }
}
export function applyCommand(s:PhysicalState,i:number,commands:PhysicalState,collected?:Stock,retainedHeat?:Float64Array) {
  const p=i*STRIDE,c=i*COMMAND_STRIDE;
  let edited=false;for(let k=0;k<COMMAND_STRIDE;k++)if(commands[c+k]!==0){edited=true;break;}if(!edited)return;
  const old=capacity(s,i),thermal=old*s[p+F.temperature]+(retainedHeat?.[i]??0),dose=s[p+F.clay]*s[p+F.firing];let inputHeat=0;
  const fields=[4,0,1,6,13,14,15,27,5,2,3,18,19,20,21,22],offsets=[0,1,2,3,8,9,10,11,12,13,14,15,16,17,18,19];
  for(let k=0;k<fields.length;k++) {
    const field=fields[k],amount=commands[c+offsets[k]];s[p+field]+=amount;inputHeat+=amount*CP[field]*SUPPLY_TEMPERATURE[field];
  }
  const after=capacity(s,i);if(after!==old||commands[c+4]!==0){
    if(retainedHeat)retainedHeat[i]=writeFloat32ThermalEnergy(s,p+F.temperature,thermal+inputHeat+commands[c+4]+phaseEnergy(s,i),after,phaseEnergy(s,i));
    else s[p+8]=(s[p+8]*old+inputHeat+commands[c+4])/after;
  }
  if(commands[c+2]!==0)s[p+F.firing]=s[p+F.clay]>1e-8?dose/s[p+F.clay]:0;
  const erase=Math.max(0,Math.min(1,commands[c+5]));
  if(erase>0) {
    for(const f of commands[c+SURFACE_ERASE]>0?SURFACE_ERASE_FIELDS:MASS_FIELDS) s[p+f]*=1-erase;
    if(s[p+1]<0.001) s[p+10]=0;
  }
  const collect=Math.max(0,Math.min(1,commands[c+6]));
  if(collect>0)for(const product of PRODUCTS){
    const f=F[product],before=s[p+f];s[p+f]*=1-collect;
    if(collected)collected[product]+=before-s[p+f];
  }
  if(retainedHeat)retainedHeat[i]*=capacity(s,i)/after;
  if(commands[c+COMMAND_FIELD.water]>0||commands[c+COMMAND_FIELD.herbivore]>0||commands[c+COMMAND_FIELD.carnivore]>0){
    const target=enthalpy(s,i)+(retainedHeat?.[i]??0);drownConsumers(s,i);
    if(retainedHeat)retainedHeat[i]=writeFloat32ThermalEnergy(s,p+F.temperature,target,capacity(s,i),phaseEnergy(s,i));
  }
}

export function react(s:PhysicalState,i:number,dt:number,e:Environment,grid:SphereGrid,escaped?:Float32Array,condensed?:Float32Array,precipitated?:Float32Array,energyChanges?:Float32Array,feeding?:Float32Array,mechanics?:LocalMechanics,thermal?:SurfaceThermal) {
  if(dt<=0)return;
  const p=i*STRIDE;
  const heatOf=(state:PhysicalState,index:number)=>thermal?thermal.surfaceEnergy(state,index):enthalpy(state,index);
  const beforeClamp=heatOf(s,i),numericBefore=energyChanges?.[i*4+3]??0;let escapeHeat=0;
  for(const f of MASS_FIELDS) s[p+f]=Math.max(0,s[p+f]);
  if(energyChanges)energyChanges[i*4+3]+=enthalpy(s,i)-beforeClamp;
  let c=capacity(s,i),t=thermal?thermal.surfaceTemperature(s,i):s[p+8];
  const dot=Math.max(0,grid.directions[i*3]*e.sun[0]+grid.directions[i*3+1]*e.sun[1]+grid.directions[i*3+2]*e.sun[2]);
  const surfaceAlbedo=albedo(s,p);
  // External solar/atmosphere energy, with greater thermal inertia in wet regions.
  const light=transmittedLight(dot,e.sunlight,s[p+F.cloud],s[p+F.cloudIce]);
  const solar=e.climate?0:absorbedSolarHeat(light,surfaceAlbedo,dt);
  const external=e.climate?0:bathHeat(c,t,e.ambient,dt)+solar;t+=external/c;
  if(energyChanges)energyChanges[i*4]+=external;
  if(thermal)thermal.setSurfaceEnergy(s,i,heatOf(s,i)+external);else s[p+8]=t;
  const initialPotential=mechanics?.potential(s,i)??0;
  const needsConversion=[F.water,F.ice,F.dissolved,F.vapor,F.cloud,F.cloudIce,F.clay,F.sand,F.glass,F.molten,F.soil,F.plant,F.seed,F.herbivore,F.carnivore,F.methane,F.charcoal,F.carbonMonoxide,F.soot].some(f=>s[p+f]>0);
  if(needsConversion){
  const originalDt=dt;
  const phaseMechanics=mechanics?{potential:mechanics.potential,accept:()=>{}}:undefined;
  const diagnostics=[{array:condensed,start:i,length:1},{array:precipitated,start:i*2,length:2},{array:feeding,start:i*2,length:2}].map(d=>({...d,before:d.array?.slice(d.start,d.start+d.length)}));
  const numericStart=energyChanges?.[i*4+3]??0;
  const convert=(extentScale:number)=>{
   for(const d of diagnostics)if(d.array&&d.before)d.array.set(d.before,d.start);
   if(energyChanges)energyChanges[i*4+3]=numericStart;
   const dt=originalDt*extentScale;let c=capacity(s,i),t=s[p+F.temperature];
  equilibrateWater(s,i,phaseMechanics);t=s[p+8];c=capacity(s,i);
  const tf=freezingPoint(s[p+4],s[p+7]),activity=waterActivity(s[p+4],s[p+7]),boiling=s[p+4]+s[p+5]+s[p+9]+s[p+16]+s[p+17]>0?boilingPoint(cellPressure(s,i,e),activity):100;
  if(!e.climate&&s[p+4]>0 && t>tf+0.3) {
    const dry=Math.max(0,1-s[p+9]/Math.max(1e-12,vaporCapacity(s,i,t,e,'water',activity)));
    const evaporate=Math.max(0,t+8)*0.0001*dry*dt+Math.max(0,t-boiling)*c/(VAPOR_OFFSET+VAPORIZATION_CP*boiling);
    const requested=Math.min(s[p+4],evaporate,Math.max(0,(t-tf)*c/(VAPOR_OFFSET+VAPORIZATION_CP*tf)));
    const amount=reactInventory(s,p,EVAPORATE_WATER,requested);
    t=(c*t-amount*VAPOR_OFFSET)/capacity(s,i);
    c=capacity(s,i);
  }
  // Sublimation spends the same declared phase energy as cloud ice evaporation.
  if(!e.climate&&s[p+F.ice]>0&&t<=tf+.3){
    const dry=Math.max(0,1-s[p+F.vapor]/Math.max(1e-12,vaporCapacity(s,i,t,e,'ice')));
    const minimum=MIN_THERMODYNAMIC_TEMPERATURE;
    const before=s[p+F.ice],requested=Math.min(before,before*dry*dt*.002,Math.max(0,(t-minimum)*c/phaseChangeEnergy(F.ice,F.vapor,minimum)));
    s[p+F.ice]-=requested;const amount=before-s[p+F.ice];s[p+F.vapor]+=amount;t=(c*t-amount*SUBLIMATION_OFFSET)/capacity(s,i);c=capacity(s,i);
  }
  if(!e.climate){
  // A single reservoir has a single actual temperature; no hidden cold layer.
  // A 0.001°C nucleation guard avoids opposite phase choices at a Float32 freezing plateau.
  const airTemperature=t,airIce=airTemperature< -.001;
  const cloudMass=s[p+F.cloud]+s[p+F.cloudIce],iceShare=cloudMass>1e-8?s[p+F.cloudIce]/cloudMass:(airIce?1:0);
  const airSaturation=vaporCapacity(s,i,airTemperature,e)*(1-iceShare)+vaporCapacity(s,i,airTemperature,e,'ice')*iceShare;
  const excess=s[p+F.vapor]-airSaturation,latent=VAPOR_OFFSET;
  if(excess>0 && airTemperature<boiling-5){
    const amount=Math.min(s[p+F.vapor],excess*(1-Math.exp(-dt*.4))),before=s[p+F.vapor];
    s[p+F.vapor]-=amount;s[p+(airIce?F.cloudIce:F.cloud)]+=amount;
    if(condensed)condensed[i]+=before-s[p+F.vapor];
    t=(c*t+amount*(latent+(airIce?ICE_LATENT:0)))/capacity(s,i);c=capacity(s,i);
  } else if(excess<0) {
    const cloud=s[p+F.cloud]+s[p+F.cloudIce];
    const minimum=MIN_THERMODYNAMIC_TEMPERATURE,cost=Math.max(phaseChangeEnergy(F.cloud,F.vapor,minimum),phaseChangeEnergy(F.cloudIce,F.vapor,minimum));
    const amount=Math.min(cloud,-excess*(1-Math.exp(-dt*.2)),Math.max(0,(t-minimum)*c/cost));
    if(amount>0){const ice=Math.min(s[p+F.cloudIce],amount*s[p+F.cloudIce]/Math.max(1e-8,cloud)),water=Math.min(s[p+F.cloud],Math.max(0,amount-ice)),evaporated=water+ice;s[p+F.cloud]-=water;s[p+F.cloudIce]-=ice;s[p+F.vapor]+=evaporated;t=(c*t-evaporated*latent-ice*ICE_LATENT)/capacity(s,i);c=capacity(s,i);}
  }
  if(t<0 && s[p+F.cloud]>0){const amount=Math.min(s[p+F.cloud],-t*c/ICE_LATENT,s[p+F.cloud]*dt*.08);s[p+F.cloud]-=amount;s[p+F.cloudIce]+=amount;t=(c*t+amount*ICE_LATENT)/capacity(s,i);c=capacity(s,i);}
  if(t>0 && s[p+F.cloudIce]>0){const amount=Math.min(s[p+F.cloudIce],t*c/ICE_LATENT,s[p+F.cloudIce]*dt*.15);s[p+F.cloudIce]-=amount;s[p+F.cloud]+=amount;t=(c*t-amount*ICE_LATENT)/capacity(s,i);c=capacity(s,i);}
  }
  const latent=VAPOR_OFFSET;
  let rain=Math.max(0,s[p+F.cloud]-RAIN_THRESHOLD)*(1-Math.exp(-dt*.22*Math.sqrt(gravityMultiplier(e))));
  let snow=Math.max(0,s[p+F.cloudIce]-SNOW_THRESHOLD)*(1-Math.exp(-dt*.12*Math.sqrt(gravityMultiplier(e))));
  const dry=Math.max(0,1-s[p+F.vapor]/Math.max(1e-12,vaporCapacity(s,i,t,e)));
  let returning=Math.min(.85,dry*Math.max(0,t+10)/80)*(rain+snow);
  const requested=rain+snow-returning,iceBeforeRain=s[p+F.ice],groundIce=t<freezingPoint(s[p+4]+rain+snow,s[p+7]),target=p+(groundIce?F.ice:F.water);
  // A tiny shower must remain in the cloud until the ground can store it.
  // Otherwise repeated sub-ULP deposits silently delete an ocean's water.
  const stored=roundedSurfaceStock(s[target],requested,true,s instanceof Float32Array),reaching=stored-s[target],fraction=requested>0?reaching/requested:0;
  rain*=fraction;snow*=fraction;returning*=fraction;
  s[p+F.cloud]-=rain;s[p+F.cloudIce]-=snow;s[p+F.vapor]+=returning;s[target]=stored;
  const sourcePhase=-snow*ICE_LATENT,destinationPhase=returning*latent-(groundIce?reaching*ICE_LATENT:0);
  t=(c*t+sourcePhase-destinationPhase)/capacity(s,i);c=capacity(s,i);
  if(s[p+1]>0.0001 && s[p+4]/Math.max(.1,s[p+1])<0.008 && t>=850) {
    s[p+10]+=dt;
    if(s[p+10]>=30) {
      // Bound hydroxyl water and detailed mineral transformations are lumped here.
      const heat=c*t;reactInventory(s,p,FIRE_CLAY,s[p+F.clay]);s[p+10]=0;c=capacity(s,i);t=heat/c;
    }
  }
  if(t>1700 && s[p]>0) {
    const amount=Math.min(s[p],dt*(t-1700)*0.005,c*(t-1700)/150);
    const reacted=reactInventory(s,p,MELT_SAND,amount);t-=reacted*150/c;
  }
  if(t>GLASS_SOFTENING && s[p+F.glass]>0){const amount=Math.min(s[p+F.glass],dt*3*Math.min(1,(t-GLASS_SOFTENING)/200));reactInventory(s,p,SOFTEN_GLASS,amount);}
  if(t<1400 && s[p+11]>0) {
    const amount=Math.min(s[p+11],dt*3);
    reactInventory(s,p,SOLIDIFY_GLASS,amount);
  }
  // Rain, evaporation and salt concentration share the same final ground-phase policy.
  s[p+8]=t;equilibrateWater(s,i,phaseMechanics);t=s[p+8];c=capacity(s,i);
  if(precipitated){const frozen=Math.min(reaching,Math.max(0,s[p+F.ice]-iceBeforeRain));precipitated[i*2]+=reaching-frozen;precipitated[i*2+1]+=frozen;}
  if(!e.climate&&s[p+F.soot]>0)reactInventory(s,p,SETTLE_SOOT,s[p+F.soot]*-Math.expm1(-particleSettlingSpeed(SOOT,cellPressure(s,i,e),t,9.81*gravityMultiplier(e))*dt*60/500));
  const ecologyHeat=enthalpy(s,i);
  drownConsumers(s,i);
  if(!e.climate)reactEcosystem(s,p,dt,{temperature:s[p+8],light,absorbedSolar:solar,rootability:pioneerRootability(s,p)},feeding,i*2);
  t=(ecologyHeat-phaseEnergy(s,i))/capacity(s,i);c=capacity(s,i);
  // Float32 conversion is the only correction here, not the reaction heat.
  s[p+8]=t;if(energyChanges)energyChanges[i*4+3]+=enthalpy(s,i)-ecologyHeat;
  };
  if(mechanics||thermal){const accepted=admitLocalChange(s,i,STRIDE,convert,{
   potential:mechanics?.potential??(()=>0),accept:mechanics?.accept??(()=>{}),energy:heatOf,
   capacity:(state,index)=>thermal?thermal.surfaceCapacity(state,index):capacity(state,index),
   phase:(state,index)=>thermal?thermal.surfacePhaseEnergy(state,index):phaseEnergy(state,index),
   setEnergy:(state,index,h)=>{if(thermal)thermal.setSurfaceEnergy(state,index,h);else state[index*STRIDE+F.temperature]=(h-phaseEnergy(state,index))/capacity(state,index);},
  });if(accepted===0){for(const d of diagnostics)if(d.array&&d.before)d.array.set(d.before,d.start);}}
  else convert(1);
  }
  assertThermodynamicTemperature(s[p+8]);
  const mechanicalChange=(mechanics?.potential(s,i)??0)-initialPotential;
  for(let k=0;k<GASES.length;k++) {
    const gas=GASES[k],before=s[p+gas.field];
    s[p+gas.field]=before*(1-thermalEscapeFraction(s[p+8],gravityMultiplier(e),gas.molarMass,dt,planetRadius(e.body)));
    const removed=before-s[p+gas.field];
    if(escaped)escaped[i*GASES.length+k]+=removed;
    const carried=removed*(CP[gas.field]*s[p+8]+MATERIAL_ENERGY[gas.field]);escapeHeat-=carried;
    if(energyChanges)energyChanges[i*4+2]-=carried;
  }
  // Each local conversion conserves analytical total energy. Record the net
  // Float32 write residual once, including phase/solar writes above; do not
  // misclassify stored chemical energy or reaction heat as an external source.
  if(energyChanges)energyChanges[i*4+3]+=heatOf(s,i)+mechanicalChange-beforeClamp-external-escapeHeat-(energyChanges[i*4+3]-numericBefore);
}

export function physicalRadius(state:PhysicalState,i:number,grid:SphereGrid) {
  return 4.8+solidHeight(state,i,grid)*HEIGHT_SCALE;
}
