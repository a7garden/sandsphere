import {readFileSync} from 'node:fs';

const pkg=JSON.parse(readFileSync('package.json','utf8'));
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
const notes=readFileSync('CHANGELOG.md','utf8');
const version=pkg.version;

if(!/^\d+\.\d+\.\d+(?:-(?:alpha|beta)\.[1-9]\d*)?$/.test(version))
  throw new Error(`Unsupported application version: ${version}`);
if(lock.version!==version||lock.packages?.['']?.version!==version)
  throw new Error('package.json and package-lock.json versions differ.');
const unreleased=notes.match(/^## \[Unreleased\][^\n]*/m)?.[0];
if(!unreleased)
  throw new Error('CHANGELOG.md needs an Unreleased section.');
if(version.includes('-')&&!unreleased.includes(version))
  throw new Error(`The Unreleased heading must name the current development version ${version}.`);

const tag=process.env.RELEASE_TAG;
if(tag){
  if(version.includes('-'))throw new Error('A prerelease version cannot be deployed as a stable release.');
  if(tag!==`v${version}`)throw new Error(`Release tag ${tag} does not match package version ${version}.`);
  if(!notes.includes(`## [${version}]`))throw new Error(`CHANGELOG.md needs notes for ${version}.`);
}

console.log(`Version and release notes checked: ${version}${tag?` (${tag})`:''}`);
