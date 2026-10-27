// @ts-nocheck -- immutable pre-optimization fixture; production nominal types may evolve.
// Only import paths differ; normalize them to verify the original captured source SHA-256.
/** Empirical sandbox species. Organic soil and every biomass guild use CH₂O;
 * minerals retain their inert empirical composition through structural changes.
 * Integer atomic weights are one coherent game convention, not isotope data. */
export const ATOMIC_MASS={H:1,C:12,O:16,N:14,Si:28,Al:27,Na:23,Cl:35.5,Fe:56,He:4} as const;
export type Element=keyof typeof ATOMIC_MASS;
export type Formula=Partial<Record<Element,number>>;
const water={H:2,O:1},organic={C:1,H:2,O:1},silica={Si:1,O:2},clay={Al:2,Si:2,O:9,H:4},salt={Na:1,Cl:1};
export const FORMULAS:Readonly<Record<number,Formula>>={
 0:silica,1:clay,2:clay,3:silica,4:water,5:water,6:salt,7:salt,9:water,11:silica,12:silica,
 13:{N:2},14:{C:1,H:4},15:{C:1,O:2},16:water,17:water,18:organic,19:organic,20:organic,21:organic,
 22:{Fe:1},23:organic,24:{C:1,O:2},25:silica,26:silica,27:{O:2},28:{H:2},29:{He:1},30:{N:1,H:3},31:{N:1,H:3},32:{N:1,H:3},34:{C:1},35:{C:1,O:1},36:{C:1},
};
export function formulaMass(field:number){const formula=FORMULAS[field];if(!formula)throw new Error('화학 조성이 없는 재료입니다.');return Object.entries(formula).reduce((m,[e,n])=>m+n*ATOMIC_MASS[e as Element],0);}
export function elementalMass(stock:ArrayLike<number>,offset=0){
 const result=Object.fromEntries(Object.keys(ATOMIC_MASS).map(e=>[e,0])) as Record<Element,number>;
 for(const [key,formula] of Object.entries(FORMULAS)){const f=Number(key),mass=stock[offset+f]??0,molar=formulaMass(f);for(const [e,n] of Object.entries(formula))result[e as Element]+=mass*n*ATOMIC_MASS[e as Element]/molar;}
 return result;
}
