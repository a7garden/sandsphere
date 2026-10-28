import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';import {tmpdir} from 'node:os';import {join} from 'node:path';import {writeFileSync,readFileSync} from 'node:fs';
const root=process.env.ROOT??fileURLToPath(new URL('../../..',import.meta.url)),mode=process.argv[2]??'check',file=process.argv[3]??'golden.json',only=process.env.ONLY;
const {createServer}=await import(root+'/node_modules/vite/dist/node/index.js');
const server=await createServer({configFile:false,envDir:false,root,logLevel:'error',cacheDir:join(tmpdir(),'ss-digest-cache-'+createHash('md5').update(root).digest('hex').slice(0,6)),server:{middlewareMode:true,ws:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
const h=v=>{const x=createHash('sha256');const add=a=>{if(ArrayBuffer.isView(a))x.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));else if(Array.isArray(a))a.forEach(add);else if(a&&typeof a==='object')for(const k of Object.keys(a).sort()){x.update(k);add(a[k]);}else x.update(String(a));};add(v);return x.digest('hex').slice(0,16);};
const out={};
try{
 const model=await server.ssrLoadModule('/src/sim/model.ts'),sphere=await server.ssrLoadModule('/src/sim/sphere.ts'),pc=await server.ssrLoadModule('/src/sim/planetCreation.ts');
 const preset=p=>g=>({state:model.seedWorld(g,p),environment:{...model.environmentFor(p),climate:true}});
 const cases=[];
 for(const p of ['coast','winter','kiln'])for(const level of [2,4])cases.push({name:p+level,level,create:preset(p)});
 for(const level of [2,4])cases.push({name:'sandbox'+level,level,create:g=>pc.createSandboxPlanet(g,'rock',1,1,'nitrogen',1)});
 for(const level of [2,4])cases.push({name:'mars'+level,level,create:g=>pc.createMarsPlanet(g)});
 cases.push({name:'jupiter2',level:2,create:g=>pc.createJupiterPlanet(g)});
 cases.push({name:'coast-simple',level:3,create:g=>({state:model.seedWorld(g,'coast'),environment:{...model.environmentFor('coast'),climate:false}})});
 for(const c of cases){
  if(only&&!c.name.startsWith(only))continue;
  const grid=sphere.createSphere(c.level),made=c.create(grid),solver=new model.CpuSolver(grid,made.state),dt=1/30,env=made.environment;
  if(made.climate)solver.climate.restore(made.climate);
  const steps=c.level===4?8:30,rows=[];
  for(let n=0;n<steps;n++){
   const cm=new Float32Array(grid.count*model.COMMAND_STRIDE);
   if(n%3===0&&c.name.startsWith('jupiter'))for(const cell of [0,5,17])cm[cell*model.COMMAND_STRIDE+4]=1;else if(n%3===0)for(const cell of [0,5,17]){const b=cell*model.COMMAND_STRIDE;cm[b]=30;cm[b+1]=4;cm[b+3]=2;cm[b+8]=10;cm[b+6]=.15;cm[b+12]=5;cm[b+4]=1;}
   solver.advance(dt,cm,env);
   rows.push(h([solver.state,solver.energyChanges,solver.escapeCells,solver.precipitatedCells]));
  }
  rows.push(h(solver.climate.snapshot()));
  out[c.name]=rows;solver.dispose?.();process.stdout.write(c.name+' ');
 }
 console.log();
 if(mode==='record'){writeFileSync(file,JSON.stringify(out,null,1));console.log('recorded');}
 else{const g=JSON.parse(readFileSync(file));let bad=0;for(const k of Object.keys(out)){const i=g[k].findIndex((v,j)=>v!==out[k][j]);if(i>=0){bad++;console.log('MISMATCH',k,'first at',i);}}console.log(bad?'FAIL':'ALL EXACT');process.exitCode=bad?1:0;}
}finally{await server.close();}
