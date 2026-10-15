import {SPECIFIC_HEAT,BASE_CAPACITY,MATERIAL_ENERGY} from './thermodynamics';
/** Biomass guilds and deliberately broad tolerances, not individual species physiology. */
import {materialReaction,stoichiometricReaction,reactInventory,photoreaction,thermalReactionLimit,type MaterialReaction} from './materialReaction';
/** Food-web arrays are a compact adapter of the same CH₂O species rules. */
const foodReaction=(consumed:readonly (readonly [number,number])[],produced:readonly (readonly [number,number])[])=>{
 const rule=stoichiometricReaction(consumed.map(([f,m])=>[f+18,m]),produced.map(([f,m])=>[f+18,m]));
 return materialReaction(rule.consumed.map(([f,m])=>[f-18,m]),rule.produced.map(([f,m])=>[f-18,m]));
};
const grazing=foodReaction([[1,1]],[[2,.36],[0,.64]]),hunting=foodReaction([[2,1]],[[3,.3],[0,.7]]);
const decay=[1,2,3].map(f=>foodReaction([[f,1]],[[0,1]]));
/** All reactive stocks share empirical CH₂O. Rate constants and ignition
 * temperatures are sandbox kinetics; atom counts are exact. */
export const BIO_REACTIONS={
 sprout:stoichiometricReaction([[23,1]],[[19,1]]),seed:stoichiometricReaction([[19,1]],[[23,1]]),seedDecay:stoichiometricReaction([[23,1]],[[18,1]]),
 uptake:stoichiometricReaction([[15,1],[4,1]],[[19,1],[27,1]]),
 germinate:stoichiometricReaction([[18,1]],[[19,1]]),
 respire:stoichiometricReaction([[18,1],[27,1]],[[15,1],[4,1]]),
 ferment:stoichiometricReaction([[18,2]],[[14,1],[15,1]]),
 thermal:stoichiometricReaction([[18,1],[27,1]],[[15,1],[4,1]]),
 methane:stoichiometricReaction([[14,1],[27,2]],[[15,1],[4,2]]),
};
export const METHANE_COMBUSTION={field:14,ignition:500,reaction:BIO_REACTIONS.methane,
 incomplete:stoichiometricReaction([[14,2],[27,3]],[[35,2],[4,4]]),
 smoky:stoichiometricReaction([[14,1],[27,1]],[[36,1],[4,2]])};
export const combustionRate=(temperature:number,ignition:number)=>Math.min(8,Math.max(0,(temperature-ignition)/100));
export interface CombustionRule {field:number;ignition:number;reaction:MaterialReaction;incomplete?:MaterialReaction;smoky?:MaterialReaction;}
export const COMBUSTION_REACTIONS:CombustionRule[]=[METHANE_COMBUSTION,
 ...[18,19,20,21,23].map(field=>({field,ignition:250,
 reaction:stoichiometricReaction([[field,1],[27,1]],[[15,1],[4,1]]),
 incomplete:stoichiometricReaction([[field,2],[27,1]],[[35,2],[4,2]])})),
 ...[34,36].map(field=>({field,ignition:350,reaction:stoichiometricReaction([[field,1],[27,1]],[[15,1]]),incomplete:stoichiometricReaction([[field,2],[27,1]],[[35,2]])})),
 {field:35,ignition:350,reaction:stoichiometricReaction([[35,2],[27,1]],[[15,2]])},
];
export const PYROLYSIS_REACTIONS=[18,19,20,21,23].map(field=>({field,ignition:300,reaction:stoichiometricReaction([[field,1]],[[34,.8],[36,.2],[4,1]])}));
export const MIN_COMBUSTION_TEMPERATURE=Math.min(...COMBUSTION_REACTIONS.map(r=>r.ignition),...PYROLYSIS_REACTIONS.map(r=>r.ignition));
/** Local O₂/fuel inventory chooses a continuous blend. Use stock, not dt-sized
 * demand, so smaller timesteps do not silently turn oxygen-poor flames complete. */
