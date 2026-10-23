import {it,expect} from 'vitest';
import {soakWorld,soakStep,soakMeasure} from './helpers/climateSoak';

it('couples climate and ecology across a complete rotating year with finite conserved stocks',()=>{
 const w=soakWorld(1);
 for(let k=0;k<7200;k++)soakStep(w);
 const result=soakMeasure(w);
 expect(result.finite).toBe(true);expect(result.minMass).toBeGreaterThanOrEqual(0);
 expect(result.maxWind).toBeGreaterThan(0);expect(result.maxCurrent).toBeGreaterThan(0);
 expect(result.condensation).toBeGreaterThan(0);expect(result.stocks.plant).toBeGreaterThan(0);
 expect(result.massRelative).toBeLessThan(1e-4);
// The complete 7,200-step year can exceed three minutes on a shared CI runner.
},360000);
