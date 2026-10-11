import {describe,it,expect} from 'vitest';
import {deliverSurfaceSupply} from '../src/sim/supply';
import {SupplyFlow,SUPPLY_TRACE_LIMIT} from '../src/render/supplyFlow';
import {cellBrushWeights,createSphere} from '../src/sim/sphere';

describe('surface supply without physical dust',()=>{
  it('delivers every brush share immediately and exactly once at any brush size',()=>{
    const grid=createSphere(4);
    for(const rings of [0,1,5,12]){
      const cells=cellBrushWeights(grid,100,rings),deposits=new Map<number,number>();
      deliverSurfaceSupply(cells,19.5,(cell,mass)=>{expect(deposits.has(cell)).toBe(false);deposits.set(cell,mass);});
      expect([...deposits.keys()]).toEqual(cells.map(c=>c.index));
      expect([...deposits.values()].reduce((a,b)=>a+b,0)).toBeCloseTo(19.5,10);
    }
  });
  it('does not create zero, negative or invalid transfers',()=>{
    for(const amount of [0,-1,NaN,Infinity])deliverSurfaceSupply([{index:0,weight:1}],amount,()=>{throw Error('invalid delivery');});
  });
  it('bounds cosmetic cues even when thousands of paused strokes accumulate',()=>{
    const cells=cellBrushWeights(createSphere(4),0,12),flow=new SupplyFlow();
    for(let n=0;n<10000;n++)flow.emit(cells,n%2?'sand':'water');
    expect(flow.traces).toHaveLength(SUPPLY_TRACE_LIMIT);
    expect(flow.traces.every(t=>cells.some(c=>c.index===t.index))).toBe(true);
    flow.animate(0);expect(flow.traces.every(t=>flow.active(t))).toBe(true);
    flow.animate(.3);expect(flow.traces.some(t=>flow.active(t))).toBe(false);
    flow.clear();flow.emit([{index:5,weight:1}],'soil');expect(flow.traces).toHaveLength(1);expect(flow.traces[0].index).toBe(5);
  });
});
