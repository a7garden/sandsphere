import {createSphere} from '../src/sim/sphere';
import {F,STRIDE,CpuSolver,enthalpy,capacity,phaseEnergy} from '../src/sim/model';
import {combust} from '../src/sim/ecology';
import {sandboxDefinition} from '../src/sim/planetDefinition';
import {PlanetView} from '../src/render/planet';
import {AIR_LAYERS,AIR_SPECIES} from '../src/sim/layeredAtmosphere';

async function preview(){
 const grid=createSphere(3),state=new Float32Array(grid.count*STRIDE),e={ambient:22,sunlight:1,sun:[.5,.7,-.5],gravity:1,climate:true,body:sandboxDefinition('rock',1)};
 for(let i=0;i<grid.count;i++){
  const p=i*STRIDE;state[p+F.temperature]=800;state[p+F.sand]=1;state[p+F.nitrogen]=.3;
  if(grid.directions[i*3+1]>.05&&grid.directions[i*3+1]<.65){state[p+F.soil]=.6;const h=enthalpy(state,i);combust(state,p,10,800);state[p+F.temperature]=(h-phaseEnergy(state,i))/capacity(state,i);}
 }
 // Cool the static comparison fixture so thermal glow does not mask smoke.
 for(let i=0;i<grid.count;i++)state[i*STRIDE+F.temperature]=22;
 const solver=new CpuSolver(grid,state),view=await PlanetView.create(document.querySelector('canvas')!,grid,state);
 solver.climate.prepareSurface(solver.state,e);const air=solver.climate.air;
 // These controlled placements test the same renderer with equal carbon mass.
 const columns=Array.from({length:grid.count},(_,i)=>{let m=0;for(let k=0;k<AIR_LAYERS;k++)m+=air.mass[(i*AIR_LAYERS+k)*AIR_SPECIES+8];return m;});
 const ground=solver.state.slice();view.setSpin(0,false,0);view.setEnvironment(e);view.setSun(e.sun);view.setClimate('none',solver.climate);
 function place(layer:number){
  air.detach(solver.state,e);solver.state.set(ground);
  for(let i=0;i<grid.count;i++){for(let k=0;k<AIR_LAYERS;k++)air.mass[(i*AIR_LAYERS+k)*AIR_SPECIES+8]=0;if(layer<0)solver.state[i*STRIDE+F.charcoal]+=columns[i];else air.mass[(i*AIR_LAYERS+layer)*AIR_SPECIES+8]=columns[i];}
  air.attach(solver.state);view.update(solver.state,0,e);const stats=view.visualStats();document.querySelector('#results')!.textContent=JSON.stringify({placement:layer<0?'deposited':layer,soot:stats.smokeRenderedMass,sourceCarbon:columns.reduce((a,b)=>a+b),layers:stats.layers},null,2);
 }
 document.querySelector<HTMLButtonElement>('#low')!.onclick=()=>place(0);document.querySelector<HTMLButtonElement>('#high')!.onclick=()=>place(7);document.querySelector<HTMLButtonElement>('#clear')!.onclick=()=>place(-1);place(0);
 view.engine.runRenderLoop(()=>view.scene.render());
}
void preview().catch(error=>{document.querySelector('#results')!.textContent=String(error);console.error(error);});
