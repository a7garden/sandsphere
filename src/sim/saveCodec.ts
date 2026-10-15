/** Lossless persistence envelope. v2 byte-shuffles Float64 data and shares
 * numeric-record keys (telemetry columns). Readers retain v1 and gzip-JSON input.
 * This transport never changes snapshot versions or quantizes model state. */
export const SAVE_RAW_LIMIT=64*1024*1024;
const MAGIC=new Uint8Array([83,65,78,68,83,86,48,50]),HEADER=16,TAG='$sandsphereFloat64',RECORD='$sandsphereNumbers';
const littleEndian=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
async function nextTurn(){const scheduler=(globalThis as typeof globalThis&{scheduler?:{yield:()=>Promise<void>}}).scheduler;if(scheduler?.yield)await scheduler.yield();else await new Promise<void>(resolve=>setTimeout(resolve,0));}
function finish<T>(steps:Generator<void,T>):T{let result=steps.next();while(!result.done)result=steps.next();return result.value;}
async function finishAsync<T>(steps:Generator<void,T>):Promise<T>{let result=steps.next();while(!result.done){await nextTurn();result=steps.next();}return result.value;}

// Keep tight byte/numeric loops outside the generator so they can be optimized.
// Cooperative callers yield between bounded chunks; the wire bytes are unchanged.
function finiteNumbers(a:ArrayLike<unknown>,from:number,to:number){for(let i=from;i<to;i++)if(typeof a[i]!=='number'||!Number.isFinite(a[i]))return false;return true;}
function shuffleLane(source:Uint8Array,target:Uint8Array,start:number,numbers:number,lane:number,from:number,to:number,inverse:boolean){
 if(inverse)for(let i=from;i<to;i++)target[i*8+lane]=source[start+lane*numbers+i];
 else for(let i=from;i<to;i++)target[start+lane*numbers+i]=source[i*8+lane];
}
function readNumbers(source:DataView,target:number[],offset:number,from:number,to:number){for(let i=from;i<to;i++)target[i]=source.getFloat64((offset+i)*8,true);}

function* packing(value:unknown,cooperative:boolean):Generator<void,ArrayBuffer> {
 const arrays:ArrayLike<number>[]=[],offsets:number[]=[],schemas:string[][]=[],schemaIds=new Map<string,number>();let numbers=0,turn=performance.now();
 const due=()=>cooperative&&performance.now()-turn>=5;
 const add=(a:ArrayLike<number>)=>{const offset=numbers;numbers+=a.length;if(numbers*8>SAVE_RAW_LIMIT)throw new Error('저장 데이터가 최대 크기(64MB)를 넘었습니다.');arrays.push(a);offsets.push(offset);return offset;};
 function* visit(v:unknown,depth:number):Generator<void,unknown> {
  if(depth>64)throw new Error('저장 데이터의 중첩이 너무 깊습니다.');
  if(Array.isArray(v)||v instanceof Float32Array||v instanceof Float64Array){
   const a=v as number[];let numeric=a.length>=16;
   if(numeric)for(let from=0;from<a.length;from+=8192){if(!finiteNumbers(a,from,Math.min(a.length,from+8192))){numeric=false;break;}if(due()){yield;turn=performance.now();}}
   if(numeric)return {[TAG]:[add(a),a.length]};
   const copy:unknown[]=[];for(const x of a)copy.push(yield* visit(x,depth+1));return copy;
  }
  if(v&&typeof v==='object'){
   const entries=Object.entries(v);
   if(entries.length>=8&&entries.every(([,x])=>x===null||typeof x==='number'&&Number.isFinite(x))){
    const keys=entries.map(([k])=>k),key=JSON.stringify(keys);let schema=schemaIds.get(key);if(schema===undefined){schema=schemas.length;schemas.push(keys);schemaIds.set(key,schema);}
    const nulls:number[]=[],a=entries.map(([,x],i)=>{if(x===null)nulls.push(i);return (x??0) as number;});return {[RECORD]:[schema,add(a),a.length,nulls]};
   }
   const copy:Array<[string,unknown]>=[];for(const [k,x] of entries){copy.push([k,yield* visit(x,depth+1)]);if(due()){yield;turn=performance.now();}}return Object.fromEntries(copy);
  }
  return v;
 }
 const data=yield* visit(value,0),metadata=encoder.encode(JSON.stringify({data,schemas})),start=HEADER+Math.ceil(metadata.length/8)*8,length=start+numbers*8;
 if(length>SAVE_RAW_LIMIT)throw new Error('저장 데이터가 최대 크기(64MB)를 넘었습니다.');
 if(due()){yield;turn=performance.now();}
 const buffer=new ArrayBuffer(length),bytes=new Uint8Array(buffer),view=new DataView(buffer);bytes.set(MAGIC);view.setUint32(8,metadata.length,true);view.setUint32(12,numbers,true);bytes.set(metadata,HEADER);
 const numeric=littleEndian?new Float64Array(buffer,start,numbers):null;
 for(let i=0;i<arrays.length;i++){if(numeric)numeric.set(arrays[i],offsets[i]);else for(let n=0;n<arrays[i].length;n++)view.setFloat64(start+(offsets[i]+n)*8,arrays[i][n],true);if(due()){yield;turn=performance.now();}}
 // Adjacent exponent/high-mantissa bytes compress together, without changing a bit.
 const original=bytes.slice(start);
 for(let lane=0;lane<8;lane++)for(let from=0;from<numbers;from+=65536){shuffleLane(original,bytes,start,numbers,lane,from,Math.min(numbers,from+65536),false);if(due()){yield;turn=performance.now();}}
 return buffer;
}
export function packSave(value:unknown){return finish(packing(value,false));}
/** Caller owns an immutable captured record, just as for asynchronous IDB. */
export function packSaveAsync(value:unknown){return finishAsync(packing(value,true));}

