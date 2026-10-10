/** IAPWS saturation pressure above 0°C; Murphy & Koop (2005) below 0°C.
 * https://www.iapws.org/relguide/Supp-sat.html
 * https://doi.org/10.1256/qj.04.94
 * Pure-water pressures are Pa. Rates and column masses remain game quantities.
 */
export const REFERENCE_PRESSURE=101325;
export const REFERENCE_GAS_MASS=.3;
export const WATER_MOLAR_MASS=.018015;
export type WaterPhase='water'|'ice';
export function saturationPressure(temperature:number,phase:WaterPhase='water'){
 const t=Math.max(123,Math.min(647.096,temperature+273.15));
 if(phase==='ice'&&t<=273.16)return Math.exp(9.550426-5723.265/t+3.53068*Math.log(t)-.00728332*t);
 if(t<273.16){const x=.0415*(t-218.8),tanh=(Math.exp(2*x)-1)/(Math.exp(2*x)+1);return Math.exp(54.842763-6763.22/t-4.210*Math.log(t)+.000367*t+tanh*(53.878-1331.22/t-9.44523*Math.log(t)+.014025*t));}
 const v=1-t/647.096;
 return 22064000*Math.exp(647.096/t*(-7.85951783*v+1.84408259*v**1.5-11.7866497*v**3+22.6807411*v**3.5-15.9618719*v**4+1.80122502*v**7.5));
}
/** Dilute ideal dissociated NaCl approximation, explicitly not a concentrated-brine EOS. */
export function waterActivity(water:number,salt:number){return water>1e-8?1/(1+2*WATER_MOLAR_MASS/.05844*Math.max(0,salt)/water):1;}
export function columnPressure(gasMass:number,gravity=1){return Math.max(0,gasMass)*gravity/REFERENCE_GAS_MASS*REFERENCE_PRESSURE;}
/** Invert p_sat(T)*a_w. Below the triple pressure, liquid is metastable and
 * surface sublimation/evaporation handles its loss; no liquid-vapor EOS is claimed. */
export function boilingPoint(pressure:number,activity=1){
 const p=Math.max(saturationPressure(0),Math.min(saturationPressure(180),pressure/Math.max(.01,activity)));
 let lo=0,hi=180;for(let n=0;n<22;n++){const mid=(lo+hi)/2;if(saturationPressure(mid)<p)lo=mid;else hi=mid;}return (lo+hi)/2;
}
/** Hydrostatic pressure and ideal molar fractions give p_v = k v(v+d)/(v+M_v n_d).
 * Solve that expression for saturated vapor mass. Stable root avoids cold cancellation.
 * .3 game kg of N2 at 1g is the declared 1-atm reference column.
 */
export function saturationMass(temperature:number,phase:WaterPhase='water',nitrogen=.3,methane=0,co2=0,gravity=1,activity=1){
 const dry=nitrogen+methane+co2,moles=nitrogen/.028014+methane/.016043+co2/.04401;
 const e=saturationPressure(temperature,phase)*activity,k=REFERENCE_PRESSURE*gravity/REFERENCE_GAS_MASS,b=k*dry-e,c=e*WATER_MOLAR_MASS*moles,root=Math.sqrt(b*b+4*k*c);
 return b>=0?2*c/Math.max(1e-30,root+b):(root-b)/(2*k);
}
export function vaporPressure(vapor:number,nitrogen:number,methane:number,co2:number,gravity=1){
 const n=vapor/WATER_MOLAR_MASS,total=n+nitrogen/.028014+methane/.016043+co2/.04401;
 return total>0?columnPressure(vapor+nitrogen+methane+co2,gravity)*n/total:0;
}
