import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {root,sourceManifest} from './source-manifest.mjs';
const server=await createServer({root,server:{middlewareMode:true},appType:'custom'});
try{
 const M=await server.ssrLoadModule('/src/sim/model.ts'),S=await server.ssrLoadModule('/src/sim/sphere.ts'),A=await server.ssrLoadModule('/src/sim/atmosphere.ts'),C=await server.ssrLoadModule('/src/sim/climate.ts');
 const env={ambient:20,sunlight:0,sun:[1,0,0],gravity:1},thermalSpatial=[];
 for(const level of [1,2,3,4]){
  const grid=S.createSphere(level),s=new Float32Array(grid.count*M.STRIDE);let initial=0;
  for(let i=0;i<grid.count;i++){const y=grid.directions[i*3+1];s[i*M.STRIDE+M.F.rock]=8;s[i*M.STRIDE+M.F.temperature]=20+10*y;initial+=(s[i*M.STRIDE+M.F.temperature]-20)*y;}
  const solver=new M.CpuSolver(grid,s.slice()),commands=new Float32Array(grid.count*M.COMMAND_STRIDE),initialH=M.totalEnthalpy(s);let q=0;
  for(let n=0;n<300;n++){solver.advance(1/30,commands,env);q+=solver.energyChanges.reduce((a,b)=>a+b,0);}
  let final=0;for(let i=0;i<grid.count;i++)final+=(solver.state[i*M.STRIDE+M.F.temperature]-20)*grid.directions[i*3+1];
  thermalSpatial.push({cells:grid.count,seconds:10,conductionDecay:1-final/initial/Math.exp(-C.BATH_CONDUCTANCE*10/M.capacity(s,0)),energyResidual:M.totalEnthalpy(solver.state)-initialH-q,energyResidualRelative:Math.abs(M.totalEnthalpy(solver.state)-initialH-q)/Math.abs(initialH)});
 }
 const grid=S.createSphere(1),s=new Float32Array(grid.count*M.STRIDE);for(let i=0;i<grid.count;i++){s[i*M.STRIDE+M.F.rock]=8;s[i*M.STRIDE+M.F.temperature]=20;s[i*M.STRIDE+M.F.methane]=3;s[i*M.STRIDE+M.F.nitrogen]=.3;}
 const before=A.atmosphereState(s,{...env,gravity:.01}),solver=new M.CpuSolver(grid,s.slice()),commands=new Float32Array(grid.count*M.COMMAND_STRIDE);let escaped=0,heat=0;
 for(let n=0;n<300;n++){solver.advance(1/30,commands,{...env,gravity:.01});escaped+=solver.escapeCells.reduce((a,b)=>a+b,0);heat+=solver.energyChanges.reduce((a,b)=>a+b,0);}
 const loss={seconds:10,initialMass:M.totalMass(s),remainingMass:M.totalMass(solver.state),escaped,massResidual:M.totalMass(solver.state)+escaped-M.totalMass(s),energyResidual:M.totalEnthalpy(solver.state)-M.totalEnthalpy(s)-heat,initialAtmosphere:before,finalAtmosphere:A.atmosphereState(solver.state,{...env,gravity:.01})};
 const files=['src/sim/climate.ts','src/sim/atmosphere.ts','src/sim/materialPhysics.ts','src/sim/waterPhysics.ts','src/ui/inspector.ts','src/ui/depthProfile.ts','src/render/sectionGeometry.ts','src/render/sky.ts','tests/p3-science.test.ts','tests/atmosphere.test.ts','tests/section-lab.ts','tests/section-lab.html'];
 const report={...await sourceManifest(files),tests:await readFile('/tmp/sandsphere-p3-tests.log','utf8'),build:await readFile('/tmp/sandsphere-p3-build.log','utf8'),thermalSpatial,loss,pressureLevels:[8.8,100,300].map(H=>({scaleHeightKm:H,...A.pressureBoundary(1,H)}))};
 await writeFile(new URL('p3-implementation-evidence.json',import.meta.url),JSON.stringify(report,null,2));
 console.log(JSON.stringify({thermalSpatial,loss:{...loss,initialAtmosphere:undefined,finalAtmosphere:undefined}},null,2));
}finally{await server.close()}
