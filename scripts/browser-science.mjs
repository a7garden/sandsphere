import {chromium} from '../artifacts/science/runtime/browser/node_modules/playwright-core/index.mjs';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const files=['src/sim/climatePhysics.ts','src/sim/layeredAtmosphere.ts','src/sim/cloudMicrophysics.ts','src/sim/spectralRadiation.ts','src/sim/data/ecckd-32.json','tests/helpers/rceExperiment.ts'];
const hashes=()=>Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(f)).digest('hex')]));
const started=new Date().toISOString(),sha256=hashes();
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();page.on('console',m=>console.log(m.text()));page.on('pageerror',e=>console.error(e));
 const response=await page.request.get('http://127.0.0.1:5189/src/sim/layeredAtmosphere.ts'),served=await response.text();
 if(!response.ok()||!served.includes('warmAutoFraction')||!served.includes('iceAggregation'))throw Error('Stale or invalid served production module; restart science-server before running');
 const servedModuleSha256=createHash('sha256').update(served).digest('hex');
 await page.goto('http://127.0.0.1:5189/tests/climate-science-lab.html');
 await page.waitForFunction(()=>Boolean(window.climateScience));
 const results=await page.evaluate(()=>window.climateScience.run());
 mkdirSync('artifacts/science/browser',{recursive:true});
 const provenance={startedUTC:started,engine:await browser.version(),runtime:'actual Chromium Web Worker',servedModuleSha256,sha256,sourceUnchangedDuringRun:JSON.stringify(sha256)===JSON.stringify(hashes())};
 for(const result of results)writeFileSync(`artifacts/science/browser/rce-${result.configuration.sstK}K.json`,JSON.stringify({...result,browser:provenance},null,2));
 console.log(JSON.stringify(results.map(r=>({sst:r.configuration.sstK,stationarity:r.stationarity,seconds:r.elapsedSeconds}))));
}finally{await browser.close();}
