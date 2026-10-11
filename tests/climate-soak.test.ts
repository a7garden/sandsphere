import {describe,it} from 'vitest';
import process from 'node:process';
import type {SoakKind} from './helpers/climateSoak';
import {auditSoak} from './helpers/climateSoakAudit';

describe.skipIf(process.env.SANDSPHERE_LONG_AUDIT!=='1')('long climate audit',()=>{
 for(const [kind,level,seconds] of [['coast',1,7200],['tidal',1,7200],['cold',1,7200],['dry',1,2400],['symmetric',1,2400]] as [SoakKind,number,number][]){
  it(`${kind}: ${seconds} game seconds at subdivision ${level}`,()=>{
   auditSoak(kind,level,seconds);
  },600000);
 }
});
