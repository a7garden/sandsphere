import {describe,it,expect} from 'vitest';
import {deliverSurfaceSupply} from '../src/sim/supply';
import {SupplyPulse,SUPPLY_PULSE_LIFE,supplyPulseCoordinates} from '../src/render/supplyPulse';
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
  it('bounds pulse memory by cells and replaces repeated strokes without a CPU fade scan',()=>{
    const grid=createSphere(4),cells=cellBrushWeights(grid,0,12),pulse=new SupplyPulse(grid.count),pixels=pulse.pixels;
    for(let n=0;n<10000;n++)pulse.emit(cells,[1,.5,.2],1);
    expect(pulse.pixels).toBe(pixels);expect(pixels.byteLength).toBeLessThan(43000);
    expect(pulse.activeCells()).toBe(cells.length);
    pulse.dirty=false;const before=pixels.slice();pulse.advance(SUPPLY_PULSE_LIFE+.01);
    expect(pulse.active).toBe(false);expect(pulse.activeCells()).toBe(0);expect(pulse.dirty).toBe(false);expect(pixels).toEqual(before);
    pulse.clear();expect(pulse.active).toBe(false);expect(pixels.every(v=>v===0)).toBe(true);
  });
  it('colors only valid supplied cells, scales with amount, and resets on material replacement',()=>{
    const pulse=new SupplyPulse(6),cells=[{index:2,weight:1},{index:3,weight:0},{index:7,weight:1},{index:-1,weight:1}];
    for(const invalid of [0,-1,NaN,Infinity])pulse.emit(cells,[1,.5,.2],invalid);
    expect(pulse.dirty).toBe(false);expect(pulse.activeCells()).toBe(0);
    pulse.emit(cells,[1,.5,.2],.001);const small=pulse.pixels[8];expect(pulse.activeCells()).toBe(1);
    pulse.advance(.1);pulse.emit(cells,[1,.5,.2],10);expect(pulse.pixels[8]).toBeGreaterThan(small);expect(pulse.pixels[11]).toBeCloseTo(.1);
    pulse.emit(cells,[.1,.5,1],10);expect(pulse.pixels[8]).toBeLessThan(pulse.pixels[10]);
    expect(pulse.pixels.slice(0,8).every(v=>v===0)).toBe(true);
  });
  it('assigns every land/water fan to its texel and outlines only its outer polygon edge',()=>{
    const pulse=new SupplyPulse(130),owners=new Uint32Array([0,64,129]);
    for(const water of [false,true]){
      const coords=supplyPulseCoordinates(owners,pulse,water),count=water?6:3;
      owners.forEach((owner,face)=>{for(let k=0;k<count;k++){
        const p=(face*count+k)*3;
        expect(coords[p]).toBeCloseTo((owner%64+.5)/64);expect(coords[p+1]).toBeCloseTo((Math.floor(owner/64)+.5)/3);
        expect(coords[p+2]).toBe(k===0?1:0);
      }});
    }
  });
});