export function oxidationRoutes(def:typeof COMBUSTION_REACTIONS[number],fuel:number,oxygen:number,dt:number,t:number){
 const demand=fuel*-Math.expm1(-Math.max(0,dt)*combustionRate(t,def.ignition));
 const required=def.reaction.consumed.find(([f])=>f===27)![1];
 const availability=oxygen/Math.max(1e-30,fuel*required);
 const complete=def.incomplete?Math.max(0,Math.min(1,2*availability-1)):1;
 const smoky='smoky' in def&&def.smoky?Math.max(0,Math.min(1,1-2*availability)):0;
 return [{reaction:def.reaction,requested:demand*complete},...('incomplete' in def&&def.incomplete?[{reaction:def.incomplete,requested:demand*(1-complete-smoky)}]:[]),...('smoky' in def&&def.smoky?[{reaction:def.smoky,requested:demand*smoky}]:[])];
}
/** Each event conserves reservoir enthalpy. Unavailable oxygen or heat leaves
 * reactants intact; products become ordinary fuel for subsequent local events. */
export function combust(s:Float32Array,p:number,dt:number,temperature:number,fixedTemperatureFields:readonly number[]=[]){
 if(temperature<=MIN_COMBUSTION_TEMPERATURE||dt<=0)return 0;
 let burned=0,t=temperature;
 const capacity=()=>SPECIFIC_HEAT.reduce((c,cp,f)=>c+(fixedTemperatureFields.includes(f)?0:s[p+f]*cp),BASE_CAPACITY);
 const phase=()=>MATERIAL_ENERGY.reduce((h,e,f)=>h+s[p+f]*(e+(fixedTemperatureFields.includes(f)?SPECIFIC_HEAT[f]*temperature:0)),0);
 const run=(reaction:ReturnType<typeof stoichiometricReaction>,requested:number,floor=-100)=>{
  if(requested<=0)return 0;
  const h=capacity()*t+phase();
  const extent=reactInventory(s,p,reaction,thermalReactionLimit(reaction,requested,t,capacity(),2400,fixedTemperatureFields,temperature,floor));
  t=(h-phase())/capacity();return extent;
 };
 for(const def of COMBUSTION_REACTIONS){
  if(fixedTemperatureFields.includes(def.field)||s[p+def.field]<=0||s[p+27]<=0)continue;
  for(const route of oxidationRoutes(def,s[p+def.field],s[p+27],dt,t))burned+=run(route.reaction,route.requested);
 }
 for(const def of PYROLYSIS_REACTIONS){
  const oxygenRatio=s[p+27]/Math.max(1e-30,s[p+def.field]*32/30);
  const anoxic=Math.max(0,1-oxygenRatio),rate=combustionRate(t,def.ignition)*.2*anoxic;
  if(rate>0)run(def.reaction,s[p+def.field]*-Math.expm1(-Math.max(0,dt)*rate),def.ignition);
 }
 return burned;
}
export function openSurfaceWater(water:number,soil:number){return Math.max(0,water-Math.min(1.2,soil*.12))>=.035;}
export function habitat(temperature:number,water:number,salt:number,ice:number,light:number){
 const warmth=Math.max(0,1-Math.abs(temperature-22)/32);
 const moisture=Math.min(1,water/.12)*Math.max(0,1-water/5);
 const salinity=Math.max(0,1-salt/Math.max(.001,water)*8);
 return warmth*moisture*salinity*Math.exp(-ice*2)*Math.min(1,Math.max(0,light)*1.8);
}
export function consumerHabitat(temperature:number,water:number,salt:number,ice:number,predator=false){
 const warmth=Math.max(0,1-Math.abs(temperature-(predator?26:22))/(predator?50:45));
 return warmth*Math.min(1,water/.04)*Math.max(0,1-water/7)*Math.max(0,1-salt/Math.max(.001,water)*6)*Math.exp(-ice*.7);
}
/** Travel can cross dry land even when the local feeding habitat lacks water. */
export function consumerTravelHabitat(temperature:number,water:number,salt:number,ice:number,predator=false){
 const warmth=Math.max(0,1-Math.abs(temperature-(predator?26:22))/(predator?50:45));
 return warmth*Math.max(0,1-salt/Math.max(.001,water)*6)*Math.exp(-ice*.7);
}
export function foodWeb(soil:number,plant:number,herbivore:number,carnivore:number,suitability:number,dt:number,herbivoreHabitat=1,carnivoreHabitat=1,feeding?:Float32Array,offset=0){
 const stock=[soil,plant,herbivore,carnivore];
 const hunted=Math.min(herbivore,carnivore*.075*carnivoreHabitat*dt),grazed=reactInventory(stock,0,grazing,herbivore*.12*herbivoreHabitat*dt);
 reactInventory(stock,0,hunting,hunted);
 if(feeding){feeding[offset]+=grazed;feeding[offset+1]+=hunted;}
 reactInventory(stock,0,decay[0],stock[1]*(.00015+(1-suitability)*.001)*dt);
 reactInventory(stock,0,decay[1],stock[2]*(.003+(grazed<stock[2]*.015*dt?.018:0)+(1-herbivoreHabitat)*.12)*dt);
 reactInventory(stock,0,decay[2],stock[3]*(.002+(hunted<stock[3]*.008*dt?.012:0)+(1-carnivoreHabitat)*.1)*dt);
 return stock as [number,number,number,number];
}

