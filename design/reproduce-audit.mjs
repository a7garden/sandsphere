import {createServer} from 'vite';
import {writeFile} from 'node:fs/promises';
import {root,sourceManifest} from './source-manifest.mjs';
const server=await createServer({root,server:{middlewareMode:true},appType:'custom'});
try {
const M=await server.ssrLoadModule('/src/sim/model.ts');const S=await server.ssrLoadModule('/src/sim/sphere.ts');const P=await server.ssrLoadModule('/src/sim/progress.ts');
const grid=S.createSphere(4),cmd=new Float32Array(grid.count*M.COMMAND_STRIDE);
const fresh=(t)=>{const s=new Float32Array(grid.count*M.STRIDE);for(let i=0;i<grid.count;i++)s[i*M.STRIDE+M.F.temperature]=t;return s;};
const H=s=>{let v=0;for(let i=0;i<grid.count;i++){const p=i*M.STRIDE;v+=M.capacity(s,i)*s[p+M.F.temperature]+2475*s[p+M.F.vapor]-334*(s[p+M.F.ice]+s[p+M.F.cloudIce])+150*s[p+M.F.molten];}return v;};
const output={};
let s=fresh(120);s[M.F.water]=10;let solver=new M.CpuSolver(grid,s);solver.advance(0,cmd,{ambient:120,sunlight:0,sun:[1,0,0],gravity:1});output.pause={dt:0,waterBefore:10,waterAfter:solver.state[M.F.water],vaporAfter:solver.state[M.F.vapor],temperature:solver.state[M.F.temperature]};
s=fresh(1000);s[M.F.clay]=10;s[M.F.firing]=30;let hb=H(s);M.react(s,0,.1,{ambient:1000,sunlight:0,sun:[1,0,0]},grid);output.firing={energyChange:H(s)-hb,clay:s[M.F.clay],ceramic:s[M.F.ceramic],temperature:s[M.F.temperature]};
s=fresh(1000);s[M.F.molten]=10;hb=H(s);M.react(s,0,1,{ambient:1000,sunlight:0,sun:[1,0,0]},grid);output.glassCooling={energyChange:H(s)-hb,molten:s[M.F.molten],glass:s[M.F.glass],temperature:s[M.F.temperature]};
s=fresh(1900);s[M.F.glass]=10;M.react(s,0,1,{ambient:1900,sunlight:0,sun:[1,0,0]},grid);output.reheatGlass={glass:s[M.F.glass],molten:s[M.F.molten]};
s=fresh(-10);s[M.F.water]=10;s[M.F.dissolved]=.36;hb=H(s);M.react(s,0,0,{ambient:-10,sunlight:0,sun:[1,0,0]},grid);output.brineFreeze={energyChange:H(s)-hb,ice:s[M.F.ice],temperature:s[M.F.temperature]};
s=fresh(20);s[M.F.nitrogen]=100;const env={ambient:20,sunlight:0,sun:[1,0,0],gravity:3};const small=new M.CpuSolver(grid,new Float32Array(s)),large=new M.CpuSolver(grid,new Float32Array(s));for(let i=0;i<30;i++)small.advance(4/30,cmd,env);for(let i=0;i<5;i++)large.advance(.8,cmd,env);output.gasStep={elapsed:4,activeStep:4/30,backgroundStep:.8,activePeak:Math.max(...small.state.filter((_,i)=>i%M.STRIDE===M.F.nitrogen)),backgroundPeak:Math.max(...large.state.filter((_,i)=>i%M.STRIDE===M.F.nitrogen)),activeMass:M.totalMass(small.state),backgroundMass:M.totalMass(large.state)};
s=fresh(20);s[M.F.water]=1000;const sw=new M.CpuSolver(grid,new Float32Array(s)),lw=new M.CpuSolver(grid,new Float32Array(s));for(let i=0;i<30;i++)sw.advance(4/30,cmd,env);for(let i=0;i<5;i++)lw.advance(.8,cmd,env);output.waterStep={elapsed:4,activeSource:sw.state[M.F.water],backgroundSource:lw.state[M.F.water]};
s=fresh(18);s[M.F.molten]=50;s[M.F.temperature]=1800;solver=new M.CpuSolver(grid,s);for(let i=0;i<30;i++)solver.advance(1/30,cmd,{ambient:1800,sunlight:0,sun:[1,0,0],gravity:1});output.moltenFlow={source:solver.state[M.F.molten],elsewhere:M.totals(solver.state)[M.F.molten]-solver.state[M.F.molten]};
const ps={version:3,preset:'coast',time:0,state:[...fresh(18)],discoveries:[],supplied:0,removed:0,environment:env,transferredIn:1};const progress=P.freshProgress();P.advanceProgress(progress,[{id:'planet-1',name:'first',snapshot:ps},{id:'planet-2',name:'second',snapshot:{...ps,transferredIn:0}}],M.emptyStock());output.transferMission=progress.completed;
const evidence={...await sourceManifest(), gridCount:grid.count, units:'game kg, degrees C, game seconds; energy under stated constant-cp reference', energyReference:{ice:-334,water:0,vapor:2475,molten:150,glass:0,baseCapacity:28}, conditions:{stepComparison:{elapsed:4,activeStep:4/30,backgroundStep:.8,environment:env,initialTemperature:20,waterSource:1000,nitrogenSource:100},reactionIsolation:'High ambient values suppress thermal forcing in solver-only probes, outside normal environment UI range.',glassPolicy:'ell_glass=0 is a diagnostic assumption, not a measured glass latent heat.'},results:output};
await writeFile(new URL('./audit-evidence.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
} finally {await server.close();}
