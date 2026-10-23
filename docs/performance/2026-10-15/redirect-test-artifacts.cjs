const fs=require('node:fs');const path=require('node:path');const {syncBuiltinESMExports}=require('node:module');
const root='/Users/garden/Workspace/Projects/sandsphere/artifacts/climate-reference';
const target='/tmp/sandsphere-performance-reference-20261015';fs.mkdirSync(target,{recursive:true});
const redirect=value=>{if(typeof value!=='string')return value;const resolved=path.resolve(value);return resolved===root||resolved.startsWith(root+'/')?target+resolved.slice(root.length):value;};
const originalWrite=fs.writeFileSync,originalMkdir=fs.mkdirSync;
fs.writeFileSync=function(file,...args){return originalWrite.call(this,redirect(file),...args);};
fs.mkdirSync=function(file,...args){return originalMkdir.call(this,redirect(file),...args);};syncBuiltinESMExports();
