/** Molecular masses in kg/mol; species colours are identification aids, not real gas colours. */
export const GASES = [
  {id:'vapor',field:9,name:'수증기',formula:'H₂O',molarMass:.018015,color:[.56,.78,.90]},
  {id:'nitrogen',field:13,name:'질소',formula:'N₂',molarMass:.028014,color:[.42,.70,.85]},
  {id:'methane',field:14,name:'메탄',formula:'CH₄',molarMass:.016043,color:[.70,.58,.89]},
  {id:'carbonDioxide',field:15,name:'이산화탄소',formula:'CO₂',molarMass:.04401,color:[.82,.66,.50]},
  {id:'oxygen',field:27,name:'산소',formula:'O₂',molarMass:.032,color:[.48,.78,.74]},
  {id:'carbonMonoxide',field:35,name:'일산화탄소',formula:'CO',molarMass:.02801,color:[.62,.58,.53]},
] as const;
export const ALL_GASES=[...GASES,
  {id:'hydrogen',field:28,name:'수소',formula:'H₂',molarMass:.002016,color:[.86,.83,.75]},
  {id:'helium',field:29,name:'헬륨',formula:'He',molarMass:.004003,color:[.94,.88,.68]},
  {id:'ammonia',field:30,name:'암모니아',formula:'NH₃',molarMass:.017031,color:[.86,.88,.79]},
] as const;
export const GAS_CONSTANT=8.314462618;
export const EARTH_GRAVITY=9.81;
export const ESCAPE_MODEL_RADIUS=1e6;
export const ESCAPE_GAME_RATE=.15;
export type EscapeRegime='weak-binding'|'transition'|'jeans-shaped';
/** Surface binding diagnostic on the declared 1000 km game reference radius.
 * This is neither an exobase temperature nor a real planet mass estimate. */
export function bindingParameter(temperature:number,gravity:number,molarMass:number,radiusMeters=ESCAPE_MODEL_RADIUS){
 const kelvin=temperature+273.15;
 if(!Number.isFinite(kelvin)||kelvin<=0)throw new RangeError('Gas binding requires a finite positive Kelvin temperature.');
 return Math.max(0,gravity)*EARTH_GRAVITY*radiusMeters*molarMass/(GAS_CONSTANT*kelvin);
}
export function escapeRegime(lambda:number):EscapeRegime{
 return lambda<3?'weak-binding':lambda<6?'transition':'jeans-shaped';
}
/** Jeans' binding parameter shapes an accelerated game loss rate.
 * Even in the weak-binding region this stays a bounded loss proxy, not a
 * hydrodynamic outflow solution. No exobase density, EUV or selective cooling. */
export function thermalEscapeFraction(temperature:number,gravity:number,molarMass:number,dt:number,radiusMeters=ESCAPE_MODEL_RADIUS) {
 const lambda=bindingParameter(temperature,gravity,molarMass,radiusMeters);
 const rate=ESCAPE_GAME_RATE*(1+lambda)*Math.exp(-lambda);
 return -Math.expm1(-Math.max(0,dt)*rate);
}
