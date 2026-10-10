/** Molecular masses in kg/mol; species colours are identification aids, not real gas colours. */
export const GASES = [
  {id:'vapor',field:9,name:'수증기',formula:'H₂O',molarMass:.018015,color:[.56,.78,.90]},
  {id:'nitrogen',field:13,name:'질소',formula:'N₂',molarMass:.028014,color:[.42,.70,.85]},
  {id:'methane',field:14,name:'메탄',formula:'CH₄',molarMass:.016043,color:[.70,.58,.89]},
  {id:'carbonDioxide',field:15,name:'이산화탄소',formula:'CO₂',molarMass:.04401,color:[.82,.66,.50]},
] as const;
export const GAS_CONSTANT=8.314462618;
export const EARTH_GRAVITY=9.81;
export const ESCAPE_MODEL_RADIUS=1e6;
export const ESCAPE_GAME_RATE=.15;
export type EscapeRegime='weak-binding'|'transition'|'jeans-shaped';
/** Surface binding diagnostic on the declared 1000 km game reference radius.
 * This is neither an exobase temperature nor a real planet mass estimate. */
export function bindingParameter(temperature:number,gravity:number,molarMass:number){
 return Math.max(0,gravity)*EARTH_GRAVITY*ESCAPE_MODEL_RADIUS*molarMass/(GAS_CONSTANT*Math.max(1,temperature+273.15));
}
export function escapeRegime(lambda:number):EscapeRegime{
 return lambda<3?'weak-binding':lambda<6?'transition':'jeans-shaped';
}
/** Jeans' binding parameter shapes an accelerated game loss rate.
 * Even in the weak-binding region this stays a bounded loss proxy, not a
 * hydrodynamic outflow solution. No exobase density, EUV or selective cooling. */
export function thermalEscapeFraction(temperature:number,gravity:number,molarMass:number,dt:number) {
 const lambda=bindingParameter(temperature,gravity,molarMass);
 const rate=ESCAPE_GAME_RATE*(1+lambda)*Math.exp(-lambda);
 return -Math.expm1(-Math.max(0,dt)*rate);
}
