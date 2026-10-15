// Calibrated game materials: kJ-like energy, game kg, Celsius referenced at 0°C.
// Ceramic firing has zero net reaction heat in this model. Glass retains the
// molten structural offset; this is not a claim of crystalline freezing latent heat.
import {CO2_ICE_CP,CO2_SUBLIMATION_HEAT} from './co2Ice';
// Material data must not depend on a solver or its inventory layout adapter.
export const AMMONIA_MELTING=194.95-273.15;
export const AMMONIA_ICE_OFFSET=333-(4.7-2.1)*AMMONIA_MELTING;
export const AMMONIA_VAPOR_OFFSET=31.2/.017031-333-(2.06-4.7)*AMMONIA_MELTING;
/** Positive-Kelvin numerical domain for the constant-capacity game model.
 * This is an admissibility test, never a temperature clamp or heat source.
 * Preset/opacity-table ranges must not reject an energy-conserving cold state. */
export const MIN_THERMODYNAMIC_TEMPERATURE=-273.14;
export const BASE_CAPACITY=28;
export const SPECIFIC_HEAT=[.8,1,.9,.8,4.18,2.1,.85,.85,0,2,0,.8,.84,1.04,2.22,.85,4.18,2.1,1,1,1,1,.45,1,CO2_ICE_CP,.8,.8,.918,14.3,5.193,2.06,4.7,2.1,0,.71,1.04,.71,0,0,0] as const;
export const PHASE_ENERGY=[0,0,0,150,0,-334,0,0,0,2475,0,150,0,0,0,0,0,-334,0,0,0,0,0,0,-CO2_SUBLIMATION_HEAT,0,0,0,0,0,AMMONIA_VAPOR_OFFSET,0,-AMMONIA_ICE_OFFSET,0,0,0,0,0,0,0] as const;
/** Calibrated bond energies (game kJ/kg), zero for oxidized CO₂/H₂O/O₂.
 * CH₂O -> ½ CH₄ + ½ CO₂ releases 233.333 kJ/kg; oxidation releases
 * 4500 kJ/kg organic or 16000 kJ/kg methane. Not laboratory reaction heats.
 * Loading a legacy stock changes the energy reference, never its temperature. */
export const CHEMICAL_ENERGY=SPECIFIC_HEAT.map((_,f)=>f===34||f===36?12000:f===35?4000:f===14?16000:[18,19,20,21,23].includes(f)?4500:0);
// Extension only: old species keep their potentials and old C/CO stocks are zero.
export const CHEMISTRY_VERSION=2;
export const MATERIAL_ENERGY=PHASE_ENERGY.map((phase,f)=>phase+CHEMICAL_ENERGY[f]);
export const SUPPLY_TEMPERATURE=SPECIFIC_HEAT.map((_,field)=>field===5?-5:20);
export const ENERGY_CHANNELS=4; // environment, commands, escape, numerical corrections

/** State-independent reservoir algebra. Energy is kJ, mass is model kg;
 * mechanical energy supplied by a domain must use the same energy unit. */
export function specificEnthalpy(field:number,temperature:number){return SPECIFIC_HEAT[field]*temperature+MATERIAL_ENERGY[field];}
export function phaseChangeEnergy(from:number,to:number,temperature:number){return specificEnthalpy(to,temperature)-specificEnthalpy(from,temperature);}
export function thermalEnergy(capacity:number,temperature:number,phase:number){return capacity*temperature+phase;}
export function temperatureFromEnergy(energy:number,capacity:number,phase:number,mechanical=0){return (energy-phase-mechanical)/capacity;}
export function mechanicalEnergy(mass:number,gravity:number,height:number,speedSquared:number){return mass*(gravity*height+.5*speedSquared)/1000;}

/** Exact heat exchange between finite reservoirs with fixed capacities.
 * Positive heat moves from a to b; neither can cross their shared equilibrium. */
export function conductiveExchange(a:number,b:number,ca:number,cb:number,conductance:number,seconds:number){
 if(ca<=0||cb<=0||conductance<=0||seconds<=0)return 0;
 const inverse=1/ca+1/cb;
 return (a-b)*(-Math.expm1(-conductance*inverse*seconds))/inverse;
}
