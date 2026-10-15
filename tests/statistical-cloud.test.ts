import {AIR_SPECIES} from '../src/sim/layeredAtmosphere';
import {it,expect} from 'vitest';
import {statisticalCloud,fractionalCloudDepth,radiativeFluxes,surfaceSolarDown,maximumRandomCloudArea} from '../src/sim/climatePhysics';
import {AIR_LAYERS,AIR_Z,AIR_DZ,LayeredAtmosphere,validLayered,surfaceEnthalpy,climateSurfaceAlbedo} from '../src/sim/layeredAtmosphere';
import {createSphere} from '../src/sim/sphere';
import {seedPlanet,F,STRIDE} from '../src/sim/model';

it('uses exposed ocean and ice albedo for optically thick films',()=>{
 const s=seedPlanet(createSphere(0),'sand',20);
 s[F.water]=1;s[F.ice]=0;
 expect(climateSurfaceAlbedo(s,0)).toBeCloseTo(.07,8);
 s[F.ice]=1;expect(climateSurfaceAlbedo(s,0)).toBeCloseTo(.6,8);
 s[F.water]=s[F.ice]=0;
 expect(climateSurfaceAlbedo(s,0)).toBeGreaterThan(.07);
});

it('integrates the total-water PDF rather than treating mean saturation as full cloud area',()=>{
 expect(statisticalCloud(.79,1)).toEqual({fraction:0,condensate:0});
 expect(statisticalCloud(1,1).fraction).toBeCloseTo(.5,12);
 expect(statisticalCloud(1,1).condensate).toBeCloseTo(.05,12);
 expect(statisticalCloud(1.3,1)).toEqual({fraction:1,condensate:.30000000000000004});
 // Independent numerical quadrature of the specified subgrid distribution.
 for(const mean of [.81,.9,1,1.1,1.19]){
  let amount=0,cloud=0;const n=10000;
  for(let k=0;k<n;k++){const q=mean-.2+.4*(k+.5)/n;if(q>1){cloud++;amount+=(q-1)/n;}}
  const diagnosed=statisticalCloud(mean,1);expect(diagnosed.fraction).toBeCloseTo(cloud/n,4);expect(diagnosed.condensate).toBeCloseTo(amount,7);
 }
 expect(statisticalCloud(1,Infinity)).toEqual({fraction:0,condensate:0});
});

it('uses in-cloud optical path and conserves photons with fractional cloud overlap',()=>{
 const fraction=.25,path=2;
 expect(Math.exp(-fractionalCloudDepth(path,fraction))).toBeCloseTo(1-fraction+fraction*Math.exp(-path/fraction),12);
 const f=radiativeFluxes({temperature:[5,-20],opticalDepth:[.2,.1],cloudTransportDepth:[2,3],cloudFraction:[.25,.5],surfaceTemperature:20,surfaceAlbedo:.07,solar:400});
 expect(f.surfaceNet+f.heating.reduce((a,b)=>a+b,0)).toBeCloseTo(f.toaNet,10);
 const clear=radiativeFluxes({temperature:[20],opticalDepth:[0],cloudTransportDepth:[100],cloudFraction:[0],surfaceTemperature:20,surfaceAlbedo:0,solar:400});
 expect(clear.surfaceSolar).toBe(400);
});

it('extends new columns to the stratosphere and migrates five-layer inventories without added mass or energy',()=>{
 expect(AIR_Z.at(-1)!+AIR_DZ.at(-1)!/2).toBe(42000);
 const grid=createSphere(0),state=seedPlanet(grid,'sand',22),env={ambient:22,sunlight:0,sun:[1,0,0],gravity:1};
 const air=new LayeredAtmosphere(grid,[]);air.initialize(state,env);
 expect(air.mass[(AIR_LAYERS-1)*AIR_SPECIES+1]).toBeGreaterThan(0);
 const modern=air.snapshot()!,take=(data:number[],stride:number,n:number)=>Array.from({length:grid.count},(_,i)=>data.slice(i*AIR_LAYERS*stride,(i*AIR_LAYERS+n)*stride)).flat();
 const legacy={version:1 as const,mass:Array.from({length:grid.count},(_,i)=>Array.from({length:5},(_,k)=>modern.mass.slice((i*AIR_LAYERS+k)*AIR_SPECIES,(i*AIR_LAYERS+k)*AIR_SPECIES+6)).flat()).flat(),temperature:take(modern.temperature,1,5),velocity:take(modern.velocity,3,5),updraft:Array.from({length:grid.count},(_,i)=>modern.updraft.slice(i*(AIR_LAYERS-1),i*(AIR_LAYERS-1)+4)).flat(),gravity:1};
 expect(validLayered(legacy,grid.count)).toBe(true);
 const before=legacy.mass.reduce((a,b)=>a+b,0),oldHeat=legacy.temperature.reduce((h,t,q)=>{
  const cp=[2,1.04,2.22,.85,4.18,2.1],latent=[2475,0,0,0,0,-334];
  return h+cp.reduce((a,c,f)=>a+legacy.mass[q*6+f]*(c*t+latent[f]+9.81*AIR_Z[q%5]/1000),0);
 },0);
 const restored=new LayeredAtmosphere(grid,[]);restored.restore(legacy);
 expect(restored.mass.reduce((a,b)=>a+b,0)).toBeCloseTo(before,12);expect(restored.totalEnergy()).toBeCloseTo(oldHeat,10);
 expect(restored.snapshot()!.version).toBe(6);expect(validLayered(restored.snapshot(),grid.count)).toBe(true);
});

