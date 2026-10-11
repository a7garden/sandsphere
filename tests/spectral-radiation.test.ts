import {it,expect} from 'vitest';
import reference from './fixtures/ecckd-optics-reference.json';
import {spectralGasOptics,spectralSource,spectralWeights} from '../src/sim/spectralRadiation';
it('matches 64 independent Julia ecCKD optics and spectral source evaluations',()=>{
 let maxRelative=0;
 for(const r of reference.rows){
  const f=spectralGasOptics({pressure:r.pressure,temperature:r.temperature,dryMoles:r.dryMoles,waterMoles:r.waterMoles,carbonDioxideMoles:r.co2*r.dryMoles,methaneMoles:r.ch4*r.dryMoles,ozone:r.o3});
  for(const key of ['longwave','shortwave'] as const)for(let g=0;g<32;g++){const error=Math.abs(f[key][g]-r[key][g])/Math.max(1e-9,Math.abs(r[key][g]));maxRelative=Math.max(maxRelative,error);expect(error).toBeLessThan(2e-5);}
  const source=spectralSource(r.temperature);for(let g=0;g<32;g++)expect(Math.abs(source[g]-r.source[g])/Math.max(1e-9,r.source[g])).toBeLessThan(2e-6);
 }
 expect(spectralWeights.longwave.reduce((a,b)=>a+b,0)).toBeCloseTo(1,6);
 expect(spectralWeights.shortwave.reduce((a,b)=>a+b,0)).toBeCloseTo(1,6);
 console.log('ecCKD maximum relative optics discrepancy',maxRelative);
});

import transferReference from './fixtures/ecckd-transfer-reference.json';
import {linearSource} from '../src/sim/climatePhysics';
it('matches independent NumericalRadiation forward emission for warm/cold gradients',()=>{
 for(const row of transferReference.transfer){
  expect(Math.exp(-1.66*row.depth)).toBeCloseTo(row.transmission,12);
  expect(linearSource(1.66*row.depth,row.topSource,row.bottomSource)).toBeCloseTo(row.upwardSource,9);
  expect(linearSource(1.66*row.depth,row.bottomSource,row.topSource)).toBeCloseTo(row.downwardSource,9);
 }
});
