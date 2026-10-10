import type {AtmosphereState} from './atmosphere';
import type {Environment} from './model';

/** Qualitative visible-light optics, not an RGB label for each molecule.
 * Methane suppresses red light; sunlit methane-rich columns can develop warm photochemical haze.
 * Haze is an optical proxy here, not a separately conserved chemical product.
 */
export function atmosphereOptics(info:AtmosphereState,e:Environment) {
  const fraction=(id:string)=>info.species.find(s=>s.id===id)?.fraction??0;
  const methane=fraction('methane'),vapor=fraction('vapor'),co2=fraction('carbonDioxide');
  const haze=Math.min(.82,methane*(1-Math.exp(-info.pressure*.65))*e.sunlight/(e.sunlight+.6));
  const clear=[.30-.16*methane+.12*co2+.16*vapor,.57+.10*methane+.07*vapor,.94-.06*co2];
  const warm=[.87,.59,.31],mix=Math.min(.9,haze*1.4);
  const color=clear.map((c,i)=>c*(1-mix)+warm[i]*mix);
  return {color,haze,opacity:Math.min(.72,(1-Math.exp(-info.pressure*.20))*(1+haze))};
}
