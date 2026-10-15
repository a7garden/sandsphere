import type {SphereGrid} from './sphere';
import {F,STRIDE,MASS_FIELDS,type Environment} from './model';
import {SPECIFIC_HEAT,MATERIAL_ENERGY,mechanicalEnergy,temperatureFromEnergy} from './thermodynamics';
import {queueSpecies,carryVelocity,queueEnergyMomentum,commitMomentum,outgoingScale} from './conservativeTransport';
import {DEEP_FIELDS,DEEP_SPECIES,DEEP_CP as CP,DEEP_PHASE,DEEP_MOLAR as MOLAR,CONDENSATES,CLOUD_SCATTER,CLOUD_LONGWAVE,equilibrateCloudParcel,parcelThermalEnergy,saturationPressure} from './giantCloudPhysics';
export {DEEP_FIELDS,DEEP_SPECIES} from './giantCloudPhysics';
import {COLUMN_KG,AIR_SECONDS,type AirEdge} from './layeredAtmosphere';
import {radiativeFluxes,type RadiationColumn} from './climatePhysics';
import {assertPlanetSupport,isDeepAtmosphere} from './planetDefinition';

export const DEEP_LAYERS=12;
export function hasDeepGas(state:Float32Array){for(let p=0;p<state.length;p+=STRIDE)if([28,29,30,31,32].some(f=>state[p+f]>0))return true;return false;}
const R=8.314462618;
/** Creation-only boundary data. The evolution solver never reads preset names. */
export interface DeepInitialConditions {
 referenceTemperatureKelvin:number;
 minimumTemperatureKelvin:number;
 jetSpeed:number;
 temperaturePerturbation?:number;
 cloudBands?:boolean;
}
export interface DeepMetadata {radiusMeters:number;gravity:number;referencePressure:number;initialBottomPressure:number;intrinsicFlux:number;}
export interface DeepSnapshot extends DeepMetadata {version:1|2;mass:number[];temperature:number[];velocity:number[];height:number[];}
export interface DeepCheckpoint extends DeepMetadata {version:2;mass:Float64Array;temperature:Float64Array;velocity:Float64Array;height:Float64Array;}
export function validDeep(value:unknown,count:number):value is DeepSnapshot {
 if(!value||typeof value!=='object')return false;const d=value as DeepSnapshot,n=count*DEEP_LAYERS;
 const arr=(v:unknown,length:number,lo:number,hi:number)=>Array.isArray(v)&&v.length===length&&v.every(x=>Number.isFinite(x)&&x>=lo&&x<=hi);
 const width=deepMassWidth(d);
 return [1,2].includes(d.version)&&Number.isFinite(d.radiusMeters)&&d.radiusMeters>=1e3&&d.radiusMeters<=2e8&&Number.isFinite(d.gravity)&&d.gravity>=.01&&d.gravity<=3
  &&Number.isFinite(d.referencePressure)&&d.referencePressure>=1e3&&Number.isFinite(d.initialBottomPressure)&&d.initialBottomPressure>=2*d.referencePressure&&d.initialBottomPressure<=1e7
  &&Number.isFinite(d.intrinsicFlux)&&d.intrinsicFlux>=0&&d.intrinsicFlux<=1e5&&arr(d.mass,n*width,0,1e5)&&arr(d.temperature,n,-250,2500)&&arr(d.velocity,n*3,-5000,5000)
  &&arr(d.height,DEEP_LAYERS,0,3e6)&&d.height.every((h,k)=>!k||h<d.height[k-1])
  &&Array.from({length:n},(_,q)=>d.mass[q*width]+d.mass[q*width+1]).every(m=>m>1e-15);
}
export const deepMassWidth=(d:{version:number})=>d.version===1?2:DEEP_SPECIES;
export function upgradeDeepSnapshot(d:DeepSnapshot):DeepSnapshot {
 const out=structuredClone(d);if(d.version===2)return out;
 const mass=Array(d.temperature.length*DEEP_SPECIES).fill(0);
 for(let q=0;q<d.temperature.length;q++){mass[q*DEEP_SPECIES]=d.mass[q*2];mass[q*DEEP_SPECIES+1]=d.mass[q*2+1];}
 return {...out,version:2,mass};
}
export function deepSnapshotMass(d:DeepSnapshot|DeepCheckpoint){let m=0;for(const mass of d.mass)m+=mass;return m;}
export function deepSnapshotEnergy(d:DeepSnapshot|DeepCheckpoint){let h=0;const width=deepMassWidth(d);for(let q=0;q<d.temperature.length;q++){let m=0,thermal=0;for(let f=0;f<width;f++){const amount=d.mass[q*width+f];m+=amount;thermal+=amount*(CP[f]*d.temperature[q]+DEEP_PHASE[f]);}const v=q*3;h+=thermal+m*(9.81*d.gravity*d.height[q%DEEP_LAYERS]+.5*(d.velocity[v]**2+d.velocity[v+1]**2+d.velocity[v+2]**2))/1000;}return h;}

