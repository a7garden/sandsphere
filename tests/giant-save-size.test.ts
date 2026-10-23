import {it,expect} from 'vitest';
import {createSphere} from '../src/sim/sphere';
import {createJupiterPlanet,createSaturnPlanet} from '../src/sim/planetCreation';
import {emptyStock,type Snapshot} from '../src/sim/model';
import {prepareSystemSave,type SystemSave} from '../src/sim/system';
import {encodeSave,decodeSave} from '../src/account/firebase';

it('round-trips eight full-resolution giants across both modes within the existing compressed-save limits',async()=>{
 const grid=createSphere(4),presets=[createJupiterPlanet(grid),createSaturnPlanet(grid)];
 const planets=Array.from({length:4},(_,i)=>{const p=presets[i%2],snapshot:Snapshot={version:8,preset:'coast',state:[...p.state],climate:structuredClone(p.climate),environment:p.environment,spin:p.spin,time:0,supplied:0,removed:0,discoveries:[]};return {id:'planet-'+i,name:'Giant '+i,snapshot};});
 const world={activeId:'planet-0',planets,stock:emptyStock()},system=prepareSystemSave({version:3,mode:'sandbox',...world,other:structuredClone(world),savedAt:1} as SystemSave,grid.count),raw=new TextEncoder().encode(JSON.stringify(system)).byteLength;
 const encoded=await encodeSave(system),decoded=await decodeSave(await encoded.arrayBuffer(),grid.count);console.log('full-resolution giant save size',{cells:grid.count,planets:8,rawBytes:raw,gzipBytes:encoded.size});
 // JSON represents both signs of numeric zero as 0; compare the persisted
 // representation, including every layer, rather than Object.is(-0, 0).
 expect(raw).toBeLessThan(64*1024*1024);expect(encoded.size).toBeLessThan(20*1024*1024);expect(JSON.stringify(decoded)).toBe(JSON.stringify(system));
},60000);
