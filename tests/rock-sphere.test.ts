import {describe,expect,it} from 'vitest';
import {F,STRIDE,enthalpy,seedPlanet,solidHeight,spherizeLegacyRockPlanet,type Snapshot} from '../src/sim/model';
import {createSphere} from '../src/sim/sphere';

describe('spherical bedrock',()=>{
  it('keeps a rock planet level without changing its total rock stock',()=>{
    const grid=createSphere(3),state=seedPlanet(grid,'rock',18);
    const level=solidHeight(state,0,grid);
    let mass=0;
    for(let i=0;i<grid.count;i++){
      expect(solidHeight(state,i,grid)).toBeCloseTo(level,5);
      mass+=state[i*STRIDE+F.rock];
    }
    expect(mass).toBeCloseTo(grid.count*8,3);
  });

  it('corrects an untouched legacy rock planet and preserves edited terrain',()=>{
    const grid=createSphere(2),state=seedPlanet(grid,'rock',18);
    for(let i=0;i<grid.count;i++)state[i*STRIDE+F.rock]=8;
    const snapshot={planet:{primary:'rock'},state:[...state]} as Snapshot;
    const heat=Array.from({length:grid.count},(_,i)=>enthalpy(state,i));
    expect(spherizeLegacyRockPlanet(snapshot,grid)).toBe(true);
    const corrected=new Float32Array(snapshot.state),level=solidHeight(corrected,0,grid);
    for(let i=0;i<grid.count;i++){
      expect(solidHeight(corrected,i,grid)).toBeCloseTo(level,5);
      expect(enthalpy(corrected,i)).toBeCloseTo(heat[i],2);
    }
    expect(spherizeLegacyRockPlanet(snapshot,grid)).toBe(false);
    snapshot.state=[...state];snapshot.state[F.sand]=1;
    expect(spherizeLegacyRockPlanet(snapshot,grid)).toBe(false);
    expect(snapshot.state[F.rock]).toBe(8);
  });
});
