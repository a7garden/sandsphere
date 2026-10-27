// @ts-nocheck -- immutable pre-optimization fixture; production nominal types may evolve.
// Only import paths differ; normalize them to verify the original captured source SHA-256.
import {FORMULAS,ATOMIC_MASS,formulaMass,type Element} from './chemistry';
import {CHEMICAL_ENERGY,SPECIFIC_HEAT,MATERIAL_ENERGY,MIN_THERMODYNAMIC_TEMPERATURE} from './thermodynamics';
import {exactStockTransfer} from './solidMechanics';
export type ReactionTerm=readonly [field:number,mass:number];
export interface MaterialReaction {
 readonly consumed:readonly ReactionTerm[];
 readonly produced:readonly ReactionTerm[];
 readonly exactTransfer?:boolean;
}

/** Finite mass transfer. Chemical reactions use stoichiometricReaction below. */
export function materialReaction(consumed:readonly ReactionTerm[],produced:readonly ReactionTerm[],options:{exactTransfer?:boolean}={}):MaterialReaction {
 const total=(terms:readonly ReactionTerm[])=>terms.reduce((sum,[field,mass])=>{
  if(!Number.isInteger(field)||field<0||field>=CHEMICAL_ENERGY.length||!Number.isFinite(mass)||mass<=0)throw new Error('반응 계수가 올바르지 않습니다.');
  return sum+mass;
 },0);
 if(!consumed.length||!produced.length||Math.abs(total(consumed)-total(produced))>1e-12)throw new Error('반응의 질량 수지가 맞지 않습니다.');
 if(new Set(consumed.map(([f])=>f)).size!==consumed.length||new Set(produced.map(([f])=>f)).size!==produced.length)throw new Error('반응 성분을 중복 선언할 수 없습니다.');
 if(options.exactTransfer&&(consumed.length!==1||produced.length!==1||consumed[0][1]!==produced[0][1]))throw new Error('정확한 재고 전달은 일대일 반응에만 적용할 수 있습니다.');
 return {consumed,produced,...(options.exactTransfer?{exactTransfer:true}:{} )};
}

/** Limit the extent by every reactant before writing any stock. Energy is
 * restored by the owning reservoir using the shared enthalpy/material table. */
export function reactInventory(stock:number[]|Float32Array|Float64Array,offset:number,reaction:MaterialReaction,requested:number){
 if(!Number.isFinite(requested))throw new Error('반응량은 유한해야 합니다.');
 let extent=Math.max(0,requested);
 for(const [field,mass] of reaction.consumed)extent=Math.min(extent,Math.max(0,stock[offset+field])/mass);
 if(extent===0)return 0;
 // An opted-in one-to-one transfer needs the same represented debit
 // and credit, not merely a nonzero write at both ends. In particular repeated
 // soot settling must not round every tiny charcoal credit upward. An event
 // too small to fit stays in the original stock until a full parcel fits.
 if(stock instanceof Float32Array&&reaction.exactTransfer){
  const [from,coefficient]=reaction.consumed[0],[to]=reaction.produced[0],a=stock[offset+from],b=stock[offset+to];
  if(from===to)return extent;
  const amount=exactStockTransfer(a,b,extent*coefficient);if(amount<=0)return 0;
  const nextA=Math.fround(a-amount),nextB=Math.fround(b+amount),debit=a-nextA,credit=nextB-b;
  if(debit!==credit||debit<=0)return 0;
  stock[offset+from]=nextA;stock[offset+to]=nextB;return debit/coefficient;
 }
 // A sub-ULP debit must not create representable products from an unchanged
 // reactant. Round consumption toward the available budget, never above it.
 if(stock instanceof Float32Array){
  // Never debit a resource if a product cannot yet represent its increment.
  // Photon energy can accumulate in the caller until a complete event fits.
  for(const [field,mass] of reaction.produced)if(Math.fround(stock[offset+field]+extent*mass)===stock[offset+field])return 0;
  for(const [field,mass] of reaction.consumed)if(Math.fround(stock[offset+field]-extent*mass)===stock[offset+field])return 0;
 }

 for(const [field,mass] of reaction.consumed)stock[offset+field]=Math.max(0,stock[offset+field]-extent*mass);
 for(const [field,mass] of reaction.produced)stock[offset+field]+=extent*mass;
 return extent;
}

