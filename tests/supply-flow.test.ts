import {describe,it,expect} from 'vitest';
import {deliverSurfaceSupply} from '../src/sim/supply';
import {SupplyFlow,SUPPLY_TRACE_LIMIT} from '../src/render/supplyFlow';
import {cellBrushWeights,createSphere} from '../src/sim/sphere';
import {CpuSolver,COMMAND_FIELD,COMMAND_STRIDE,DEFAULT_ENVIRONMENT,F,STRIDE,seedPlanet,totalMass} from '../src/sim/model';

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
  it('commits selected cell supplies during pause without any fall or elapsed time',()=>{
    const grid=createSphere(2),solver=new CpuSolver(grid,seedPlanet(grid,'rock',22,'none'));
    const cells=cellBrushWeights(grid,20,3),commands=new Float32Array(grid.count*COMMAND_STRIDE),before=totalMass(solver.state);
    for(const material of ['sand','water','clay','salt'] as const)deliverSurfaceSupply(cells,2.5,(i,mass)=>{commands[i*COMMAND_STRIDE+COMMAND_FIELD[material]]+=mass;});
    solver.advance(0,commands,DEFAULT_ENVIRONMENT);
    expect(totalMass(solver.state)-before).toBeCloseTo(10,5);
    for(const {index,weight} of cells)expect(solver.state[index*STRIDE+F.sand]).toBeCloseTo(2.5*weight,7);
    const outside=Array.from({length:grid.count},(_,i)=>i).find(i=>!cells.some(c=>c.index===i))!;
    expect(solver.state[outside*STRIDE+F.sand]).toBe(0);
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
