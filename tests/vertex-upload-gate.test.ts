import {it,expect} from 'vitest';
import {VertexUploadGate} from '../src/render/vertexUploadGate';
it('compares the last submission rather than a mutable staging-array reference',()=>{
 const gate=new VertexUploadGate(),positions=new Float32Array([1,2,3]),colors=new Float32Array([1,1,1,1]);
 expect(gate.changed('positions',positions)).toBe(true);expect(gate.changed('colors',colors)).toBe(true);
 expect(gate.changed('positions',positions)).toBe(false);colors[2]=.5;
 expect(gate.changed('positions',positions)).toBe(false);expect(gate.changed('colors',colors)).toBe(true);
 expect(gate.stats()).toMatchObject({uploads:3,cacheBytes:28,skippedBytes:24});
});
it('preserves signed zero and distinct Float32 NaN payloads exactly',()=>{
 const gate=new VertexUploadGate(),data=new Float32Array(2),bits=new Uint32Array(data.buffer);
 gate.changed('data',data);data[0]=-0;expect(gate.changed('data',data)).toBe(true);
 bits[1]=0x7fc00001;expect(gate.changed('data',data)).toBe(true);bits[1]=0x7fc00002;expect(gate.changed('data',data)).toBe(true);
 expect(gate.changed('data',data)).toBe(false);
});
it('rebuilds a disappearing and reappearing coast with the same prior topology',()=>{
 const gate=new VertexUploadGate();expect(gate.changed('indices',[0,1,2])).toBe(true);
 expect(gate.changed('indices',[0,1,2])).toBe(false);expect(gate.changed('indices',[])).toBe(true);
 expect(gate.changed('indices',[0,1,2])).toBe(true);expect(gate.changed('positions',[1,2,3])).toBe(true);
 expect(gate.changed('positions',[1,2,3.00000001])).toBe(true);
});