/** Finite H₂/He hydrostatic columns. Reference heights are fixed at creation;
 * pressure follows actual overlying mass. Both material boundaries are sealed.
 * The lower radiative boundary returns incident heat and adds the stated net
 * intrinsic flux. No solid substrate, thermostat or gas replenishment exists. */
export class DeepAtmosphere {
 readonly mass:Float64Array;readonly temperature:Float64Array;readonly velocity:Float64Array;readonly height=new Float64Array(DEEP_LAYERS);
 ready=false;radiusMeters=1e6;gravity=1;referencePressure=1e5;initialBottomPressure=3e6;intrinsicFlux=0;
 private carried=new Float64Array(3);
 private delta:Float64Array;private heat:Float64Array;private momentum:Float64Array;private out:Float64Array;private oldMass:Float64Array;private acceleration:Float64Array;private pressureValues:Float64Array;
 constructor(readonly grid:SphereGrid,private edges:AirEdge[]){const n=grid.count*DEEP_LAYERS;this.mass=new Float64Array(n*DEEP_SPECIES);this.temperature=new Float64Array(n);this.velocity=new Float64Array(n*3);this.delta=new Float64Array(n*DEEP_SPECIES);this.heat=new Float64Array(n);this.momentum=new Float64Array(n*3);this.out=new Float64Array(n);this.oldMass=new Float64Array(n);this.acceleration=new Float64Array(n*3);this.pressureValues=new Float64Array(n);}
 private metadata():DeepMetadata{return {radiusMeters:this.radiusMeters,gravity:this.gravity,referencePressure:this.referencePressure,initialBottomPressure:this.initialBottomPressure,intrinsicFlux:this.intrinsicFlux};}
 snapshot():DeepSnapshot|undefined{return this.ready?{version:2,...this.metadata(),mass:[...this.mass],temperature:[...this.temperature],velocity:[...this.velocity],height:[...this.height]}:undefined;}
 checkpoint():DeepCheckpoint|undefined{return this.ready?{version:2,...this.metadata(),mass:this.mass.slice(),temperature:this.temperature.slice(),velocity:this.velocity.slice(),height:this.height.slice()}:undefined;}
 restore(d?:DeepSnapshot|DeepCheckpoint){this.ready=!!d;this.mass.fill(0);this.temperature.fill(0);this.velocity.fill(0);this.height.fill(0);if(d){if(d.version===1)d=upgradeDeepSnapshot(d);Object.assign(this,{radiusMeters:d.radiusMeters,gravity:d.gravity,referencePressure:d.referencePressure,initialBottomPressure:d.initialBottomPressure,intrinsicFlux:d.intrinsicFlux});this.mass.set(d.mass);this.temperature.set(d.temperature);this.velocity.set(d.velocity);this.height.set(d.height);}}
 layerMass(q:number){const p=q*DEEP_SPECIES,m=this.mass;return m[p]+m[p+1]+m[p+2]+m[p+3]+m[p+4]+m[p+5]+m[p+6]+m[p+7];}
 layerCapacity(q:number){let c=0;for(let f=0;f<DEEP_SPECIES;f++)c+=this.mass[q*DEEP_SPECIES+f]*CP[f];return c;}
 private phaseEnergy(q:number){const p=q*DEEP_SPECIES,m=this.mass;return m[p+2]*DEEP_PHASE[2]+m[p+4]*DEEP_PHASE[4]+m[p+5]*DEEP_PHASE[5]+m[p+7]*DEEP_PHASE[7];}
 private speed2(q:number){const v=q*3;return this.velocity[v]**2+this.velocity[v+1]**2+this.velocity[v+2]**2;}
 layerEnergy(q:number){return parcelThermalEnergy(this.mass,q*DEEP_SPECIES,this.temperature[q])+mechanicalEnergy(this.layerMass(q),9.81*this.gravity,this.height[q%DEEP_LAYERS],this.speed2(q));}
 private setEnergy(q:number,h:number){const c=this.layerCapacity(q);if(c<=1e-15)throw new Error('깊은 대기층의 질량이 고갈되었습니다.');this.temperature[q]=temperatureFromEnergy(h,c,this.phaseEnergy(q),mechanicalEnergy(this.layerMass(q),9.81*this.gravity,this.height[q%DEEP_LAYERS],this.speed2(q)));}
 totalMass(){return this.mass.reduce((a,b)=>a+b,0);}
 totalEnergy(){let h=0;for(let q=0;q<this.temperature.length;q++)h+=this.layerEnergy(q);return h;}
 pressure(i:number,k:number){let m=0;for(let l=0;l<k;l++)m+=this.layerMass(i*DEEP_LAYERS+l);return (m+.5*this.layerMass(i*DEEP_LAYERS+k))*COLUMN_KG*9.81*this.gravity;}
 bottomPressure(i:number){let m=0;for(let k=0;k<DEEP_LAYERS;k++)m+=this.layerMass(i*DEEP_LAYERS+k);return m*COLUMN_KG*9.81*this.gravity;}
 referenceLayer(i:number){let best=0,error=Infinity,above=0;for(let k=0;k<DEEP_LAYERS;k++){const mass=this.layerMass(i*DEEP_LAYERS+k),pressure=(above+.5*mass)*COLUMN_KG*9.81*this.gravity,d=Math.abs(Math.log(pressure/this.referencePressure));if(d<error){best=k;error=d;}above+=mass;}return best;}
 conditions(i:number){const k=this.referenceLayer(i),q=i*DEEP_LAYERS+k,p=this.pressure(i,k),t=this.temperature[q],m=q*DEEP_SPECIES,n=[0,1,2,5].reduce((a,f)=>a+this.mass[m+f]/MOLAR[f],0),humidity=(f:2|5,species:'ammonia'|'water')=>this.mass[m+f]/MOLAR[f]/n*p/saturationPressure(species,t);return {temperature:t,pressure:p,height:this.height[k],layer:k,humidity:humidity(5,'water'),ammoniaHumidity:humidity(2,'ammonia'),lift:0,saturation:0,excess:0};}
 initialize(s:Float32Array,e:Environment,initial?:DeepInitialConditions){
  const preset=initial!==undefined;
  assertPlanetSupport(e.body);const d=e.body!;if(!isDeepAtmosphere(d)||d.lowerBoundary.kind!=='deep-atmosphere')throw new Error('깊은 대기 정의가 필요합니다.');if(this.ready)return;
  this.radiusMeters=d.radiusMeters;this.gravity=d.surfaceGravity/9.81;this.referencePressure=d.atmosphere.pressurePa;this.initialBottomPressure=d.lowerBoundary.pressurePa;this.intrinsicFlux=d.lowerBoundary.intrinsicFlux;
  const mole=d.atmosphere.composition.map(c=>[{hydrogen:0,helium:1,ammonia:2,vapor:5}[c.species as 'hydrogen'|'helium'|'ammonia'|'vapor'],c.moleFraction] as const),mean=mole.reduce((a,[f,x])=>a+x*MOLAR[f],0),fraction=CP.map((_,f)=>(mole.find(([k])=>k===f)?.[1]??0)*MOLAR[f]/mean),gasR=R/mean,cp=fraction.reduce((a,x,f)=>a+x*CP[f]*1000,0),kappa=gasR/cp;
  const ref=initial?.referenceTemperatureKelvin??Math.max(100,273.15+e.ambient),floor=initial?.minimumTemperatureKelvin??Math.min(110,ref);
  const faces=Array.from({length:DEEP_LAYERS+1},(_,k)=>k===0?0:100*(this.initialBottomPressure/100)**((k-1)/(DEEP_LAYERS-1))),middle=faces.slice(1).map((p,k)=>(p+faces[k])*.5),profile=middle.map(p=>Math.max(floor,ref*(p/this.referencePressure)**kappa));
  let z=0;for(let k=DEEP_LAYERS-1;k>=0;k--){const low=faces[k+1],top=Math.max(1,faces[k]),dz=gasR*profile[k]/(9.81*this.gravity)*Math.log(low/top);this.height[k]=z+dz*.5;z+=dz;}
  for(let i=0;i<this.grid.count;i++){
   const p=i*STRIDE,oldH=DEEP_FIELDS.reduce((h,f)=>h+s[p+f]*(SPECIFIC_HEAT[f]*s[p+F.temperature]+MATERIAL_ENERGY[f]),0),latitude=Math.asin(this.grid.directions[i*3+1]),longitude=Math.atan2(this.grid.directions[i*3+2],this.grid.directions[i*3]),perturb=preset?(initial.temperaturePerturbation??1)*(4*Math.cos(latitude*12)+.8*Math.cos(longitude*3)*Math.cos(latitude)**2):0;
   for(let k=0;k<DEEP_LAYERS;k++){const q=i*DEEP_LAYERS+k,weight=(faces[k+1]-faces[k])/this.initialBottomPressure;this.temperature[q]=preset?profile[k]-273.15+perturb:s[p+F.temperature];for(let f=0;f<DEEP_SPECIES;f++)this.mass[q*DEEP_SPECIES+f]=preset?(faces[k+1]-faces[k])/(COLUMN_KG*9.81*this.gravity)*fraction[f]:s[p+DEEP_FIELDS[f]]*weight;
    if(preset){const x=this.grid.directions[i*3],zz=this.grid.directions[i*3+2],l=Math.hypot(x,zz),u=initial!.jetSpeed*Math.cos(latitude*8)*Math.cos(latitude)*(.55+.45*Math.exp(-(Math.log(middle[k]/this.referencePressure)**2)/9));if(l>1e-8)this.velocity.set([zz/l*u,0,-x/l*u],q*3);}
   }
   if(!preset){let h=0,c=0;for(let k=0;k<DEEP_LAYERS;k++){h+=this.layerEnergy(i*DEEP_LAYERS+k);c+=this.layerCapacity(i*DEEP_LAYERS+k);}const change=(oldH-h)/Math.max(1e-15,c);for(let k=0;k<DEEP_LAYERS;k++)this.temperature[i*DEEP_LAYERS+k]+=change;}
  }
  this.ready=true;if(preset){if(initial.cloudBands)this.seedCloudBands();this.equilibrateClouds();}this.validate();this.sync(s);
 }
 sync(s:Float32Array){for(let i=0;i<this.grid.count;i++){const p=i*STRIDE;let h=0,c=0;for(let f=0;f<DEEP_SPECIES;f++){let m=0;for(let k=0;k<DEEP_LAYERS;k++)m+=this.mass[(i*DEEP_LAYERS+k)*DEEP_SPECIES+f];s[p+DEEP_FIELDS[f]]=m;}for(let k=0;k<DEEP_LAYERS;k++){const q=i*DEEP_LAYERS+k;h+=this.layerCapacity(q)*this.temperature[q];c+=this.layerCapacity(q);}s[p+F.temperature]=h/c;}}
 heatForTarget(i:number,target:number,mode:'heat'|'cool',pending=0){const q=i*DEEP_LAYERS+this.referenceLayer(i),change=this.layerCapacity(q)*(target-this.temperature[q])-pending;return mode==='heat'?Math.max(0,change):Math.min(0,change);}
 private validate(){for(let q=0;q<this.temperature.length;q++)if(!Number.isFinite(this.temperature[q])||this.temperature[q]<-250||this.temperature[q]>2500||!Number.isFinite(this.layerMass(q))||this.layerMass(q)<=1e-15||this.mass.subarray(q*DEEP_SPECIES,(q+1)*DEEP_SPECIES).some(m=>!Number.isFinite(m)||m<0)||Math.sqrt(this.speed2(q))>5000)throw new Error('깊은 대기 상태가 계산 범위를 벗어났습니다.');}
 private clear(){this.delta.fill(0);this.heat.fill(0);this.momentum.fill(0);this.out.fill(0);for(let q=0;q<this.oldMass.length;q++)this.oldMass[q]=this.layerMass(q);}
 private queue(a:number,b:number,fraction:number){
  if(fraction<=0)return;
  for(let f=0;f<DEEP_SPECIES;f++)queueSpecies(this.mass,this.delta,DEEP_SPECIES,a,b,f,fraction);
  carryVelocity(this.velocity,a,this.grid.directions,Math.floor(a/DEEP_LAYERS),Math.floor(b/DEEP_LAYERS),this.carried);
  queueEnergyMomentum(a,b,this.oldMass[a]*fraction,this.layerEnergy(a)*fraction,this.velocity,this.carried,this.heat,this.momentum);
 }
 private commit(){for(let q=0;q<this.oldMass.length;q++){const h=this.layerEnergy(q)+this.heat[q],m0=this.oldMass[q];for(let f=0;f<DEEP_SPECIES;f++)this.mass[q*DEEP_SPECIES+f]+=this.delta[q*DEEP_SPECIES+f];const m=this.layerMass(q);commitMomentum(q,m0,m,this.velocity,this.momentum);this.setEnergy(q,h);}}
 private gasR(q:number){let n=0;for(const f of [0,1,2,5])n+=this.mass[q*DEEP_SPECIES+f]/MOLAR[f];return R*n/this.layerMass(q);}
 private cachePressures(){for(let i=0;i<this.grid.count;i++){let above=0;for(let k=0;k<DEEP_LAYERS;k++){const q=i*DEEP_LAYERS+k,m=this.layerMass(q);this.pressureValues[q]=(above+.5*m)*COLUMN_KG*9.81*this.gravity;above+=m;}}}
 dynamics(dt:number,e:Environment){
  this.cachePressures();this.acceleration.fill(0);for(const {i,j,distance,t} of this.edges)for(let k=0;k<DEEP_LAYERS;k++){const a=i*DEEP_LAYERS+k,b=j*DEEP_LAYERS+k,p1=this.pressureValues[a],p2=this.pressureValues[b],rt=(this.gasR(a)*(this.temperature[a]+273.15)+this.gasR(b)*(this.temperature[b]+273.15))*.5,thermal=9.81*this.gravity*this.height[k]*2*(this.temperature[b]-this.temperature[a])/Math.max(1,this.temperature[a]+this.temperature[b]+546.3),force=-(rt*Math.log(p2/p1)+thermal)/(this.radiusMeters*distance*3);for(const q of [a,b]){const cell=Math.floor(q/DEEP_LAYERS),normal=this.grid.directions.subarray(cell*3,cell*3+3),dot=t.reduce((v,x,k)=>v+x*normal[k],0);for(let v=0;v<3;v++)this.acceleration[q*3+v]+=force*(t[v]-dot*normal[v]);}}
  for(let q=0;q<this.oldMass.length;q++){const h=this.layerEnergy(q),i=Math.floor(q/DEEP_LAYERS),n=this.grid.directions.subarray(i*3,i*3+3),v=q*3,x=Array.from(this.velocity.subarray(v,v+3),(x,k)=>x+this.acceleration[v+k]*dt),dot=x.reduce((a,b,k)=>a+b*n[k],0),tangent=x.map((x,k)=>x-dot*n[k]),angle=2*(e.rotationRate??0)/AIR_SECONDS*n[1]*dt,c=Math.cos(angle),sn=-Math.sin(angle),cross=[n[1]*tangent[2]-n[2]*tangent[1],n[2]*tangent[0]-n[0]*tangent[2],n[0]*tangent[1]-n[1]*tangent[0]];for(let k=0;k<3;k++)this.velocity[v+k]=(tangent[k]*c+cross[k]*sn)*Math.exp(-dt/604800);this.setEnergy(q,h);}
  this.clear();const flows:{a:number;b:number;fraction:number}[]=[];for(const {i,j,distance,t} of this.edges)for(let k=0;k<DEEP_LAYERS;k++){const a=i*DEEP_LAYERS+k,b=j*DEEP_LAYERS+k,speed=t.reduce((a,x,v)=>a+x*(this.velocity[(i*DEEP_LAYERS+k)*3+v]+this.velocity[(j*DEEP_LAYERS+k)*3+v])*.5,0),from=speed>=0?a:b,to=speed>=0?b:a,fraction=Math.abs(speed)*dt/(this.radiusMeters*distance*3);flows.push({a:from,b:to,fraction});this.out[from]+=fraction;}
  for(const {a,b,fraction} of flows)this.queue(a,b,fraction*outgoingScale(1,this.out[a],.25));this.commit();
  this.cachePressures();this.clear();for(let i=0;i<this.grid.count;i++)for(let k=0;k<DEEP_LAYERS-1;k++){const a=i*DEEP_LAYERS+k,b=a+1,theta=(q:number,l:number)=>(this.temperature[q]+273.15)*(this.referencePressure/this.pressureValues[i*DEEP_LAYERS+l])**(this.gasR(q)/(this.layerCapacity(q)/this.layerMass(q)*1000)),unstable=Math.max(0,(theta(b,k+1)-theta(a,k))/Math.max(1,theta(a,k))),exchange=Math.min(this.oldMass[a],this.oldMass[b])*Math.min(.02,dt*(1e-6+.002*unstable));this.queue(a,b,exchange/this.oldMass[a]);this.queue(b,a,exchange/this.oldMass[b]);}this.commit();
 }
 /** Preset-only tracer perturbation, never a continuing latitude forcing.
  * Swap equal masses with the deepest layer, conserving each species and
  * every layer's total energy. Subsequent bands follow prognostic transport. */
 seedCloudBands(){for(let i=0;i<this.grid.count;i++){
  const bottom=(i*DEEP_LAYERS+DEEP_LAYERS-1),b=bottom*DEEP_SPECIES,factor=.05+.95*(.5+.5*Math.tanh(this.zonalWind(i)/35));
  for(let k=0;k<DEEP_LAYERS-1;k++){const q=i*DEEP_LAYERS+k,o=q*DEEP_SPECIES,p=this.pressure(i,k);if(p>1e6)continue;const before=this.layerEnergy(q),below=this.layerEnergy(bottom);let moved=0;
   for(const base of [2,5]){if(base===2&&p>this.referencePressure)continue;for(let f=base;f<base+3;f++){const move=this.mass[o+f]*(1-factor);this.mass[o+f]-=move;this.mass[b+f]+=move;moved+=move;}}
   const dry=this.mass[b]+this.mass[b+1];if(moved>dry)throw new Error('띠 초기화에 필요한 심부 기체가 부족합니다.');const hydrogen=moved*this.mass[b]/dry,helium=moved-hydrogen;
   this.mass[b]-=hydrogen;this.mass[b+1]-=helium;this.mass[o]+=hydrogen;this.mass[o+1]+=helium;this.setEnergy(q,before);this.setEnergy(bottom,below);
  }
 }}
 equilibrateClouds(){for(let i=0;i<this.grid.count;i++){let above=0;for(let k=0;k<DEEP_LAYERS;k++){const q=i*DEEP_LAYERS+k,h=this.layerEnergy(q),m=this.layerMass(q),pressure=(above+.5*m)*COLUMN_KG*9.81*this.gravity;this.temperature[q]=equilibrateCloudParcel(this.mass,q*DEEP_SPECIES,this.temperature[q],pressure);this.setEnergy(q,h);above+=m;}}}
 sedimentation(dt:number){
  this.clear();for(let i=0;i<this.grid.count;i++)for(let k=0;k<DEEP_LAYERS-1;k++){
   const a=i*DEEP_LAYERS+k,b=a+1,dz=this.height[k]-this.height[k+1],aOffset=a*DEEP_SPECIES,bOffset=b*DEEP_SPECIES;
   for(const f of CONDENSATES){const speed=f===3?.15:f===4?.06:f===6?.3:.1,m=this.mass[aOffset+f]*Math.min(.25,dt*speed/dz);if(m===0)continue;
    const h=m*(CP[f]*this.temperature[a]+DEEP_PHASE[f]+(9.81*this.gravity*this.height[k]+this.speed2(a)*.5)/1000);
    this.delta[aOffset+f]-=m;this.delta[bOffset+f]+=m;this.heat[a]-=h;this.heat[b]+=h;
    for(let v=0;v<3;v++){const momentum=m*this.velocity[a*3+v];this.momentum[a*3+v]-=momentum;this.momentum[b*3+v]+=momentum;}
   }
  }this.commit();
 }
 cloudOptics(i:number){
  let ammonia=0,water=0,tau=0,ammoniaOpticalDepth=0,waterOpticalDepth=0,visibleAmmonia=0,visibleWater=0,visiblePressure=0;
  for(let k=0;k<DEEP_LAYERS;k++){const q=i*DEEP_LAYERS+k,o=q*DEEP_SPECIES,a=this.mass[o+3]+this.mass[o+4],w=this.mass[o+6]+this.mass[o+7],at=COLUMN_KG*(this.mass[o+3]*CLOUD_SCATTER[3]+this.mass[o+4]*CLOUD_SCATTER[4]),wt=COLUMN_KG*(this.mass[o+6]*CLOUD_SCATTER[6]+this.mass[o+7]*CLOUD_SCATTER[7]),depth=at+wt,visible=Math.exp(-tau)*(1-Math.exp(-depth));ammonia+=a;water+=w;ammoniaOpticalDepth+=at;waterOpticalDepth+=wt;visibleAmmonia+=visible*at/Math.max(1e-30,depth);visibleWater+=visible*wt/Math.max(1e-30,depth);visiblePressure+=visible*this.pressure(i,k);tau+=depth;}
  return {ammonia,water,opticalDepth:tau,ammoniaOpticalDepth,waterOpticalDepth,visibleAmmonia,visibleWater,cloudPressure:visiblePressure/Math.max(1e-30,visibleAmmonia+visibleWater)};
 }
 zonalWind(i:number,k=this.referenceLayer(i)){const x=this.grid.directions[i*3],z=this.grid.directions[i*3+2],length=Math.hypot(x,z),v=(i*DEEP_LAYERS+k)*3;return length>1e-9?(this.velocity[v]*z-this.velocity[v+2]*x)/length:0;}
 bands(){const bins=Array.from({length:12},(_,i)=>({latitude:-82.5+i*15,wind:0,cloud:0,count:0}));for(let i=0;i<this.grid.count;i++){const latitude=Math.asin(this.grid.directions[i*3+1])*180/Math.PI,b=bins[Math.min(11,Math.floor((latitude+90)/15))];b.wind+=this.zonalWind(i);b.cloud+=this.cloudOptics(i).opticalDepth;b.count++;}return bins.map(b=>({...b,wind:b.count?b.wind/b.count:0,cloud:b.count?b.cloud/b.count:0}));}
 radiationColumn(i:number,e:Environment,solarOverride?:number):RadiationColumn {
  const temperature=new Float64Array(DEEP_LAYERS),opticalDepth=new Float64Array(DEEP_LAYERS),absorptionDepth=new Float64Array(DEEP_LAYERS),rayleighDepth=new Float64Array(DEEP_LAYERS),cloudTransportDepth=new Float64Array(DEEP_LAYERS);let above=0;
  for(let k=0;k<DEEP_LAYERS;k++){const q=i*DEEP_LAYERS+k,o=q*DEEP_SPECIES,r=DEEP_LAYERS-1-k,low=above,high=above+this.layerMass(q)*COLUMN_KG*9.81*this.gravity,n=[0,1,2,5].reduce((a,f)=>a+this.mass[o+f]/MOLAR[f],0),fraction=this.mass[o]/MOLAR[0]/n;above=high;temperature[r]=this.temperature[q];opticalDepth[r]=.25*fraction*(fraction+.5*this.mass[o+1]/MOLAR[1]/n)*((high/1e5)**2-(low/1e5)**2)+COLUMN_KG*(.1*this.mass[o+2]+.02*this.mass[o+5]);absorptionDepth[r]=.006*(high-low)/1e5;rayleighDepth[r]=.05*fraction*(high-low)/1e5;
   for(const f of CONDENSATES){opticalDepth[r]+=COLUMN_KG*this.mass[o+f]*CLOUD_LONGWAVE[f];cloudTransportDepth[r]+=COLUMN_KG*this.mass[o+f]*CLOUD_SCATTER[f];}
  }
  const exposure=Math.max(0,e.sun.reduce((a,x,k)=>a+x*this.grid.directions[i*3+k],0));return {temperature,opticalDepth,cloudTransportDepth,longwaveBands:[{weight:1,opticalDepth,surfaceSource:0}],shortwaveBands:[{weight:1,absorptionDepth,rayleighDepth}],surfaceTemperature:temperature[0],surfaceAlbedo:0,solar:solarOverride??1361*e.sunlight*exposure};
 }
 radiation(dt:number,e:Environment,energy:Float32Array){for(let i=0;i<this.grid.count;i++){const column=this.radiationColumn(i,e),down=radiativeFluxes(column).down[0];column.longwaveBands![0].surfaceSource=down+this.intrinsicFlux;const flux=radiativeFluxes(column),coefficient=dt/(COLUMN_KG*1000);for(let k=0;k<DEEP_LAYERS;k++){const q=i*DEEP_LAYERS+k,r=DEEP_LAYERS-1-k;this.setEnergy(q,this.layerEnergy(q)+coefficient*(flux.heating[r]+(r===0?flux.surfaceSolar:0)));}energy[i*4]+=coefficient*flux.toaNet;energy[i*4+1]+=coefficient*this.intrinsicFlux;}}
 advance(s:Float32Array,gameDt:number,commands:Float32Array,e:Environment,energy:Float32Array){
  assertPlanetSupport(e.body);if(!isDeepAtmosphere(e.body))throw new Error('깊은 대기 경계가 필요합니다.');
  if(e.climate!==true)throw new Error('깊은 대기는 대기 계산을 켠 상태에서 실행합니다.');
  const body=e.body!,boundary=body.lowerBoundary;if(this.ready&&(boundary.kind!=='deep-atmosphere'||this.radiusMeters!==body.radiusMeters||this.gravity!==body.surfaceGravity/9.81||this.referencePressure!==body.atmosphere.pressurePa||this.initialBottomPressure!==boundary.pressurePa||this.intrinsicFlux!==boundary.intrinsicFlux))throw new Error('행성 정의와 깊은 대기 상태가 다릅니다. 대기 상태를 함께 불러오세요.');
  if(commands.some((v,k)=>k%20!==4&&v!==0))throw new Error('가스형 행성에는 온도 조정만 적용할 수 있습니다.');
  for(let i=0;i<this.grid.count;i++)for(const f of MASS_FIELDS)if(!(DEEP_FIELDS as readonly number[]).includes(f)&&s[i*STRIDE+f]!==0)throw new Error('깊은 대기에는 지원하는 기체와 구름 성분만 넣을 수 있습니다.');
  this.initialize(s,e);if(gameDt<=0&&!commands.some(v=>v!==0))return;
  for(let i=0;i<this.grid.count;i++){const q=i*DEEP_LAYERS+this.referenceLayer(i),heat=commands[i*20+4];if(heat){this.setEnergy(q,this.layerEnergy(q)+heat);energy[i*4+1]+=heat;}}
  let remaining=Math.max(0,gameDt)*AIR_SECONDS;while(remaining>1e-10){let dt=Math.min(5,remaining);for(const edge of this.edges)for(let k=0;k<DEEP_LAYERS;k++)dt=Math.min(dt,.1*edge.distance*this.radiusMeters/Math.max(1,Math.sqrt(this.speed2(edge.i*DEEP_LAYERS+k)),Math.sqrt(this.speed2(edge.j*DEEP_LAYERS+k))));this.radiation(dt,e,energy);this.dynamics(dt,e);this.sedimentation(dt);this.equilibrateClouds();this.validate();remaining-=dt;}
  if(gameDt<=0)this.equilibrateClouds();this.validate();this.sync(s);
 }
}
