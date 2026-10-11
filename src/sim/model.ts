import {WeatherClimate,pioneerRootability,type ClimateSnapshot} from './weatherClimate';
import {bathHeat,thermalTarget} from './climate';
import {habitat,consumerHabitat,foodWeb} from './ecology';
import {AnimalNavigation} from './animalNavigation';
import { HEIGHT_SCALE, INVALID, NEIGHBORS, type SphereGrid } from './sphere';
import {GASES,thermalEscapeFraction} from './gases';
import {cloudEdgeFraction,CLOUD_COOLING,RAIN_THRESHOLD,SNOW_THRESHOLD} from './clouds';
import {columnPressure,saturationMass,boilingPoint,waterActivity,type WaterPhase} from './waterPhysics';
import {albedo,transmittedLight,conductivity,pairConductance,edgeScale,meltMobility,GLASS_SOFTENING} from './materialPhysics';
import {physicsSteps} from './clock';
import {AIR_FIELDS} from './layeredAtmosphere';
import {BASE_CAPACITY,SPECIFIC_HEAT,PHASE_ENERGY,SUPPLY_TEMPERATURE,ENERGY_CHANNELS} from './thermodynamics';

export const STRIDE = 24;
export const COMMAND_STRIDE = 20;
/** Command slot 7 limits erasure to editable surface matter. Zero keeps legacy whole-cell erasure. */
export const SURFACE_ERASE = 7;
export const F = {
  sand:0, clay:1, ceramic:2, glass:3, water:4, ice:5, salt:6,
  dissolved:7, temperature:8, vapor:9, firing:10, molten:11, rock:12,
  nitrogen:13, methane:14, carbonDioxide:15, cloud:16, cloudIce:17, soil:18, plant:19, herbivore:20, carnivore:21, iron:22, seed:23,
} as const;
export const SURFACE_ERASE_FIELDS = [F.sand,F.clay,F.ceramic,F.glass,F.water,F.ice,F.salt,F.dissolved,F.molten,F.soil,F.plant,F.herbivore,F.carnivore,F.iron,F.seed];
export const PRODUCTS=['ice','ceramic','glass','plant','herbivore','carnivore','iron'] as const;
export type Product=typeof PRODUCTS[number];
export type Stock=Record<Product,number>;
export const emptyStock=():Stock=>({ice:0,ceramic:0,glass:0,plant:0,herbivore:0,carnivore:0,iron:0});
export const isProduct=(id:string):id is Product=>(PRODUCTS as readonly string[]).includes(id);
export type SurfaceMaterial = 'sand' | 'water' | 'clay' | 'salt' | 'soil' | Product;
export const SURFACE_MATERIALS:SurfaceMaterial[]=['sand','water','clay','salt','soil',...PRODUCTS];
export type GasMaterial = 'nitrogen' | 'methane' | 'carbonDioxide';
export type Material = SurfaceMaterial | GasMaterial;
export const COMMAND_FIELD:Record<Material,number> = {water:0,sand:1,clay:2,salt:3,nitrogen:8,methane:9,carbonDioxide:10,ice:12,ceramic:13,glass:14,soil:15,plant:16,herbivore:17,carnivore:18,iron:19};
export const isGas = (material:Material):material is GasMaterial => ['nitrogen','methane','carbonDioxide'].includes(material);
export type Tool = 'observe' | 'pour' | 'heat' | 'cool' | 'erase' | 'collect' | 'orbit' | 'meteor';
export type Preset = 'coast' | 'winter' | 'kiln';
export type PlanetMaterial = 'rock' | 'sand' | 'clay' | 'water' | 'ice';
export interface Environment { ambient:number; sunlight:number; sun:readonly number[]; gravity?:number; orbitDistance?:number; rotationRate?:number; orbitAngle?:number; climate?:boolean; }
export interface Snapshot {
  version:1|2|3|4; preset:Preset; time:number; state:number[]; discoveries:string[];
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
export const MASS_FIELDS = [0,1,2,3,4,5,6,7,9,11,12,13,14,15,16,17,18,19,20,21,22,23];
const GAS_FIELDS = [F.vapor,F.nitrogen,F.methane,F.carbonDioxide];
const CP = SPECIFIC_HEAT;
export const gravityMultiplier = (e:Environment) => e.gravity??1;
export const WATER_LATENT = 2257;
export const ICE_LATENT = 334;

export function capacity(state:Float32Array,i:number) {
  const p=i*STRIDE;
  let c=BASE_CAPACITY;
  for(let f=0;f<CP.length;f++) c+=state[p+f]*CP[f];
  return c;
}
export function phaseEnergy(state:Float32Array,i:number){const p=i*STRIDE;let h=0;for(const f of MASS_FIELDS)h+=state[p+f]*PHASE_ENERGY[f];return h;}
export function enthalpy(state:Float32Array,i:number){return capacity(state,i)*state[i*STRIDE+F.temperature]+phaseEnergy(state,i);}
export function totalEnthalpy(state:Float32Array,climate?:ClimateSnapshot|WeatherClimate){
 if(climate instanceof WeatherClimate&&climate.air.ready)return climate.energy(state);
 let h=0;for(let i=0;i<state.length/STRIDE;i++)h+=enthalpy(state,i);
 const a=climate&&!(climate instanceof WeatherClimate)?climate.atmosphere:undefined;
 if(a)for(let i=0;i<state.length/STRIDE;i++){let actual=0;for(let k=0;k<5;k++){const q=i*5+k;let m=0,c=0,phase=0;for(let f=0;f<6;f++){const mass=a.mass[q*6+f];m+=mass;c+=mass*CP[AIR_FIELDS[f]];phase+=mass*PHASE_ENERGY[AIR_FIELDS[f]];}const v=q*3;actual+=c*a.temperature[q]+phase+m*(9.81*[500,1500,3000,5500,8500][k]+.5*(a.velocity[v]**2+a.velocity[v+1]**2+a.velocity[v+2]**2))/1000;}const p=i*STRIDE;h+=actual-AIR_FIELDS.reduce((sum,f)=>sum+state[p+f]*(CP[f]*state[p+F.temperature]+PHASE_ENERGY[f]),0);}
 return h;
}

/** Fast-mixed liquid/ice/salt equilibrium at conserved column enthalpy.
 * Salt partitions reversibly at the game solubility limit; no brine EOS is claimed.
 * Solve liquid mass directly and use the saturated-brine limit at zero liquid. */
export function equilibrateWater(s:Float32Array,i:number){
  const p=i*STRIDE,total=s[p+F.water]+s[p+F.ice],salt=s[p+F.salt]+s[p+F.dissolved];
  if(total<=0){s[p+F.salt]=salt;s[p+F.dissolved]=0;return;}
  const h=enthalpy(s,i);
  const oldIce=s[p+F.ice],base=capacity(s,i)-s[p+F.water]*CP[F.water]-oldIce*CP[F.ice];
  const otherPhase=phaseEnergy(s,i)+oldIce*ICE_LATENT;
  const at=(water:number)=>{
    const ice=total-water,dissolved=Math.min(salt,water*.36),tf=water>0?freezingPoint(water,dissolved):(salt>0?freezingPoint(1,.36):0);
    const c=base+water*CP[F.water]+ice*CP[F.ice];
    return {temperature:(h-otherPhase+ICE_LATENT*ice)/c,tf};
  };
  let water=total;const liquid=at(total),solid=at(0);
  if(liquid.temperature<liquid.tf){
    if(solid.temperature<=solid.tf)water=0;
    else {let lo=0,hi=total;for(let n=0;n<24;n++){const mid=(lo+hi)/2,v=at(mid);if(v.temperature>v.tf)lo=mid;else hi=mid;}water=(lo+hi)/2;}
  }
  // Store the smaller phase first; the rounded complement must never be negative.
  if(water<=total*.5){s[p+F.water]=water;s[p+F.ice]=Math.max(0,total-s[p+F.water]);}
  else {s[p+F.ice]=total-water;s[p+F.water]=Math.max(0,total-s[p+F.ice]);}
  const dissolved=Math.min(salt,s[p+F.water]*.36);
  if(dissolved<=salt*.5){s[p+F.dissolved]=dissolved;s[p+F.salt]=Math.max(0,salt-s[p+F.dissolved]);}
  else {s[p+F.salt]=salt-dissolved;s[p+F.dissolved]=Math.max(0,salt-s[p+F.salt]);}
  s[p+F.temperature]=(h-phaseEnergy(s,i))/capacity(s,i);
}
export function solidHeight(state:Float32Array,i:number,grid:SphereGrid) {
  const p=i*STRIDE;
  return grid.geometry[i*4+3]+state[p]+state[p+1]+state[p+2]+state[p+3]
    +state[p+5]*1.09+state[p+6]*0.5+state[p+11]+state[p+12]+state[p+F.soil]*.6+state[p+F.iron]*.3;
}
/** Game approximation anchored at fresh water 0°C and marine salinity about -2°C. */
export function freezingPoint(water:number,dissolved:number) {
  const total=water+dissolved;return total>0?-Math.min(18,54*dissolved/total):0;
}
export const saturation=saturationMass;
export function vaporCapacity(s:Float32Array,i:number,t:number,e:Environment,phase:WaterPhase='water',activity=1){const p=i*STRIDE;return saturationMass(t,phase,s[p+F.nitrogen],s[p+F.methane],s[p+F.carbonDioxide],gravityMultiplier(e),activity);}
export function cellPressure(s:Float32Array,i:number,e:Environment){const p=i*STRIDE;return columnPressure(s[p+F.vapor]+s[p+F.nitrogen]+s[p+F.methane]+s[p+F.carbonDioxide],gravityMultiplier(e));}
export function cellHabitat(s:Float32Array,i:number,e:Environment,field:number,grid:SphereGrid){const p=i*STRIDE;if(field!==F.plant)return consumerHabitat(s[p+8],s[p+4],s[p+7],s[p+5],field===F.carnivore);const exposure=Math.max(0,grid.directions[i*3]*e.sun[0]+grid.directions[i*3+1]*e.sun[1]+grid.directions[i*3+2]*e.sun[2]);return habitat(s[p+8],s[p+4],s[p+7],s[p+5],transmittedLight(exposure,e.sunlight,s[p+16],s[p+17]))*(e.climate?pioneerRootability(s,p):1);}
export function totalMass(state:Float32Array) {
  let result=0;
  for(let p=0;p<state.length;p+=STRIDE) for(const f of MASS_FIELDS) result+=state[p+f];
  return result;
}
export function totals(state:Float32Array) {
  const result=new Float64Array(STRIDE);
  for(let p=0;p<state.length;p+=STRIDE) for(let f=0;f<STRIDE;f++) result[f]+=state[p+f];
  return result;
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
    for(const field of [F.nitrogen,F.methane,F.carbonDioxide])state[p+field]=0;
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
  step(dt:number,commands:Float32Array,environment:Environment):Promise<void>;
  replace(state:Float32Array):void;
  dispose():void;
}

export class CpuSolver implements Solver {
  readonly backend='CPU';
  readonly climate:WeatherClimate;
  private prepared:Float32Array;
  private next:Float32Array;
  private transported:Float64Array;
  private flux:Float32Array;
  private animalNavigation:AnimalNavigation;
  escapeCells:Float32Array;
  condensedCells:Float32Array;
  precipitatedCells:Float32Array;
  energyChanges:Float32Array;
  constructor(readonly grid:SphereGrid,public state:Float32Array) {
    this.climate=new WeatherClimate(grid);
    this.animalNavigation=new AnimalNavigation(grid);
    this.prepared=new Float32Array(state.length);this.next=new Float32Array(state.length);this.transported=new Float64Array(state.length);
    this.flux=new Float32Array(grid.count*NEIGHBORS*8);
    this.escapeCells=new Float32Array(grid.count*4);
    this.condensedCells=new Float32Array(grid.count);
    this.precipitatedCells=new Float32Array(grid.count*2);
    this.energyChanges=new Float32Array(grid.count*ENERGY_CHANNELS);
  }
  replace(state:Float32Array) {this.state=new Float32Array(state);this.escapeCells.fill(0);this.condensedCells.fill(0);this.precipitatedCells.fill(0);this.energyChanges.fill(0);}
  dispose() {}
  async step(dt:number,commands:Float32Array,environment:Environment) {
    this.advance(dt,commands,environment);
  }
  advance(dt:number,commands:Float32Array,environment:Environment) {
    this.escapeCells.fill(0);this.condensedCells.fill(0);this.precipitatedCells.fill(0);this.energyChanges.fill(0);
    if(dt<=0&&!commands.some(v=>v!==0))return;
    const steps=physicsSteps(dt),empty=steps.length>1?new Float32Array(commands.length):commands;
    const before=environment.climate?this.state.slice():undefined,climate=environment.climate?this.climate.checkpoint():undefined;
    try{for(let n=0;n<steps.length;n++)this.advanceSingle(steps[n],n===0?commands:empty,environment);}
    catch(error){if(before&&climate){this.state=before;this.climate.restoreCheckpoint(climate);this.escapeCells.fill(0);this.condensedCells.fill(0);this.precipitatedCells.fill(0);this.energyChanges.fill(0);}throw error;}
  }
  private advanceSingle(dt:number,commands:Float32Array,environment:Environment) {
    const {grid}=this, n=grid.count;
    this.prepared.set(this.state);
    if(environment.climate)this.climate.prepareSurface(this.prepared,environment);
    for(let i=0;i<n;i++){const before=enthalpy(this.prepared,i);applyCommand(this.prepared,i,commands);this.energyChanges[i*4+1]+=enthalpy(this.prepared,i)-before;}
    if(environment.climate)this.climate.surfaceSupplies(this.prepared,commands,COMMAND_STRIDE,this.energyChanges);
    if(dt<=0){if(environment.climate)this.climate.step(this.prepared,0,environment,this.energyChanges);this.next.set(this.prepared);const old=this.state;this.state=this.next;this.next=old;return;}
    this.flux.fill(0);
    for(let i=0;i<n;i++) {
      const p=i*STRIDE, s=this.prepared, h=solidHeight(s,i,grid), head=h+s[p+4];
      const wet=s[p+4]/Math.max(0.1,s[p]+s[p+1]);
      const repose=wet<0.025?0.58:wet<0.35?0.95:0.28;
      let waterSum=0,sandSum=0,claySum=0,cloudSum=0,meltSum=0;
      for(let k=0;k<NEIGHBORS;k++) {
        const edge=i*NEIGHBORS+k,j=grid.neighbors[edge];
        if(j===INVALID) continue;
        const hn=solidHeight(s,j,grid), o=edge*8, distance=grid.distances[edge];
        const gravity=gravityMultiplier(environment);
        this.flux[o]=Math.max(0,head-hn-s[j*STRIDE+4])*dt*1.1*gravity*edgeScale(distance);
        this.flux[o+1]=Math.max(0,h-hn-distance*repose)*dt*1.2*gravity*edgeScale(distance);
        this.flux[o+2]=Math.max(0,h-hn-distance*(wet>0.5?0.2:1.1))*dt*0.4*gravity*edgeScale(distance);
        this.flux[o+6]=Math.max(0,h-hn)*dt*meltMobility(s[p+8])*gravity*edgeScale(distance);meltSum+=this.flux[o+6];
        const fraction=environment.climate?0:cloudEdgeFraction(grid,i,j,dt,environment.sun,environment.rotationRate??0);
        this.flux[o+4]=fraction*s[p+F.cloud];this.flux[o+5]=fraction*s[p+F.cloudIce];cloudSum+=fraction;
        waterSum+=this.flux[o];sandSum+=this.flux[o+1];claySum+=this.flux[o+2];
      }
      // Organic soil retains capillary moisture; only surplus joins surface runoff.
      const mobileWater=Math.max(0,s[p+4]-Math.min(1.2,s[p+F.soil]*.12));
      const w=Math.min(1,mobileWater*0.35/Math.max(1e-8,waterSum));
      const a=Math.min(1,s[p]*0.25/Math.max(1e-8,sandSum));
      const c=Math.min(1,s[p+1]*0.2/Math.max(1e-8,claySum));
      for(let k=0;k<NEIGHBORS;k++) {
        const o=(i*NEIGHBORS+k)*8;
        this.flux[o]*=w;this.flux[o+1]*=a;this.flux[o+2]*=c;
        this.flux[o+3]=this.flux[o]*s[p+7]/Math.max(1e-6,s[p+4]);
        this.flux[o+6]*=Math.min(1,s[p+F.molten]*.2/Math.max(1e-8,meltSum));
        const cloudScale=Math.min(1,.45/Math.max(1e-8,cloudSum));this.flux[o+4]*=cloudScale;this.flux[o+5]*=cloudScale;
      }
    }
    this.transported.set(this.prepared);
    for(let i=0;i<n;i++) {
      const p=i*STRIDE,s=this.prepared;
      let energy=capacity(s,i)*s[p+8];
      let firingDose=s[p+F.clay]*s[p+F.firing];
      let conduction=0;
      for(let k=0;k<NEIGHBORS;k++) {
        const edge=i*NEIGHBORS+k,j=grid.neighbors[edge];
        if(j===INVALID) continue;
        let reciprocal=0;
        while(grid.neighbors[j*NEIGHBORS+reciprocal]!==i) reciprocal++;
        const out=edge*8, inc=(j*NEIGHBORS+reciprocal)*8;
        firingDose+=this.flux[inc+2]*s[j*STRIDE+F.firing]-this.flux[out+2]*s[p+F.firing];
        const fields=[4,0,1,7,F.cloud,F.cloudIce,F.molten];
        for(let f=0;f<7;f++) {
          const amountIn=this.flux[inc+f],amountOut=this.flux[out+f];
          this.transported[p+fields[f]]+=amountIn-amountOut;
          energy+=(amountIn*s[j*STRIDE+8]-amountOut*s[p+8])*CP[fields[f]];
        }
        // Plant dispersal remains a symmetric conservative exchange. Consumers
        // use the shared land navigation pass after local reactions.
        for(const field of [F.plant]){
          const diff=(s[j*STRIDE+field]*cellHabitat(s,i,environment,field,grid)-s[p+field]*cellHabitat(s,j,environment,field,grid))*Math.min(dt*(field===F.plant?.004:.025)*edgeScale(grid.distances[edge]),1/NEIGHBORS);
          this.transported[p+field]+=diff;energy+=diff*(diff>=0?s[j*STRIDE+8]:s[p+8]);
        }
        // Pairwise heat transfer is equal and opposite, even for different capacities.
        conduction+=(s[j*STRIDE+8]-s[p+8])*Math.min(dt*pairConductance(conductivity(s,p),conductivity(s,j*STRIDE))*edgeScale(grid.distances[edge]),Math.min(capacity(s,i),capacity(s,j))/(2*NEIGHBORS));
        for(const field of GAS_FIELDS) {
          // Symmetric, bounded diffusion moves gas and its sensible heat without a sink.
          const rate=Math.min(dt*(field===F.vapor?.28:.6)*edgeScale(grid.distances[edge]),1/NEIGHBORS);
          const diff=(s[j*STRIDE+field]-s[p+field])*rate;
          this.transported[p+field]+=diff;energy+=diff*CP[field]*(diff>=0?s[j*STRIDE+8]:s[p+8]);
        }
      }
      for(let f=0;f<STRIDE;f++)this.next[p+f]=this.transported[p+f];
      this.next[p+8]=(energy+conduction)/capacity(this.next,i);
      // Account for the actual Float64 → Float32 inventory/temperature writes;
      // the conservative transport itself has no external energy source.
      let transportedPhase=0;for(const f of MASS_FIELDS)transportedPhase+=this.transported[p+f]*PHASE_ENERGY[f];
      this.energyChanges[i*4+3]+=enthalpy(this.next,i)-(energy+conduction+transportedPhase);
      this.next[p+F.firing]=this.next[p+F.clay]>1e-8?Math.max(0,firingDose)/this.next[p+F.clay]:0;
      react(this.next,i,dt,environment,grid,this.escapeCells,this.condensedCells,this.precipitatedCells,this.energyChanges);
    }
    this.animalNavigation.move(this.next,dt,environment,this.energyChanges);
    if(environment.climate)this.climate.step(this.next,dt,environment,this.energyChanges,this.condensedCells,this.precipitatedCells,this.escapeCells);
    const old=this.state;this.state=this.next;this.next=old;
  }
}

export function applyCommand(s:Float32Array,i:number,commands:Float32Array,collected?:Stock) {
  const p=i*STRIDE,c=i*COMMAND_STRIDE;
  let edited=false;for(let k=0;k<COMMAND_STRIDE;k++)if(commands[c+k]!==0){edited=true;break;}if(!edited)return;
  const old=capacity(s,i),dose=s[p+F.clay]*s[p+F.firing];let inputHeat=0;
  const fields=[4,0,1,6,13,14,15,5,2,3,18,19,20,21,22],offsets=[0,1,2,3,8,9,10,12,13,14,15,16,17,18,19];
  for(let k=0;k<fields.length;k++) {
    const field=fields[k],amount=commands[c+offsets[k]];s[p+field]+=amount;inputHeat+=amount*CP[field]*SUPPLY_TEMPERATURE[field];
  }
  const after=capacity(s,i);if(after!==old||commands[c+4]!==0)s[p+8]=(s[p+8]*old+inputHeat+commands[c+4])/after;
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
}

export function react(s:Float32Array,i:number,dt:number,e:Environment,grid:SphereGrid,escaped?:Float32Array,condensed?:Float32Array,precipitated?:Float32Array,energyChanges?:Float32Array) {
  if(dt<=0)return;
  const p=i*STRIDE;
  const beforeClamp=enthalpy(s,i);
  for(const f of MASS_FIELDS) s[p+f]=Math.max(0,s[p+f]);
  if(energyChanges)energyChanges[i*4+3]+=enthalpy(s,i)-beforeClamp;
  let c=capacity(s,i),t=s[p+8];
  const dot=Math.max(0,grid.directions[i*3]*e.sun[0]+grid.directions[i*3+1]*e.sun[1]+grid.directions[i*3+2]*e.sun[2]);
  const surfaceAlbedo=albedo(s,p);
  // External solar/atmosphere energy, with greater thermal inertia in wet regions.
  const light=transmittedLight(dot,e.sunlight,s[p+F.cloud],s[p+F.cloudIce]);
  const equilibrium=thermalTarget(e.ambient,e.sunlight,light,surfaceAlbedo);
  const external=e.climate?0:bathHeat(c,t,equilibrium,dt);t+=external/c;
  if(energyChanges)energyChanges[i*4]+=external;
  s[p+8]=t;
  equilibrateWater(s,i);t=s[p+8];c=capacity(s,i);
  const tf=freezingPoint(s[p+4],s[p+7]),activity=waterActivity(s[p+4],s[p+7]),boiling=s[p+4]+s[p+5]+s[p+9]+s[p+16]+s[p+17]>0?boilingPoint(cellPressure(s,i,e),activity):100;
  if(!e.climate&&s[p+4]>0 && t>tf+0.3) {
    const dry=Math.max(0,1-s[p+9]/Math.max(1e-12,vaporCapacity(s,i,t,e,'water',activity)));
    const evaporate=Math.max(0,t+8)*0.0001*dry*dt+Math.max(0,t-boiling)*c/(2475-2.18*boiling);
    const amount=Math.min(s[p+4],evaporate,Math.max(0,(t-tf)*c/(2475-2.18*tf)));
    s[p+4]-=amount;s[p+9]+=amount;
    t=(c*t-amount*2475)/capacity(s,i);
    c=capacity(s,i);
  }
  // Sublimation spends the same declared phase energy as cloud ice evaporation.
  if(!e.climate&&s[p+F.ice]>0&&t<=tf+.3){
    const dry=Math.max(0,1-s[p+F.vapor]/Math.max(1e-12,vaporCapacity(s,i,t,e,'ice')));
    const before=s[p+F.ice],requested=Math.min(before,before*dry*dt*.002,Math.max(0,(t+100)*c/2819));
    s[p+F.ice]-=requested;const amount=before-s[p+F.ice];s[p+F.vapor]+=amount;t=(c*t-amount*2809)/capacity(s,i);c=capacity(s,i);
  }
  if(!e.climate){
  // A diagnostic upper-column temperature, not a second stored heat reservoir.
  // A 0.001°C nucleation guard avoids opposite phase choices at a Float32 freezing plateau.
  const airTemperature=t-CLOUD_COOLING,airIce=airTemperature< -12.001;
  const cloudMass=s[p+F.cloud]+s[p+F.cloudIce],iceShare=cloudMass>1e-8?s[p+F.cloudIce]/cloudMass:(airIce?1:0);
  const airSaturation=vaporCapacity(s,i,airTemperature,e)*(1-iceShare)+vaporCapacity(s,i,airTemperature,e,'ice')*iceShare;
  const excess=s[p+F.vapor]-airSaturation,latent=2475;
  if(excess>0 && airTemperature<boiling-5){
    const amount=Math.min(s[p+F.vapor],excess*(1-Math.exp(-dt*.4))),before=s[p+F.vapor];
    s[p+F.vapor]-=amount;s[p+(airIce?F.cloudIce:F.cloud)]+=amount;
    if(condensed)condensed[i]+=before-s[p+F.vapor];
    t=(c*t+amount*(latent+(airIce?ICE_LATENT:0)))/capacity(s,i);c=capacity(s,i);
  } else if(excess<0) {
    const cloud=s[p+F.cloud]+s[p+F.cloudIce];
    const amount=Math.min(cloud,-excess*(1-Math.exp(-dt*.2)),Math.max(0,(t+100)*c/(latent+ICE_LATENT)));
    if(amount>0){const ice=Math.min(s[p+F.cloudIce],amount*s[p+F.cloudIce]/Math.max(1e-8,cloud)),water=Math.min(s[p+F.cloud],Math.max(0,amount-ice)),evaporated=water+ice;s[p+F.cloud]-=water;s[p+F.cloudIce]-=ice;s[p+F.vapor]+=evaporated;t=(c*t-evaporated*latent-ice*ICE_LATENT)/capacity(s,i);c=capacity(s,i);}
  }
  if(t-CLOUD_COOLING< -12 && s[p+F.cloud]>0){const amount=Math.min(s[p+F.cloud],-t*c/ICE_LATENT,s[p+F.cloud]*dt*.08);s[p+F.cloud]-=amount;s[p+F.cloudIce]+=amount;t=(c*t+amount*ICE_LATENT)/capacity(s,i);c=capacity(s,i);}
  if(t-CLOUD_COOLING>0 && s[p+F.cloudIce]>0){const amount=Math.min(s[p+F.cloudIce],(t-CLOUD_COOLING)*c/(ICE_LATENT+2.08*CLOUD_COOLING),s[p+F.cloudIce]*dt*.15);s[p+F.cloudIce]-=amount;s[p+F.cloud]+=amount;t=(c*t-amount*ICE_LATENT)/capacity(s,i);c=capacity(s,i);}
  }
  const latent=2475;
  const rain=Math.max(0,s[p+F.cloud]-RAIN_THRESHOLD)*(1-Math.exp(-dt*.22*Math.sqrt(gravityMultiplier(e))));
  const snow=Math.max(0,s[p+F.cloudIce]-SNOW_THRESHOLD)*(1-Math.exp(-dt*.12*Math.sqrt(gravityMultiplier(e))));
  s[p+F.cloud]-=rain;s[p+F.cloudIce]-=snow;
  const dry=Math.max(0,1-s[p+F.vapor]/Math.max(1e-12,vaporCapacity(s,i,t,e)));
  const returning=Math.min(.85,dry*Math.max(0,t+10)/80)*(rain+snow);
  s[p+F.vapor]+=returning;
  const reaching=rain+snow-returning,iceBeforeRain=s[p+F.ice],groundIce=t<freezingPoint(s[p+4]+rain+snow,s[p+7]);
  s[p+(groundIce?F.ice:F.water)]+=reaching;
  const sourcePhase=-snow*ICE_LATENT,destinationPhase=returning*latent-(groundIce?reaching*ICE_LATENT:0);
  t=(c*t+sourcePhase-destinationPhase)/capacity(s,i);c=capacity(s,i);
  if(s[p+1]>0.0001 && s[p+4]/Math.max(.1,s[p+1])<0.008 && t>=850) {
    s[p+10]+=dt;
    if(s[p+10]>=30) {
      // Bound hydroxyl water and detailed mineral transformations are lumped here.
      const heat=c*t;s[p+2]+=s[p+1];s[p+1]=0;s[p+10]=0;c=capacity(s,i);t=heat/c;
    }
  }
  if(t>1700 && s[p]>0) {
    const amount=Math.min(s[p],dt*(t-1700)*0.005,c*(t-1700)/150);
    s[p]-=amount;s[p+11]+=amount;t-=amount*150/c;
  }
  if(t>GLASS_SOFTENING && s[p+F.glass]>0){const amount=Math.min(s[p+F.glass],dt*3*Math.min(1,(t-GLASS_SOFTENING)/200));s[p+F.glass]-=amount;s[p+F.molten]+=amount;}
  if(t<1400 && s[p+11]>0) {
    const amount=Math.min(s[p+11],dt*3);
    s[p+11]-=amount;s[p+3]+=amount;
  }
  // Rain, evaporation and salt concentration share the same final ground-phase policy.
  s[p+8]=t;equilibrateWater(s,i);t=s[p+8];c=capacity(s,i);
  if(precipitated){const frozen=Math.min(reaching,Math.max(0,s[p+F.ice]-iceBeforeRain));precipitated[i*2]+=reaching-frozen;precipitated[i*2+1]+=frozen;}
  const life=foodWeb(s[p+F.soil],s[p+F.plant],s[p+F.herbivore],s[p+F.carnivore],habitat(t,s[p+F.water],s[p+F.dissolved],s[p+F.ice],light)*(e.climate?pioneerRootability(s,p):1),dt,consumerHabitat(t,s[p+4],s[p+7],s[p+5]),consumerHabitat(t,s[p+4],s[p+7],s[p+5],true));
  s[p+F.soil]=life[0];s[p+F.plant]=life[1];s[p+F.herbivore]=life[2];s[p+F.carnivore]=life[3];
  s[p+8]=Math.max(-100,Math.min(2500,t));
  if(energyChanges)energyChanges[i*4+3]+=c*(s[p+8]-t);
  for(let k=0;k<GASES.length;k++) {
    const gas=GASES[k],before=s[p+gas.field];
    s[p+gas.field]=before*(1-thermalEscapeFraction(s[p+8],gravityMultiplier(e),gas.molarMass,dt));
    const removed=before-s[p+gas.field];
    if(escaped)escaped[i*4+k]+=removed;
    if(energyChanges)energyChanges[i*4+2]-=removed*(CP[gas.field]*s[p+8]+PHASE_ENERGY[gas.field]);
  }
}

export function physicalRadius(state:Float32Array,i:number,grid:SphereGrid) {
  return 4.8+solidHeight(state,i,grid)*HEIGHT_SCALE;
}
