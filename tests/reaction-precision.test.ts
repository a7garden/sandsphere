import {describe,it,expect} from 'vitest';
import {reactInventory,stoichiometricReaction} from '../src/sim/materialReaction';
import {F,STRIDE} from '../src/sim/model';
import {elementalMass} from '../src/sim/chemistry';

const settling=stoichiometricReaction([[F.soot,1]],[[F.charcoal,1]],{exactTransfer:true});
describe('represented one-to-one reaction events',()=>{
 it('does not make carbon when repeatedly settling a fine stock into a coarse stock',()=>{
  const s=new Float32Array(STRIDE);s[F.soot]=.0001;s[F.charcoal]=.1;const before=elementalMass(s),mass=s[F.soot]+s[F.charcoal];
  for(let n=0;n<10000;n++)reactInventory(s,0,settling,s[F.soot]*.001);
  expect(s[F.soot]).toBeLessThan(.00005);expect(s[F.soot]+s[F.charcoal]).toBe(mass);expect(elementalMass(s)).toEqual(before);
 });
 it('retains sub-resolution source material and transfers it after enough source accumulates',()=>{
  const s=new Float32Array(STRIDE);s[F.charcoal]=100;s[F.soot]=1e-8;const original=s.slice();
  expect(reactInventory(s,0,settling,s[F.soot])).toBe(0);expect(s).toEqual(original);
  s[F.soot]=.001;const mass=s[F.soot]+s[F.charcoal];expect(reactInventory(s,0,settling,s[F.soot]*.1)).toBeGreaterThan(0);expect(s[F.soot]+s[F.charcoal]).toBe(mass);
 });
 it('leaves Float64 stoichiometric event resolution unchanged',()=>{
  const s=new Float64Array(STRIDE);s[F.soot]=1e-20;s[F.charcoal]=100;expect(reactInventory(s,0,settling,1e-20)).toBe(1e-20);expect(s[F.soot]).toBe(0);
 });
});
