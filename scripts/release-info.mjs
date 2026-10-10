import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const tag=process.env.RELEASE_TAG;
if(!tag||!/^v\d+\.\d+\.\d+$/.test(tag))throw new Error('A stable Gitea release tag is required.');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const tagged=execFileSync('git',['rev-parse',`${tag}^{commit}`],{encoding:'utf8'}).trim();
if(commit!==tagged)throw new Error('The checked-out commit must match the published release tag.');
await writeFile('dist/release.json',JSON.stringify({tag,commit,builtAt:new Date().toISOString()},null,2)+'\n');