it('conserves latent energy while creating partial cloud below mean saturation',()=>{
 const grid=createSphere(0),s=seedPlanet(grid,'sand',20),env={ambient:20,sunlight:0,sun:[1,0,0],gravity:1};
 const a=new LayeredAtmosphere(grid,[]);a.initialize(s,env);a.attach(s);
 for(let i=0;i<grid.count;i++)for(let k=0;k<AIR_LAYERS;k++){a.mass[(i*AIR_LAYERS+k)*AIR_SPECIES]=0;a.temperature[i*AIR_LAYERS+k]=20;}
 const p=a.pressure(0,0),es=2339.1937366227544,moles=a.mass[1]/.028014;a.mass[0]=.9*.018015*moles*es/(p-es);a.attach(s);
 a.advance(s,0,env,new Float32Array(grid.count*4));
 const initial=surfaceEnthalpy(s,0)+a.columnEnergy(0),energy=new Float32Array(grid.count*4);
 a.advance(s,1/60,env,energy);
 expect(a.mass[4]).toBeGreaterThan(0);expect(a.layerCloudFraction(0,0)).toBeGreaterThan(0);expect(a.layerCloudFraction(0,0)).toBeLessThan(1);
 expect(surfaceEnthalpy(s,0)+a.columnEnergy(0)-initial-energy.slice(0,4).reduce((x,y)=>x+y,0)).toBeCloseTo(0,5);
});


it('uses the same maximum-random cloud area in diagnostics and exact subcolumn radiation',()=>{
 expect(maximumRandomCloudArea([.5,.5])).toBe(.5);
 expect(maximumRandomCloudArea([.5,0,.5])).toBe(.75);
 expect(maximumRandomCloudArea([.2,.8,.1,0,.5,.2])).toBeCloseTo(.9,12);
 const emission=(t:number)=>5.670374419e-8*(t+273.15)**4;
 for(const fraction of [[.5,.5],[.5,0,.5]]){
  const n=fraction.length,cloud=maximumRandomCloudArea(fraction);
  const f=radiativeFluxes({temperature:Array(n).fill(-20),opticalDepth:Array(n).fill(0),
   cloudMeanAbsorptionDepth:fraction.map(c=>c>0?100:0),cloudTransportDepth:Array(n).fill(0),
   cloudFraction:fraction,cloudOverlap:'maximum-random',surfaceTemperature:20,surfaceAlbedo:.07,solar:0});
  // Independent opaque-cloud solution: any cloudy ray emits at -20°C;
  // rays that intersect no cloud see only the 20°C surface.
  expect(f.olr).toBeCloseTo((1-cloud)*emission(20)+cloud*emission(-20),10);
  expect(f.down[0]).toBeCloseTo(cloud*emission(-20),10);
  expect(f.surfaceNet+f.heating.reduce((a,b)=>a+b,0)).toBeCloseTo(f.toaNet,10);
 }
 const fraction=[.2,.8,0,.4,.6],mean=[1,3,0,2,1];
 const f=radiativeFluxes({temperature:[10,0,-5,-15,-30],opticalDepth:[.2,.1,.05,.1,.2],
  cloudMeanAbsorptionDepth:mean,cloudTransportDepth:mean,cloudFraction:fraction,
  cloudOverlap:'maximum-random',surfaceTemperature:22,surfaceAlbedo:.3,solar:420});
 expect(f.surfaceNet+f.heating.reduce((a,b)=>a+b,0)).toBeCloseTo(f.toaNet,9);
 expect(f.reflectedSolar+f.surfaceSolar+f.heating.reduce((a,b,k)=>a+b-f.up[k]+f.up[k+1]-f.down[k+1]+f.down[k],0)).toBeCloseTo(420,9);
});

it('keeps ecological surface light equal to the full spectral shortwave result',()=>{
 const column={temperature:[10,0,-5,-15,-30],opticalDepth:[.2,.1,.05,.1,.2],cloudTransportDepth:[1,2,0,.8,1.5],
  cloudMeanAbsorptionDepth:[.3,.5,0,.2,.4],cloudFraction:[.2,.8,0,.4,.6],surfaceTemperature:22,surfaceAlbedo:.3,solar:700,
  shortwaveBands:[{weight:.4,absorptionDepth:[.1,.2,.3,.2,.1],rayleighDepth:[.05,.04,.03,.02,.01],cloudTransportDepth:[1,2,0,.8,1.5],cloudMeanAbsorptionDepth:[.3,.5,0,.2,.4]},
   {weight:.6,absorptionDepth:[.2,.1,.2,.3,.1],rayleighDepth:[.01,.02,.03,.04,.05],cloudTransportDepth:[.8,1.5,0,.4,1],cloudMeanAbsorptionDepth:[.2,.4,0,.1,.3]}]};
 for(const cloudOverlap of ['maximum-random','random'] as const){const c={...column,cloudOverlap};expect(surfaceSolarDown(c)).toBeCloseTo(radiativeFluxes(c).swDown[0],12);expect(surfaceSolarDown({...c,solar:0})).toBe(0);}
});
