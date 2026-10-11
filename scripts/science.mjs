import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundled=resolve(root,'artifacts/science/runtime/julia-1.11.9/bin/julia');
const julia=process.env.SANDSPHERE_JULIA || (existsSync(bundled)?bundled:'julia');
const task=process.argv[2];
const tasks={setup:['-e','using Pkg; Pkg.instantiate()'],test:['science/test.jl'],smoke:['science/smoke.jl'],
  'held-suarez':['science/held_suarez.jl','42'],rcemip:['science/rcemip.jl'],
  earth:['science/earth_climate.jl','--spectral']};
if(!tasks[task])throw Error(`Unknown science task ${task}`);
const files=readdirSync(resolve(root,'science')).filter(x=>/\.(jl|toml)$/.test(x));
const hashes=Object.fromEntries(files.map(name=>[name,createHash('sha256').update(readFileSync(resolve(root,'science',name))).digest('hex')]));
const out=resolve(root,'artifacts/science');mkdirSync(out,{recursive:true});
writeFileSync(resolve(out,`${task}-run-manifest.json`),JSON.stringify({startedUTC:new Date().toISOString(),julia,arguments:['--project=science',...tasks[task],...process.argv.slice(3)],sha256:hashes},null,2)+'\n');
const result=spawnSync(julia,['--project=science',...tasks[task],...process.argv.slice(3)],{cwd:root,stdio:'inherit'});
if(result.error)throw Error('Install Julia 1.11 or set SANDSPHERE_JULIA to its executable. See science/README.md.',{cause:result.error});
process.exit(result.status ?? 1);
