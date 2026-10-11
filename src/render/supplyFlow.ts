import type {SurfaceMaterial} from '../sim/model';
import type {SupplyCell} from '../sim/supply';
export const SUPPLY_TRACE_LIMIT=48;
const LIFE=.28;
export interface SupplyTrace {index:number;material:SurfaceMaterial;age:number;phase:number;}
/** Cosmetic delivery cues: bounded independently of brush size, rate and gravity. */
export class SupplyFlow {
  readonly traces:SupplyTrace[]=[];
  private cursor=0;
  emit(cells:readonly SupplyCell[],material:SurfaceMaterial){
    const count=Math.min(6,cells.length);if(!count)return;
    for(let n=0;n<count;n++){
      const sample=Math.floor((n+.5)*cells.length/count),index=cells[sample].index;
      const slot=this.cursor++%SUPPLY_TRACE_LIMIT;
      if(slot===this.traces.length)this.traces.push({index,material,age:0,phase:0});
      const trace=this.traces[slot];trace.index=index;trace.material=material;trace.age=0;trace.phase=(this.cursor%7)/7;
    }
  }
  animate(dt:number){for(const trace of this.traces)trace.age=Math.min(LIFE,trace.age+Math.max(0,dt));}
  progress(trace:SupplyTrace){return trace.age/LIFE;}
  active(trace:SupplyTrace){return trace.age<LIFE;}
  clear(){this.traces.length=0;this.cursor=0;}
}
