import {describe,it} from 'vitest';
import process from 'node:process';
import {auditSoak} from './helpers/climateSoakAudit';
describe.skipIf(process.env.SANDSPHERE_LONG_AUDIT!=='1')('climate resolution audit',()=>{
 for(const [level,seconds] of [[2,2400],[4,240]])it(`coast: ${seconds} game seconds at subdivision ${level}`,()=>auditSoak('coast',level,seconds),600000);
});
