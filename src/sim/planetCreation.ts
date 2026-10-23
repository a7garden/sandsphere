import {defaultDeepInitialConditions,type DeepInitialConditions} from './deepAtmosphereProfile';
import {F,STRIDE,seedPlanet,type Environment,type GasMaterial,type PlanetMaterial} from './model';
import type {SphereGrid} from './sphere';
import {orbitalEnvironment} from './orbit';
import {REFERENCE_PRESSURE,REFERENCE_GAS_MASS} from './waterPhysics';
import {MARS_DEFINITION,JUPITER_DEFINITION,SATURN_DEFINITION,PLANET_SPECIES,planetSupport,sandboxDefinition,type PlanetDefinition} from './planetDefinition';
import {WeatherClimate,type ClimateSnapshot} from './weatherClimate';

/** A preset is initial data, not a thermostat or a prescribed cloud map. */
export function createDefinedPlanet(grid:SphereGrid,input:PlanetDefinition,deepInitial?:DeepInitialConditions){
 const support=planetSupport(input,deepInitial?{initial:deepInitial}:undefined);if(!support.supported)throw new Error(support.reason);const body=structuredClone(input);
 if(body.lowerBoundary.kind==='deep-atmosphere'){
  const initial=deepInitial??defaultDeepInitialConditions(body);
  const state=new Float32Array(grid.count*STRIDE),environment:Environment={...orbitalEnvironment(body.orbit.distanceAu,body.surfaceGravity/9.81),body,climate:true,rotationRate:Math.PI*2*60/body.rotation.periodSeconds,ambient:initial.referenceTemperatureKelvin-273.15},climate=new WeatherClimate(grid);
  climate.giant.initialize(state,environment,initial);climate.stepGiant(state,0,new Float32Array(grid.count*20),environment,new Float32Array(grid.count*4));
  return {state,environment,primary:'rock' as const,climate:climate.snapshot() as ClimateSnapshot|undefined,spin:{angle:0,running:true,tilt:body.rotation.tiltDegrees,period:body.rotation.periodSeconds/60,locked:false}};
 }
 const primary=body.lowerBoundary.primary,gravity=body.surfaceGravity/9.81;
 const environment:Environment={...orbitalEnvironment(body.orbit.distanceAu,gravity),body,climate:true,ambient:body.preset==='mars'?-60:orbitalEnvironment(body.orbit.distanceAu,gravity).ambient};
 const state=seedPlanet(grid,primary,environment.ambient,'none');
 const column=body.atmosphere.pressurePa/REFERENCE_PRESSURE*REFERENCE_GAS_MASS/gravity;
 const mean=body.atmosphere.composition.reduce((s,c)=>s+c.moleFraction*PLANET_SPECIES[c.species].molarMass,0);
 for(let i=0;i<grid.count;i++){
  const p=i*STRIDE;
  for(const c of body.atmosphere.composition){const field=F[c.species as 'vapor'|'nitrogen'|'methane'|'carbonDioxide'|'oxygen'];state[p+field]=column*c.moleFraction*PLANET_SPECIES[c.species].molarMass/mean;}
  if(body.preset==='mars'){
   const latitude=Math.abs(grid.directions[i*3+1]);
   state[p+F.sand]=2+Math.max(0,Math.sin(grid.directions[i*3]*7+grid.directions[i*3+2]*3));state[p+F.clay]=1.5;
   const sand=state[p+F.sand];state[p+F.sand]=sand-.003;state[p+F.surfaceDust]=sand-state[p+F.sand];
   state[p+F.temperature]=-50-35*latitude;
   if(latitude>.85)state[p+F.ice]=.003*(latitude-.85)/.15;
  }
 }
 return {state,environment,primary,climate:undefined as ClimateSnapshot|undefined,spin:{angle:0,running:true,tilt:body.rotation.tiltDegrees,period:body.rotation.periodSeconds/60,locked:false}};
}
export const createMarsPlanet=(grid:SphereGrid)=>createDefinedPlanet(grid,MARS_DEFINITION);
export const createJupiterPlanet=(grid:SphereGrid)=>createDefinedPlanet(grid,JUPITER_DEFINITION);
export const createSaturnPlanet=(grid:SphereGrid)=>createDefinedPlanet(grid,SATURN_DEFINITION);
export function createSandboxPlanet(grid:SphereGrid,primary:PlanetMaterial,distance:number,gravity:number,gas:GasMaterial|'none',gasAmount:number){
 const body=sandboxDefinition(primary,gravity,distance);body.rotation.tiltDegrees=23.5;
 if(gas!=='none'){body.atmosphere.pressurePa=REFERENCE_PRESSURE*gravity*gasAmount;body.atmosphere.composition=[{species:gas,moleFraction:1}];}
 return createDefinedPlanet(grid,body);
}
