import source from './physics.wgsl?raw';
import {BASE_CAPACITY,SPECIFIC_HEAT} from './thermodynamics';

const members=['a','b','c','d','cloud','life','mars','giant','ammonia','smoke'];
const float=(value:number)=>Number.isInteger(value)?`${value}.0`:String(value);

/** Generate backend material algebra from the same table as every CPU domain.
 * Keep vector expressions so the surface transport kernel remains compact. */
export function physicsShader(){
 const terms=(difference:boolean)=>members.map((member,index)=>{
  const cp=SPECIFIC_HEAT.slice(index*4,index*4+4).map(float).join(',');
  return `dot(${difference?`s.${member}-o.${member}`:`s.${member}`},vec4f(${cp}))`;
 }).join('+');
 const cp=(field:number)=>float(SPECIFIC_HEAT[field]);
 return source.replace('// SHARED_MATERIAL_ALGEBRA',
  `const cpSurface=vec4f(${[4,0,1,7].map(cp).join(',')});\n`+
  `const cpCloud=vec2f(${[16,17].map(cp).join(',')});\n`+
  `const cpGas=vec3f(${[13,14,15].map(cp).join(',')});\n`+
  `const cpCharcoal=${cp(34)}; const cpSoot=${cp(36)}; const cpCO=${cp(35)}; const cpOxygen=${cp(27)}; const cpVapor=${cp(9)}; const cpPlant=${cp(19)}; const cpMolten=${cp(11)};\n`+
  `fn capacity(s:Cell)->f32 {return ${float(BASE_CAPACITY)}+${terms(false)};}\n`+
  `fn capacityChange(s:Cell,o:Cell)->f32 {return ${terms(true)};}`);
}
