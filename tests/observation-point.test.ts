import {describe,it,expect} from 'vitest';
import {ObservationPoint} from '../src/ui/observationPoint';

describe('pinned observation',()=>{
  it('keeps the same cell through hovering, painting, and moving the pin',()=>{
    const point=new ObservationPoint();point.switchPlanet('a',12);
    point.hover(21);expect(point.cell).toBe(21);
    point.selecting=true;point.hover(33);expect(point.cell).toBe(21);
    point.pin(42);point.hover(55);
    expect(point.cell).toBe(42);expect(point.pinned).toBe(true);expect(point.selecting).toBe(false);
    point.selecting=true;point.hover(61);expect(point.cell).toBe(42);
    point.pin(75);expect(point.cell).toBe(75);
    point.clear();point.hover(55);expect(point.cell).toBe(55);expect(point.pinned).toBe(false);
  });
  it('keeps each pin attached to its planet and cancels pending placement on switching',()=>{
    const point=new ObservationPoint();point.switchPlanet('a');point.pin(42);point.selecting=true;
    point.switchPlanet('b',12);expect(point.cell).toBe(12);expect(point.pinned).toBe(false);expect(point.selecting).toBe(false);
    point.pin(8);point.switchPlanet('a');expect(point.cell).toBe(42);expect(point.pinned).toBe(true);
    point.clear();point.switchPlanet('b');expect(point.cell).toBe(8);expect(point.pinned).toBe(true);
    point.switchPlanet('a',4);expect(point.cell).toBe(4);expect(point.pinned).toBe(false);
  });
});
