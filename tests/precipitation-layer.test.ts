import {describe,it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {VertexBuffer} from '@babylonjs/core/Buffers/buffer';
import {PrecipitationLayer,PRECIPITATION_COLORS} from '../src/render/precipitationLayer';

describe('precipitation observation layer',()=>{
  it('maps increasing amounts to stronger opacity independent of the step length',()=>{
    const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('planet',scene);
    const layer=new PrecipitationLayer(scene,root,new Uint32Array([0,1,2]),3);layer.setVisible(true);
    layer.update(new Float32Array([.0001,0,.001,0,0,.01]),.1);
    const mesh=scene.getMeshByName('precipitation regions')!,colors=mesh.getVerticesData(VertexBuffer.ColorKind)!.slice();
    expect(colors[3]).toBeLessThan(colors[15]);expect(colors[15]).toBeLessThan(colors[27]);
    layer.update(new Float32Array([.0004,0,.004,0,0,.04]),.4);
    const fast=mesh.getVerticesData(VertexBuffer.ColorKind)!.slice();
    for(const i of [3,15,27])expect(fast[i]).toBeCloseTo(colors[i]);
    layer.update(new Float32Array(6),0);expect(mesh.getVerticesData(VertexBuffer.ColorKind)).toEqual(fast);
    scene.dispose();engine.dispose();
  });
  it('marks only precipitating cells, distinguishes rain/snow, and leaves solver data untouched',()=>{
    const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('planet',scene);
    const layer=new PrecipitationLayer(scene,root,new Uint32Array([0,1,2,3]),4);
    const precipitation=new Float32Array([.03,0,0,.02,.01,.01,.5e-6,0]),before=precipitation.slice();
    const surface=new Float32Array(36).fill(4),surfaceBefore=surface.slice();
    layer.updateSurface(surface);layer.update(precipitation);layer.setVisible(true);
    expect(layer.stats()).toMatchObject({enabled:true,visible:true,rainCells:2,snowCells:2,highlightedCells:3});
    const mesh=scene.getMeshByName('precipitation regions')!;
    const colors=mesh.getVerticesData(VertexBuffer.ColorKind)!;
    for(let c=0;c<3;c++){
      expect(colors[c]).toBeCloseTo(PRECIPITATION_COLORS.rain[c]);
      expect(colors[12+c]).toBeCloseTo(PRECIPITATION_COLORS.snow[c]);
      expect(colors[24+c]).toBeCloseTo((PRECIPITATION_COLORS.rain[c]+PRECIPITATION_COLORS.snow[c])/2);
    }
    expect(colors[3]).toBeGreaterThan(0);expect(colors[39]).toBe(0);
    expect(mesh.isPickable).toBe(false);expect(mesh.parent).toBe(root);
    expect(mesh.getVerticesData(VertexBuffer.PositionKind)![0]).toBeCloseTo(4.004);
    expect(precipitation).toEqual(before);expect(surface).toEqual(surfaceBefore);
    scene.dispose();engine.dispose();
  });
  it('keeps the last distribution while hidden, suppresses the system view, and clears between planets',()=>{
    const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('planet',scene);
    const layer=new PrecipitationLayer(scene,root,new Uint32Array([0,1]),2);
    layer.updateSurface(new Float32Array(18).fill(4));
    layer.update(new Float32Array([.02,0,0,0]));layer.setVisible(true);
    layer.setVisible(false);layer.update(new Float32Array([0,0,0,.04]));
    expect(layer.stats().visible).toBe(false);layer.setVisible(true);
    expect(layer.stats()).toMatchObject({visible:true,rainCells:0,snowCells:1});
    layer.setInSystem(true);expect(layer.stats().visible).toBe(false);
    layer.setInSystem(false);expect(layer.stats().visible).toBe(true);
    layer.clear();expect(layer.stats()).toMatchObject({visible:false,highlightedCells:0});
    layer.setVisible(false);layer.setVisible(true);expect(layer.stats().visible).toBe(false);
    layer.update(new Float32Array(4));expect(layer.stats().visible).toBe(false);
    scene.dispose();engine.dispose();
  });
});
