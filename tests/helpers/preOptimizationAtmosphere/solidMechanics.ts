// @ts-nocheck -- immutable pre-optimization fixture; production nominal types may evolve.
// Only import paths differ; normalize them to verify the original captured source SHA-256.
import {roundedSurfaceStock} from './co2Ice';

/** Effective occupied column thickness per model kg. These are the same game
 * volumes used for terrain relief, not measured densities of real minerals. */
export const SOLID_VOLUMES:readonly (readonly [number,number])[]=[
 [0,1],[1,1],[2,1],[3,1],[5,1.09],[6,.5],[11,1],[12,1],
 [18,.6],[22,.3],[24,.64],[25,1],[34,.8],
];
export function solidInventory(s:ArrayLike<number>,p:number){
 let mass=0,thickness=0;for(const [field,volume] of SOLID_VOLUMES){mass+=s[p+field];thickness+=s[p+field]*volume;}
 return {mass,thickness};
}
export function solidThickness(s:ArrayLike<number>,p:number){let height=0;for(const [field,volume] of SOLID_VOLUMES)height+=s[p+field]*volume;return height;}
/** The unresolved solid bed is uniformly mixed through its occupied thickness.
 * Its gravitational energy uses that layer's centre of mass. Water loads the
 * bed from above. No elastic energy or solid momentum is represented. */
export function mixedBedPotential(s:ArrayLike<number>,p:number,base:number,gravityHeight:number){
 const {mass,thickness}=solidInventory(s,p);return mass===0||gravityHeight===0?0:gravityHeight*mass*(base+thickness/2);
}
/** Derivative of combined solid + liquid potential with respect to one solid
 * material. For a same-material pair transfer q, delta U is
 * q*(derivative_receiver-derivative_donor)+gravityHeight*volume*q². */
export function solidPotentialDerivative(s:ArrayLike<number>,p:number,base:number,gravityHeight:number,volume:number,liquid:number){
 const {mass,thickness}=solidInventory(s,p);return gravityHeight*(base+thickness/2+volume*(mass/2+liquid));
}
/** Quantize against the coarser endpoint to avoid transferring parcels smaller
 * than its storage precision. Crossing a Float32 exponent still rounds the
 * endpoint stocks; this does not claim exact arithmetic mass conservation. */
export function representableTransfer(donor:number,receiver:number,requested:number){
 if(!(requested>0))return 0;
 const exponent=Math.floor(Math.log2(Math.max(donor,receiver+requested)));
 const spacing=Math.max(2**-149,2**(exponent-23));
 return Math.min(donor,Math.floor(requested/spacing)*spacing);
}
/** Keep a complete one-to-one event in the source until both Float32 stocks
 * can represent the same parcel. Smaller candidates handle exponent crossings
 * where a full requested increment would discard pre-existing low bits. */
export function exactStockTransfer(donor:number,receiver:number,requested:number){
 const receiverCredit=roundedSurfaceStock(receiver,requested,true)-receiver;
 if(receiverCredit>0&&receiverCredit<=donor&&donor-Math.fround(donor-receiverCredit)===receiverCredit)return receiverCredit;
 const donorDebit=donor-roundedSurfaceStock(donor,requested,false);
 if(donorDebit>0&&Math.fround(receiver+donorDebit)-receiver===donorDebit)return donorDebit;
 let limit=requested;
 for(let n=0;n<24&&limit>0;n++){
  const amount=representableTransfer(donor,receiver,limit);if(amount<=0)return 0;
  const debit=donor-Math.fround(donor-amount),credit=Math.fround(receiver+amount)-receiver;
  if(debit===credit&&debit>0&&debit<=requested)return debit;
  limit=amount/2;
 }
 return 0;
}
