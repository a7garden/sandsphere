import {F,STRIDE,MASS_FIELDS,type CpuSolver} from '../../src/sim/model';
import {AIR_FIELDS,AIR_SPECIES,ATMOSPHERE_MIRRORS} from '../../src/sim/layeredAtmosphere';
/** Count the authoritative Float64 layers, never their rounded surface mirrors. */
export function airInventory(s:CpuSolver){
 const stock=new Float64Array(STRIDE);
 for(let p=0;p<s.state.length;p+=STRIDE)for(const f of MASS_FIELDS)if(!(ATMOSPHERE_MIRRORS as readonly number[]).includes(f))stock[f]+=s.state[p+f];
 const a=s.climate.air;for(let q=0;q<a.temperature.length;q++){for(let f=0;f<AIR_SPECIES;f++)stock[AIR_FIELDS[f]]+=a.mass[q*AIR_SPECIES+f];stock[F.airborneDust]+=a.dustMass[q];}
 return stock;
}
