import {F,STRIDE,solidHeight,type SurfaceMaterial} from '../sim/model';
import {RADIUS,HEIGHT_SCALE,type SphereGrid} from '../sim/sphere';
export const VISUAL_HEIGHT_SCALE=HEIGHT_SCALE*2.4;
export const altitude=(height:number)=>Math.min(1.6,VISUAL_HEIGHT_SCALE*12*Math.log1p(Math.max(-11,height)/12));
export function columnGeometry(state:Float32Array,i:number,grid:SphereGrid){
  const p=i*STRIDE,solid=solidHeight(state,i,grid),retained=Math.min(state[p+F.water],Math.min(1.2,state[p+F.soil]*.12)),water=Math.max(0,state[p+F.water]-retained);
  return {base:grid.geometry[i*4+3],solid,water,retained,head:solid+state[p+F.water],
    physicalContact:RADIUS+(solid+water)*HEIGHT_SCALE,solidRadius:RADIUS+altitude(solid),waterRadius:RADIUS+altitude(solid+water)};
}
export const MATERIAL_COLORS={
  soil:[.40,.33,.22],plant:[.24,.44,.19],herbivore:[.77,.61,.38],carnivore:[.48,.30,.20],iron:[.36,.40,.43],
  rock:[.73,.75,.70],sand:[.94,.81,.57],clay:[.73,.46,.32],ceramic:[.79,.40,.23],glass:[.46,.73,.67],
  ice:[.88,.96,.97],salt:[.99,.97,.91],water:[.24,.60,.73],molten:[1,.37,.12],
} as const satisfies Record<SurfaceMaterial|'rock'|'molten',readonly number[]>;
export function columnColor(state:Float32Array,i:number,hideBedrock=false):readonly number[]{
  const p=i*STRIDE;let total=.05;const color=[.73*.05,.75*.05,.70*.05];
  for(const name of ['rock','sand','clay','ceramic','glass','salt','molten','soil','iron','ice'] as const){const mass=hideBedrock&&name==='rock'?0:state[p+F[name]],rgb=MATERIAL_COLORS[name];total+=mass;for(let c=0;c<3;c++)color[c]+=rgb[c]*mass;}
  return color.map(v=>v/total);
}