/** Positive cost stores energy in products. The caller conserves total
 * material + sensible energy; this budget only limits photon-driven reactions. */
export function chemicalCost(reaction:MaterialReaction){
 const energy=(terms:readonly ReactionTerm[])=>terms.reduce((h,[f,m])=>h+m*CHEMICAL_ENERGY[f],0);
 return energy(reaction.produced)-energy(reaction.consumed);
}
export function photoreaction(stock:Float32Array|Float64Array,offset:number,reaction:MaterialReaction,requested:number,photons:number){
 const cost=chemicalCost(reaction);if(cost<=0)throw new Error('광반응은 양의 저장 에너지가 필요합니다.');
 let extent=Math.min(requested,Math.max(0,photons)/cost);
 for(const [f,m] of reaction.consumed)extent=Math.min(extent,stock[offset+f]/m);
 const rounded=stock instanceof Float32Array?Math.fround:(value:number)=>value;
 const energyChange=(amount:number)=>reaction.produced.reduce((v,[f,m])=>v+(rounded(stock[offset+f]+amount*m)-stock[offset+f])*CHEMICAL_ENERGY[f],0)+reaction.consumed.reduce((v,[f,m])=>v+(rounded(Math.max(0,stock[offset+f]-amount*m))-stock[offset+f])*CHEMICAL_ENERGY[f],0);
 for(let pass=0;pass<12&&extent>0;pass++){
  const stored=Math.max(extent*cost,energyChange(extent));
  if(stored<=0)return 0;
  if(stored<=photons){return reactInventory(stock,offset,reaction,extent)>0?stored:0;}
  extent*=Math.min(.95,photons/stored);
 }
 return 0;
}

/** Molar coefficients are compiled once into mass coefficients normalized to
 * one kg of the first reactant. Reject element imbalance before execution. */
export function stoichiometricReaction(consumed:readonly ReactionTerm[],produced:readonly ReactionTerm[],options:{exactTransfer?:boolean}={}):MaterialReaction {
 for(const element of Object.keys(ATOMIC_MASS) as Element[]){
  const atoms=(terms:readonly ReactionTerm[])=>terms.reduce((n,[f,c])=>{if(!FORMULAS[f])throw new Error('화학 조성이 없는 재료입니다.');return n+c*(FORMULAS[f][element]??0);},0);
  if(Math.abs(atoms(consumed)-atoms(produced))>1e-12)throw new Error(`반응의 ${element} 원소 수지가 맞지 않습니다.`);
 }
 const scale=consumed[0][1]*formulaMass(consumed[0][0]);
 const masses=(terms:readonly ReactionTerm[])=>terms.map(([f,c])=>[f,c*formulaMass(f)/scale] as const);
 return materialReaction(masses(consumed),masses(produced),options);
}

/** Endothermic feedstock stays intact when cooling would exhaust available
 * heat. An optional physical process ceiling is not a global temperature cap;
 * ordinary combustion spends finite fuel and has no prescribed final T. */
export function thermalReactionLimit(reaction:MaterialReaction,requested:number,temperature:number,capacity:number,maxTemperature=Infinity,fixedTemperatureFields:readonly number[]=[],fixedTemperature=temperature,minTemperature=MIN_THERMODYNAMIC_TEMPERATURE){
 const change=(table:readonly number[])=>reaction.produced.reduce((v,[f,m])=>v+m*table[f],0)-reaction.consumed.reduce((v,[f,m])=>v+m*table[f],0);
 const fixed=SPECIFIC_HEAT.map((cp,f)=>fixedTemperatureFields.includes(f)?cp:0),variable=SPECIFIC_HEAT.map((cp,f)=>cp-fixed[f]);
 const heating=Number.isFinite(maxTemperature)?-change(MATERIAL_ENERGY)-fixedTemperature*change(fixed)-maxTemperature*change(variable):0;
 const cooling=change(MATERIAL_ENERGY)+fixedTemperature*change(fixed)+minTemperature*change(variable);
 let extent=Math.max(0,requested);
 if(heating>0)extent=Math.min(extent,Math.max(0,(maxTemperature-temperature)*capacity/heating));
 if(cooling>0)extent=Math.min(extent,Math.max(0,(temperature-minTemperature)*capacity/cooling));
 return extent;
}