function* unpacking(buffer:ArrayBuffer,cooperative:boolean):Generator<void,unknown> {
 if(buffer.byteLength>SAVE_RAW_LIMIT)throw new Error('클라우드 저장본이 너무 큽니다.');
 const bytes=new Uint8Array(buffer),prefix=bytes.length>=8&&MAGIC.subarray(0,7).every((v,i)=>bytes[i]===v),version=bytes[7];
 if(!prefix||version!==49&&version!==50)return JSON.parse(decoder.decode(bytes));
 if(bytes.length<HEADER)throw new Error('저장 데이터의 이진 헤더가 올바르지 않습니다.');
 const header=new DataView(buffer),metadataLength=header.getUint32(8,true),numbers=header.getUint32(12,true),start=HEADER+Math.ceil(metadataLength/8)*8;
 if(start>bytes.length||start+numbers*8!==bytes.length)throw new Error('저장 데이터의 이진 크기가 올바르지 않습니다.');
 const metadata=JSON.parse(decoder.decode(bytes.subarray(HEADER,HEADER+metadataLength))) as unknown;
 let turn=performance.now();const due=()=>cooperative&&performance.now()-turn>=5;
 let numeric=new DataView(buffer,start);
 if(version===50){const decoded=new Uint8Array(numbers*8);for(let lane=0;lane<8;lane++)for(let from=0;from<numbers;from+=65536){shuffleLane(bytes,decoded,start,numbers,lane,from,Math.min(numbers,from+65536),true);if(due()){yield;turn=performance.now();}}numeric=new DataView(decoded.buffer);}
 const wrapper=metadata as {data:unknown;schemas:unknown},schemas=version===50?wrapper.schemas:[];
 if(version===50&&!Array.isArray(schemas))throw new Error('저장 데이터의 숫자 열 정의가 올바르지 않습니다.');
 const bounds=(offset:unknown,length:unknown)=>{if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||(offset as number)<0||(length as number)<0||(offset as number)+(length as number)>numbers)throw new Error('저장 데이터의 배열 범위가 올바르지 않습니다.');};
 function* readArray(offset:number,length:number):Generator<void,number[]>{bounds(offset,length);const a=new Array<number>(length);for(let from=0;from<length;from+=8192){readNumbers(numeric,a,offset,from,Math.min(length,from+8192));if(due()){yield;turn=performance.now();}}return a;}
 function* visit(v:unknown,depth:number):Generator<void,unknown>{
  if(depth>64)throw new Error('저장 데이터의 중첩이 너무 깊습니다.');
  if(Array.isArray(v)){const a:unknown[]=[];for(const x of v)a.push(yield* visit(x,depth+1));return a;}
  if(v&&typeof v==='object'){
   const object=v as Record<string,unknown>,keys=Object.keys(object);
   if(keys.length===1&&keys[0]===TAG){const b=object[TAG];if(!Array.isArray(b)||b.length!==2)throw new Error('저장 데이터의 배열 범위가 올바르지 않습니다.');return yield* readArray(b[0],b[1]);}
   if(version===50&&keys.length===1&&keys[0]===RECORD){
    const b=object[RECORD];if(!Array.isArray(b)||b.length!==4||!Number.isSafeInteger(b[0])||b[0]<0||!Array.isArray(schemas)||b[0]>=schemas.length)throw new Error('저장 데이터의 숫자 열 범위가 올바르지 않습니다.');
    const names=schemas[b[0]],nulls=b[3];if(!Array.isArray(names)||names.length!==b[2]||!names.every(k=>typeof k==='string')||new Set(names).size!==names.length||!Array.isArray(nulls)||!nulls.every(i=>Number.isSafeInteger(i)&&i>=0&&i<names.length))throw new Error('저장 데이터의 숫자 열 정의가 올바르지 않습니다.');
    const a=yield* readArray(b[1],b[2]),missing=new Set(nulls);return Object.fromEntries(names.map((k,i)=>[k,missing.has(i)?null:a[i]]));
   }
   const copy:Array<[string,unknown]>=[];for(const [k,x] of Object.entries(object)){copy.push([k,yield* visit(x,depth+1)]);if(due()){yield;turn=performance.now();}}return Object.fromEntries(copy);
  }
  return v;
 }
 return yield* visit(version===50?wrapper.data:metadata,0);
}
export function unpackSave(buffer:ArrayBuffer){return finish(unpacking(buffer,false));}
export function unpackSaveAsync(buffer:ArrayBuffer){return finishAsync(unpacking(buffer,true));}
