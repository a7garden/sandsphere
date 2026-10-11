import {it,expect} from 'vitest';
import {F,STRIDE} from '../src/sim/model';
import {powderFractions,SECTION_POWDERS} from '../src/render/sectionPowder';
it('uses real solid mass fractions without inventing vertical strata or including bedrock or free water',()=>{
 const s=new Float32Array(STRIDE*2);s[STRIDE+F.rock]=100;s[STRIDE+F.water]=30;s[STRIDE+F.sand]=3;s[STRIDE+F.clay]=1;
 const before=s.slice(),fractions=powderFractions(s,1);
 expect(fractions.length).toBe(12);expect(fractions[SECTION_POWDERS.indexOf('sand')]).toBe(.75);expect(fractions[SECTION_POWDERS.indexOf('clay')]).toBe(.25);
 expect(fractions.reduce((a,b)=>a+b)).toBe(1);expect(powderFractions(s,0).every(v=>v===0)).toBe(true);expect(s).toEqual(before);
});
