import {F,STRIDE} from '../sim/model';
import {MATERIAL_COLORS} from './columnGeometry';

export const SECTION_POWDERS=['sand','clay','ceramic','glass','ice','salt','soil','iron','molten'] as const;
/** Representative grains of the existing homogeneous solid reservoir.
 * Fractions are actual cell mass fractions, not invented sediment history. */
export function powderFractions(state:Float32Array,sample:number){
 const masses=SECTION_POWDERS.map(name=>Math.max(0,state[sample*STRIDE+F[name]])),total=masses.reduce((a,b)=>a+b,0);
 return [...masses.map(m=>total?m/total:0),0,0,0];
}
export const POWDER_COLOR_GLSL=`vec3 powderColor(float r){float cumulative=0.0;${SECTION_POWDERS.map((name,i)=>`cumulative+=mix${Math.floor(i/4)}.${'xyzw'[i%4]};if(r<cumulative)return vec3(${MATERIAL_COLORS[name].map(v=>v.toFixed(3)).join(',')});`).join('')}return tint.rgb;}`;
