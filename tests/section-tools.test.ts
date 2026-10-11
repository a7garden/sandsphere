import {it,expect} from 'vitest';
import {F,STRIDE,COMMAND_STRIDE,SURFACE_ERASE,SURFACE_ERASE_FIELDS,applyCommand,totalMass,totalEnthalpy} from '../src/sim/model';
it('section erasure removes only editable surface matter and its heat, preserving hidden foundation and atmosphere',()=>{
 const s=new Float32Array(STRIDE);s.fill(2);s[F.temperature]=20;s[F.firing]=0;
 const before=s.slice(),commands=new Float32Array(COMMAND_STRIDE);commands[5]=.5;commands[SURFACE_ERASE]=1;
 applyCommand(s,0,commands);
 for(const f of SURFACE_ERASE_FIELDS)expect(s[f]).toBe(before[f]*.5);
 for(const f of [F.rock,F.vapor,F.nitrogen,F.methane,F.carbonDioxide,F.cloud,F.cloudIce])expect(s[f]).toBe(before[f]);
 expect(s[F.temperature]).toBe(20);expect(totalMass(s)).toBeLessThan(totalMass(before));expect(totalEnthalpy(s)).toBeLessThan(totalEnthalpy(before));
 const legacy=before.slice();commands[SURFACE_ERASE]=0;applyCommand(legacy,0,commands);expect(legacy[F.rock]).toBe(1);expect(legacy[F.cloud]).toBe(1);
});
