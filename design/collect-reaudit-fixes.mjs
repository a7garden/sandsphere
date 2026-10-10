import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),design=path.join(root,'design');
const read=async name=>JSON.parse(await fs.readFile(path.join(design,name),'utf8'));
const [gpu,boundaries,resume,section,productSwitch]=await Promise.all(['reaudit-fixes-gpu.json','reaudit-fixes-gpu-boundaries.json','reaudit-fixes-resume.json','reaudit-fixes-section.json','reaudit-fixes-product-switch.json'].map(read));
if(!gpu.supported||!gpu.passed||gpu.results.length!==6||!boundaries.supported||!boundaries.passed||boundaries.cases.length!==20||!resume.passed||!section.regression.passed||!productSwitch.passed||productSwitch.consoleErrors.product.length||productSwitch.consoleErrors.section.length)throw new Error('A browser regression failed or evidence is missing.');
const tests=await fs.readFile(path.join(design,'reaudit-fixes-tests.log'),'utf8'),build=await fs.readFile(path.join(design,'reaudit-fixes-build.log'),'utf8');
const files=tests.match(/Test Files\s+(\d+) passed \((\d+)\)/),cases=tests.match(/Tests\s+(\d+) passed \((\d+)\)/);
if(!files||files[1]!==files[2]||!cases||cases[1]!==cases[2]||Number(cases[1])<166||!build.includes('built in')||/error TS\d|error during build/i.test(build))throw new Error('Unit/build log does not satisfy the regression gate.');
async function walk(dir){const entries=await fs.readdir(path.join(root,dir),{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?walk(path.join(dir,e.name)):path.join(dir,e.name)))).flat();}
const sources=[...(await walk('src')), ...(await walk('tests'))].sort(),hashes={};
for(const file of sources)hashes[file]=createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
const summary={date:new Date().toISOString(),passed:true,unit:{files:Number(files[1]),tests:Number(cases[1])},build:{typescript:true,production:true,existingChunkWarning:build.includes('chunks are larger')},gpu:{boundaryCases:20,mixedCases:6,allStepsValid:gpu.results.every(r=>r.allStepsValid),saveResumeExact:gpu.results.every(r=>r.saveResumeExact),maximumTemperatureDifference:Math.max(...gpu.results.map(r=>r.maxTemperatureDifference)),mixedColdTemperatureDifference:gpu.results.find(r=>r.kind==='mixed cold').maxTemperatureDifference,tolerances:gpu.tolerances},resume,section:section.regression,productSwitch,sourceSha256:hashes};
await fs.writeFile(path.join(design,'reaudit-fixes-verification-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({passed:summary.passed,unit:summary.unit,gpu:summary.gpu,resume:resume.passed,section:summary.section.passed,hashedSources:sources.length},null,2));
