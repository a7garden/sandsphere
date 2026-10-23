import {solveEnthalpy} from './phaseEquilibrium';
import {saturationPressure as waterSaturationPressure} from './waterPhysics';
/** H₂, He, NH₃ vapor/liquid/ice, H₂O vapor/liquid/ice. Model kg, kJ, °C.
 * Fixed heat capacities and ideal partial pressures; no NH₄SH or solutions.
 * NH₃ saturation is anchored at 194.95 K / 6060 Pa with 31.2 kJ/mol
 * sublimation heat. Fusion (333 kJ/kg) and optical coefficients are model inputs. */
import {SPECIFIC_HEAT,MATERIAL_ENERGY,AMMONIA_MELTING,AMMONIA_ICE_OFFSET,AMMONIA_VAPOR_OFFSET} from './thermodynamics';
export {AMMONIA_MELTING,AMMONIA_ICE_OFFSET,AMMONIA_VAPOR_OFFSET} from './thermodynamics';
export const DEEP_FIELDS=[28,29,30,31,32,9,16,17] as const;
export const DEEP_SPECIES=8;
export const DEEP_CP=DEEP_FIELDS.map(f=>SPECIFIC_HEAT[f]);
export const DEEP_PHASE=DEEP_FIELDS.map(f=>MATERIAL_ENERGY[f]);
export const DEEP_MOLAR=[.002016,.004003,.017031,0,0,.018015,0,0] as const;
export const CONDENSATES=[3,4,6,7] as const;
// m²/kg, transport-adjusted shortwave scattering and grey longwave absorption.
export const CLOUD_SCATTER=[0,0,0,8,12,0,10,14] as const;
export const CLOUD_LONGWAVE=[0,0,0,12,16,0,18,22] as const;
export function saturationPressure(species:'ammonia'|'water',temperature:number){
 if(species==='water')return waterSaturationPressure(temperature,temperature<0?'ice':'water');
 const ammonia=species==='ammonia',t=temperature+273.15,ref=ammonia?194.95:273.15;
 if(t>=(ammonia?405.4:647.1))return Infinity;
 const vapor=ammonia?2:5,condensed=temperature<(ammonia?AMMONIA_MELTING:0)?vapor+2:vapor+1;
 const deltaCp=(DEEP_CP[vapor]-DEEP_CP[condensed])*1000,offset=(DEEP_PHASE[vapor]-DEEP_PHASE[condensed])*1000;
 const latentAtRef=offset+deltaCp*(ref-273.15),gasR=8.314462618/DEEP_MOLAR[vapor];
 return (ammonia?6060:611.657)*Math.exp(Math.max(-745,Math.min(700,((latentAtRef-deltaCp*ref)*(1/ref-1/t)+deltaCp*Math.log(t/ref))/gasR)));
}
export function parcelThermalEnergy(mass:ArrayLike<number>,offset:number,temperature:number){let h=0;for(let f=0;f<DEEP_SPECIES;f++)h+=mass[offset+f]*(DEEP_CP[f]*temperature+DEEP_PHASE[f]);return h;}

/** Simultaneous saturation of both vapors at conserved thermal+phase enthalpy.
 * At melting plateaus the condensate splits between liquid and ice. Dry gas
 * remains untouched, species totals remain finite, and no heat source is added. */
export function equilibrateCloudParcel(mass:Float64Array,offset:number,temperature:number,pressure:number){
 const ammonia=mass[offset+2]+mass[offset+3]+mass[offset+4],water=mass[offset+5]+mass[offset+6]+mass[offset+7];
 if(ammonia+water===0)return temperature;
 const dryMoles=mass[offset]/DEEP_MOLAR[0]+mass[offset+1]/DEEP_MOLAR[1],dryCapacity=mass[offset]*DEEP_CP[0]+mass[offset+1]*DEEP_CP[1];
 if(dryMoles<=0||dryCapacity<=0||pressure<=0)throw new Error('구름 계산에는 수소·헬륨 배경 대기가 필요합니다.');
 const target=parcelThermalEnergy(mass,offset,temperature),na=ammonia/DEEP_MOLAR[2],nw=water/DEEP_MOLAR[5];
 const partition=(t:number,freezeAmmonia=t<AMMONIA_MELTING,freezeWater=t<0)=>{
  const xa=Math.min(1,saturationPressure('ammonia',t)/pressure),xw=Math.min(1,saturationPressure('water',t)/pressure);
  let gas=dryMoles+na+nw,a=na,w=nw;
  for(let n=0;n<3;n++){const sa=na>xa*gas,sw=nw>xw*gas;gas=(dryMoles+(sa?0:na)+(sw?0:nw))/(1-(sa?xa:0)-(sw?xw:0));a=sa?xa*gas:na;w=sw?xw*gas:nw;}
  const av=Math.min(ammonia,a*DEEP_MOLAR[2]),wv=Math.min(water,w*DEEP_MOLAR[5]),ac=ammonia-av,wc=water-wv,af=freezeAmmonia?4:3,wf=freezeWater?7:6;
  const cp=dryCapacity+av*DEEP_CP[2]+ac*DEEP_CP[af]+wv*DEEP_CP[5]+wc*DEEP_CP[wf],phase=av*DEEP_PHASE[2]+ac*DEEP_PHASE[af]+wv*DEEP_PHASE[5]+wc*DEEP_PHASE[wf];
  return {av,wv,ac,wc,af,wf,cp,phase,energy:cp*t+phase};
 };
 const write=(p:ReturnType<typeof partition>,t:number)=>{mass.fill(0,offset+2,offset+8);mass[offset+2]=p.av;mass[offset+p.af]=p.ac;mass[offset+5]=p.wv;mass[offset+p.wf]=p.wc;return (target-p.phase)/p.cp;};
 const range=(ammonia*2200+water*3200)/dryCapacity+1e-7;
 for(const [melting,which] of [[AMMONIA_MELTING,0],[0,1]] as const){
  if((which===0?ammonia:water)===0||Math.abs(temperature-melting)>range)continue;
  const low=partition(melting,which===0||melting<AMMONIA_MELTING,which===1||melting<0),high=partition(melting,which!==0&&melting<AMMONIA_MELTING,which!==1&&melting<0);
  if(target>=low.energy&&target<=high.energy&&high.energy>low.energy){
   const fraction=(target-low.energy)/(high.energy-low.energy),base=which===0?2:5,total=which===0?low.ac:low.wc;
   write(low,melting);mass[offset+base+1]=total*fraction;mass[offset+base+2]=total-mass[offset+base+1];return melting;
  }
 }
 const result=solveEnthalpy(partition,target,Math.max(-250,temperature-range),Math.min(2500,temperature+range),temperature);
 return write(result.value,result.temperature);
}
