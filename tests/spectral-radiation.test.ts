import {it,expect} from 'vitest';
import reference from './fixtures/ecckd-optics-reference.json';
import {spectralGasOptics,spectralGasOpticsInto,spectralSource,spectralSourceInto,spectralWeights} from '../src/sim/spectralRadiation';
it('matches 64 independent Julia ecCKD optics evaluations and the source reference at or above 120 K',()=>{
 let maxRelative=0;
 for(const r of reference.rows){
  const f=spectralGasOptics({pressure:r.pressure,temperature:r.temperature,dryMoles:r.dryMoles,waterMoles:r.waterMoles,carbonDioxideMoles:r.co2*r.dryMoles,methaneMoles:r.ch4*r.dryMoles,ozone:r.o3});
  for(const key of ['longwave','shortwave'] as const)for(let g=0;g<32;g++){const error=Math.abs(f[key][g]-r[key][g])/Math.max(1e-9,Math.abs(r[key][g]));maxRelative=Math.max(maxRelative,error);expect(error).toBeLessThan(2e-5);}
  if(r.temperature>=120){const source=spectralSource(r.temperature);for(let g=0;g<32;g++)expect(Math.abs(source[g]-r.source[g])/Math.max(1e-9,r.source[g])).toBeLessThan(2e-6);}
 }
 expect(spectralWeights.longwave.reduce((a,b)=>a+b,0)).toBeCloseTo(1,6);
 expect(spectralWeights.shortwave.reduce((a,b)=>a+b,0)).toBeCloseTo(1,6);
 console.log('ecCKD maximum relative optics discrepancy',maxRelative);
});

it('keeps the lowest table spectral shape with finite T4 emission below 120 K',()=>{
 const reference=spectralSource(120),mean=(source:Float64Array)=>source.reduce((sum,v,g)=>sum+v*spectralWeights.longwave[g],0);
 for(const temperature of [0,.01,1,30,60,119.999999]){
  const source=spectralSource(temperature),ratio=(temperature/120)**4;
  expect(source.every(v=>Number.isFinite(v)&&v>=0)).toBe(true);
  for(let g=0;g<32;g++)expect(source[g]).toBeCloseTo(reference[g]*ratio,12);
  expect(mean(source)).toBeCloseTo(mean(reference)*ratio,12);
  if(temperature>0)expect(Math.abs(mean(source)/(5.670374419e-8*temperature**4)-1)).toBeLessThan(1e-5);
 }
 expect(spectralSource(0).every(v=>v===0)).toBe(true);
 const below=spectralSource(120-1e-7);for(let g=0;g<32;g++)expect(below[g]/reference[g]).toBeCloseTo(1,7);
});

it('fills reused destination buffers exactly and preserves independent public results',()=>{
 const buffers={longwave:new Float64Array(32),shortwave:new Float64Array(32),rayleigh:new Float64Array(32)},amounts=new Float64Array(8),source=new Float64Array(32);
 for(const row of reference.rows){
  const layer={pressure:row.pressure,temperature:row.temperature,dryMoles:row.dryMoles,waterMoles:row.waterMoles,carbonDioxideMoles:row.co2*row.dryMoles,methaneMoles:row.ch4*row.dryMoles,ozone:row.o3};
  const independent=spectralGasOptics(layer),saved=structuredClone(independent);
  expect(spectralGasOpticsInto(layer,buffers,amounts)).toBe(buffers);expect(buffers).toEqual(independent);
  spectralGasOpticsInto({...layer,waterMoles:0,carbonDioxideMoles:0},buffers,amounts);expect(independent).toEqual(saved);
 }
 for(const temperature of [0,.01,30,119.999999,120,273.15,500,3000]){const independent=spectralSource(temperature),saved=independent.slice();expect(spectralSourceInto(temperature,source)).toBe(source);expect(source).toEqual(independent);spectralSourceInto(temperature+1,source);expect(independent).toEqual(saved);}
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
