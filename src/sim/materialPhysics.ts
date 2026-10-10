import {columnPressure} from './waterPhysics';
// Effective game coefficients: preserve a few useful material contrasts, not SI lithology.
export const CONDUCTIVITY=[.32,.55,.18,.6,.7,1.4,.9,.9,0,.08,0,.8,1.3,.08,.08,.08,.7,1.4,.35,.25,.25,.25,12,0] as const;
export const ALBEDO=[.45,.27,.32,.12,.15,.72,.6,.6,0,0,0,.12,.38,0,0,0,0,0,.2,.18,.25,.25,.26,0] as const;
export const REFERENCE_EDGE=4.8/.024*Math.sqrt(4*Math.PI/2562);
export function edgeScale(distance:number){return (REFERENCE_EDGE/Math.max(1e-6,distance))**2;}
export function conductivity(state:Float32Array,p:number){let k=1.3,mass=1;for(let f=0;f<CONDUCTIVITY.length;f++){if(CONDUCTIVITY[f]>0){k+=state[p+f]*CONDUCTIVITY[f];mass+=state[p+f];}}return k/mass;}
export function pairConductance(a:number,b:number){return 2*a*b/Math.max(1e-8,a+b);}
export function albedo(state:Float32Array,p:number){let a=.38,mass=1;for(const f of [0,1,2,3,4,5,6,7,11,12,18,19,20,21,22]){const weight=state[p+f]*(f===4||f===5?8:1);a+=weight*ALBEDO[f];mass+=weight;}return a/mass;}
export function transmittedLight(exposure:number,sunlight:number,cloud:number,cloudIce:number){return Math.max(0,exposure*sunlight)*(1-(1-Math.exp(-(cloud+cloudIce)*3))*.65);}
/** Silica/glass has a wide softening interval; this viscosity curve is a game rule. */
export function meltMobility(temperature:number){return temperature<=1400?0:.025+.175*Math.max(0,Math.min(1,(temperature-1400)/400));}
export const GLASS_SOFTENING=1400;
export const UNSUPPORTED_PHASES=[
 {field:6,temperature:801,name:'소금',reason:'용융 소금'},
 {field:22,temperature:1538,name:'운철',reason:'금속 액상'},
 {field:12,temperature:1200,name:'암석',reason:'조성별 암석 용융'},
 {field:2,temperature:1600,name:'도자기',reason:'조성별 세라믹 용융'},
 {field:13,temperature:-146.96,name:'질소',reason:'기체 저온 응축',below:true},
 {field:14,temperature:-82.6,name:'메탄',reason:'기체 저온 응축',below:true},
 {field:15,temperature:-78.5,name:'이산화탄소',reason:'기체 저온 응축',below:true},
] as const;
export function phaseLimitNotes(state:Float32Array,p:number,gravity=1){
 const notes=UNSUPPORTED_PHASES.filter(rule=>state[p+rule.field]>.001&&('below' in rule?state[p+8]<=rule.temperature:state[p+8]>=rule.temperature)).map(rule=>`${rule.name}: ${rule.reason} 모델 범위 밖`);
 // Conservative exclusion of the subcritical CO2 liquid region, not a condensation EOS.
 const co2=state[p+15],moles=state[p+9]/.018015+state[p+13]/.028014+state[p+14]/.016043+co2/.04401;
 const partial=moles>0?columnPressure(state[p+9]+state[p+13]+state[p+14]+co2,gravity)*(co2/.04401)/moles:0;
 if(co2>.001&&state[p+8]<31&&partial>517950&&!notes.some(n=>n.startsWith('이산화탄소')))notes.push('이산화탄소: 고압 응축 모델 범위 밖');
 return notes;
}
