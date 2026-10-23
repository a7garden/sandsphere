import type {AtmosphereState} from './atmosphere';
import type {Environment} from './model';

/** Qualitative visible-light optics, not an RGB label for each molecule.
 * Methane suppresses red light; sunlit methane-rich columns can develop warm photochemical haze.
 * Haze is an optical proxy here, not a separately conserved chemical product.
 */
export function atmosphereOptics(info:AtmosphereState,e:Environment) {
  const fraction=(id:string)=>info.species.find(s=>s.id===id)?.fraction??0;
  if(e.body?.lowerBoundary.kind==='deep-atmosphere'){const helium=fraction('helium');return {color:[.88,.80+.3*helium,.65+.4*helium],haze:0,opacity:.12};}
  const methane=fraction('methane'),vapor=fraction('vapor'),co2=fraction('carbonDioxide');
  const methaneHaze=methane*(1-Math.exp(-info.pressure*.65))*e.sunlight/(e.sunlight+.6),dustHaze=-Math.expm1(-info.dustOpticalDepth);
  const haze=Math.min(.82,1-(1-methaneHaze)*(1-dustHaze));
  const clear=[.30-.16*methane+.12*co2+.16*vapor,.57+.10*methane+.07*vapor,.94-.06*co2];
  const warm=[.87,.59,.31],mix=Math.min(.9,haze*1.4);
  const color=clear.map((c,i)=>c*(1-mix)+warm[i]*mix);
  const clearOpacity=Math.min(.72,(1-Math.exp(-info.pressure*.20))*(1+Math.min(.82,methaneHaze)));
  return {color,haze,opacity:Math.min(.72,1-(1-clearOpacity)*(1-dustHaze))};
}
