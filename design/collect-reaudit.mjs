/** Collect audit provenance without changing product state or historical evidence. */
import {readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {root,sourceManifest} from './source-manifest.mjs';
const additional=[];
for(const directory of ['src/sim','src/render','src/ui','tests']){
 for(const entry of await readdir(new URL('../'+directory+'/',import.meta.url)))
  if(/\.(ts|wgsl|html)$/.test(entry))additional.push(directory+'/'+entry);
}
const manifest=await sourceManifest(additional),historical=JSON.parse(await readFile(new URL('p3-implementation-evidence.json',import.meta.url),'utf8'));
const changedSinceP3=Object.keys(historical.sourceSha256).filter(file=>manifest.sourceSha256[file]!==historical.sourceSha256[file]);
await copyFile('/tmp/sandsphere-reaudit-tests-isolated.log',new URL('reaudit-tests.log',import.meta.url));
await copyFile('/tmp/sandsphere-reaudit-build.log',new URL('reaudit-build.log',import.meta.url));
const artifacts=['reaudit-science-evidence.json','reaudit-gpu-evidence.json','reaudit-legacy-gpu-evidence.json','reaudit-section-reset-evidence.json','reaudit-section-rain-snow-evidence.json','reaudit-section-camera-evidence.json','reaudit-section-grains-evidence.json','reaudit-section-live-evidence.json','reaudit-section-stale-rain.png','reaudit-section-live.png','reaudit-tests.log','reaudit-tests-contended.log','reaudit-build.log','reproduce-reaudit.mjs'];
const evidenceSha256={};for(const file of artifacts)evidenceSha256['design/'+file]=createHash('sha256').update(await readFile(new URL(file,import.meta.url))).digest('hex');
const readJSON=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
const science=await readJSON('reaudit-science-evidence.json'),gpu=await readJSON('reaudit-gpu-evidence.json'),legacy=await readJSON('reaudit-legacy-gpu-evidence.json'),camera=await readJSON('reaudit-section-camera-evidence.json');
const testLog=await readFile(new URL('reaudit-tests.log',import.meta.url),'utf8'),buildLog=await readFile(new URL('reaudit-build.log',import.meta.url),'utf8');
if(!/Tests\s+148 passed/.test(testLog)||!/built in/.test(buildLog))throw Error('Unexpected final verification output');
const report={...manifest,backend:'CPU + actual WebGPU + WebGPUEngine section fixture',root,sourceHashesCapturedAfterVerification:true,changedSinceHistoricalP3Manifest:changedSinceP3,hashInventoryIsNotAnAssertionOfWholeFileReview:true,productSourceEditedByThisAudit:false,userStorageModified:false,scope:'Manual P1–P3 simulation/section/state/save/progression audit; no Git diff available; concurrent UI work preserved.',overallPassed:false,findings:[{id:'R01',priority:1,kind:'negative phase mass breaks save contract'},{id:'R02',priority:1,kind:'salted solid endpoint skips mixed equilibrium; backend divergence'},{id:'R03',priority:2,kind:'section precipitation cache survives planet refresh'},{id:'R04',priority:2,kind:'original A11 destination predicate remains unresolved'},{id:'R05',priority:3,kind:'section precipitation color loses rain/snow phase'}],tests:{command:'npm test',mode:'isolated, default timeout',files:24,passed:148,failed:0,contendedPriorRun:{failed:1,reason:'P3 thermal spatial test exceeded default 5000ms while CPU probe/build ran concurrently',retryChangedTimeout:false}},build:{command:'npm run build',passed:true,warning:'bundle over 500kB'},legacyGpu:{supported:legacy.supported,passed:legacy.passed,cases:legacy.cases.length,maxTemperatureDifference:Math.max(...legacy.cases.map(c=>c.maxTemperatureError))},newGpu:{supported:gpu.supported,cases:gpu.results.length,overallPassed:false,coldMaxTemperatureDifference:gpu.results.find(c=>c.kind==='mixed cold').maxTemperatureDifference},cpuProbe:{conditions:science.reaction.count,negativeBeyondStorageTolerance:science.reaction.negativeCases,firstInvalidCapturedStep:science.coldStepSave.firstInvalidStep},camera:{changedSlots:camera.changedSlots,sameCanvas:camera.sameCanvas,sameScene:camera.sameScene,sameCamera:camera.sameCamera},evidenceSha256};
await writeFile(new URL('reaudit-verification-summary.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({findings:report.findings,tests:report.tests,build:report.build,changedSinceP3,summary:'design/reaudit-verification-summary.json'},null,2));
