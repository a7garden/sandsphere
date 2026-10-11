import {it,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {runRceExperiment} from './helpers/rceExperiment';

/** Actual browser production kernel. These reduced columns use RCEMIP
 * boundary conditions; their scientific acceptance is reported separately
 * from finite-state/unit-test success. The same helper runs in Chromium. */
it.skipIf(process.env.CLIMATE_BENCHMARKS!=='1').each([295,300,305] as const)('audits 1000 days of RCE at %s K',sst=>{
 const result=runRceExperiment(sst,(day,drift)=>console.log('RCE progress',sst,'K',day,'days',`max ΔT/day ${drift.toFixed(5)} K`));
 expect(result.samples).toHaveLength(1000);
 expect(result.dryMassDrift.maximumRelative).toBeLessThan(1e-7);
 expect(result.samples.every(row=>row.temperature.every(Number.isFinite))).toBe(true);
 mkdirSync('artifacts/climate-reference',{recursive:true});writeFileSync(`artifacts/climate-reference/rce-1000day-${sst}K.json`,JSON.stringify(result,null,2));
 console.log('RCE experiment result',sst,'K',result.stationarity,'energy residual',result.energyResidual);
},3600000);
