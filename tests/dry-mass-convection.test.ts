import {it,expect} from 'vitest';
import {LayeredAtmosphere,AIR_LAYERS} from '../src/sim/layeredAtmosphere';
import {F,STRIDE} from '../src/sim/model';
import type {SphereGrid} from '../src/sim/sphere';
const grid:SphereGrid={count:1,directions:new Float32Array([1,0,0]),indices:new Uint32Array(),geometry:new Float32Array(4),neighbors:new Uint32Array(),distances:new Float32Array()};
it('moist compensated ascent preserves dry mass at every vertical level',()=>{
 const state=new Float32Array(STRIDE);state[F.nitrogen]=.3;state[F.temperature]=35;
 const env={ambient:35,sunlight:0,sun:[1,0,0],gravity:1,climate:true},air=new LayeredAtmosphere(grid,[]);air.initialize(state,env);
 for(let k=0;k<AIR_LAYERS;k++){air.temperature[k]=k===0?35:5;air.mass[k*6]=k===0?.001:0;air.mass[k*6+4]=0;air.mass[k*6+5]=0;}
 const dry=()=>Array.from({length:AIR_LAYERS},(_,k)=>air.mass[k*6+1]+air.mass[k*6+2]+air.mass[k*6+3]),before=dry(),heat=air.totalEnergy();
 (air as unknown as {dynamics:(seconds:number,e:typeof env)=>void}).dynamics(1,env);
 console.log('dry-coordinate transport',{drift:dry().map((v,k)=>v-before[k]),updraft:air.updraft[0]});
 expect(air.updraft[0]).toBeGreaterThan(0);
 for(let k=0;k<AIR_LAYERS;k++)expect(dry()[k]).toBeCloseTo(before[k],13);
 expect(air.totalEnergy()).toBeCloseTo(heat,10);
});