/** Absorbed shortwave has already entered the heat budget. At most this
 * fraction can be diverted into chemical bonds; unused photons remain heat. */
export const PHOTOCHEMICAL_FRACTION=.25;

export interface EcologyConditions {temperature:number;light:number;absorbedSolar:number;rootability:number;fixedTemperatureFields?:readonly number[];combustionHandled?:boolean;}
/** Same local reaction network in simple and layered climate. Temperature,
 * water/salt, catalysts and available photons choose rates, never world names.
 * The owning reservoir restores TOTAL energy after all inventory changes. */
export function reactEcosystem(s:Float32Array,p:number,dt:number,c:EcologyConditions,feeding?:Float32Array,offset=0){
 if(dt<=0)return 0;
 const physical=habitat(c.temperature,s[p+4],s[p+7],s[p+5],1),suitable=physical*Math.min(1,Math.max(0,c.light)*1.8)*c.rootability;
 // Finite excitation energy survives sub-ULP reaction events and save/reload.
 // Its unspent part relaxes back to heat; field 33 is energy, never mass.
 s[p+33]*=Math.exp(-dt*.01);
 if(s[p+19]+s[p+23]>0)s[p+33]+=Math.max(0,c.absorbedSolar)*PHOTOCHEMICAL_FRACTION;
 let photons=s[p+33];const available=photons;
 // A seed moves its existing biomass/energy. A dispersal index alone cannot
 // create a new organism: actual seed or plant must be present locally.
 reactInventory(s,p,BIO_REACTIONS.sprout,s[p+23]*.03*suitable*dt);
 reactInventory(s,p,BIO_REACTIONS.seed,s[p+19]*-Math.expm1(-dt*.0003*suitable));
 reactInventory(s,p,BIO_REACTIONS.seedDecay,s[p+23]*-Math.expm1(-dt*.0001));
 if(s[p+19]+s[p+23]>0){
  const demand=(s[p+19]*.065+s[p+23]*.008)*suitable*dt;
  photons-=photoreaction(s,p,BIO_REACTIONS.uptake,demand,photons);
  // Organic uptake is a composition-preserving transfer, not photosynthesis.
  reactInventory(s,p,BIO_REACTIONS.germinate,s[p+19]*.085*suitable*dt);
 }
 const stocks=foodWeb(s[p+18],s[p+19],s[p+20],s[p+21],physical,dt,
  consumerHabitat(c.temperature,s[p+4],s[p+7],s[p+5]),consumerHabitat(c.temperature,s[p+4],s[p+7],s[p+5],true),feeding,offset);
 for(let k=0;k<4;k++)s[p+18+k]=stocks[k];
 const moisture=Math.min(1,s[p+4]/.12)*Math.max(0,1-s[p+7]/Math.max(.001,s[p+4])*8),warmth=Math.max(0,1-Math.abs(c.temperature-30)/50);
 // Anoxic wet substrate ferments; aerobic respiration consumes actual O₂.
 const anoxic=1/(1+s[p+27]/.01);
 reactInventory(s,p,BIO_REACTIONS.ferment,s[p+18]*-Math.expm1(-dt*.001*moisture*warmth*anoxic));
 reactInventory(s,p,BIO_REACTIONS.respire,s[p+18]*-Math.expm1(-dt*.0002*warmth));
 if(!c.combustionHandled)combust(s,p,dt,c.temperature,c.fixedTemperatureFields);
 s[p+33]=Math.max(0,photons);
 return available-photons;
}
