/** Versioned transport only: decoded values retain the canonical Snapshot schema.
 * Numeric vectors use lossless IEEE bytes, transposed by byte significance before
 * gzip. This preserves carries and caches while making their common bytes cheap. */
export const SAVE_RAW_LIMIT=64*1024*1024,SAVE_COMPRESSED_LIMIT=20*1024*1024;
const MAGIC=new Uint8Array([83,65,78,68,66,73,78,1]),MARKER='$sandsphereVector1',NEGATIVE_ZERO='$sandsphereNegativeZero1';
// The transport (including zero-run bytes) stays under the existing raw budget.
// Bound the expanded IEEE vectors separately before allocating decoded arrays.
const VECTOR_LIMIT=128*1024*1024;
function zeroRuns(bytes:Uint8Array):Uint8Array<ArrayBuffer>{
 const output=new Uint8Array(bytes.length+Math.ceil(bytes.length/128)+1);let read=0,write=0;
 while(read<bytes.length){
  let zeros=0;while(zeros<128&&read+zeros<bytes.length&&bytes[read+zeros]===0)zeros++;
  if(zeros>=3){output[write++]=128|zeros-1;read+=zeros;continue;}
  const start=read;read+=Math.max(1,zeros);
  while(read<bytes.length&&read-start<128){if(bytes[read]===0&&bytes[read+1]===0&&bytes[read+2]===0)break;read++;}
  const length=read-start;output[write++]=length-1;output.set(bytes.subarray(start,read),write);write+=length;
 }return output.slice(0,write);
}
function expandZeroRuns(bytes:Uint8Array,length:number):Uint8Array<ArrayBuffer>{
 const output=new Uint8Array(length);let read=0,write=0;
 while(read<bytes.length){const code=bytes[read++],size=(code&127)+1;if(size>length-write)throw new Error('저장본의 수치 길이가 맞지 않습니다.');if(code<128){if(size>bytes.length-read)throw new Error('저장본의 수치가 잘렸습니다.');output.set(bytes.subarray(read,read+size),write);read+=size;}write+=size;}
 if(write!==length)throw new Error('저장본의 수치 길이가 맞지 않습니다.');return output;
}
const tooLarge=()=>new Error('저장 데이터가 최대 크기를 넘었습니다.');
export function packSave(value:unknown):Uint8Array<ArrayBuffer>{
 const vectors:{values:ArrayLike<number>;width:4|8}[]=[],keySets:string[][]=[],keyIndex=new Map<string,number>();let payloadLength=0;
 const vector=(values:ArrayLike<number>)=>{let width:4|8=4;for(let i=0;i<values.length;i++)if(!Object.is(Math.fround(values[i]),values[i]))width=8;payloadLength+=values.length*width;if(payloadLength>VECTOR_LIMIT)throw tooLarge();const index=vectors.length;vectors.push({values,width});return index;};
 const manifest=JSON.stringify(value,(_key,item)=>{
  if(typeof item==='number'&&Object.is(item,-0))return {[NEGATIVE_ZERO]:true};
  if((Array.isArray(item)||ArrayBuffer.isView(item))&&'length' in item&&item.length>=16){
   const values=item as number[];
   if(values.every(value=>typeof value==='number'&&Number.isFinite(value)))return {[MARKER]:vector(values)};
  }
  // Telemetry values are wide numeric records. Intern their repeated field names
  // and store their numbers exactly, keeping every sample and null observation.
  if(item&&typeof item==='object'&&!Array.isArray(item)&&!ArrayBuffer.isView(item)){
   const keys=Object.keys(item);
   if(keys.length>=16&&keys.every(key=>item[key]===null||typeof item[key]==='number'&&Number.isFinite(item[key]))){
    const signature=JSON.stringify(keys);let index=keyIndex.get(signature);if(index===undefined){index=keySets.length;keyIndex.set(signature,index);keySets.push(keys);}
    let nulls='';for(let i=0;i<keys.length;i+=4){let bits=0;for(let b=0;b<4&&i+b<keys.length;b++)if(item[keys[i+b]]===null)bits|=1<<b;nulls+=bits.toString(16);}
    return {[MARKER]:vector(keys.map(key=>item[key]??0)),keys:index,nulls};
   }
  }
  if(item&&typeof item==='object'&&(Object.hasOwn(item,MARKER)||Object.hasOwn(item,NEGATIVE_ZERO)))throw new Error('Reserved save transport key.');
  return item;
 });
 const encoded=vectors.map(({values,width})=>{
  const bytes=new Uint8Array(values.length*width),number=new DataView(new ArrayBuffer(8));
  for(let i=0;i<values.length;i++){if(width===4)number.setFloat32(0,values[i],true);else number.setFloat64(0,values[i],true);for(let b=0;b<width;b++)bytes[b*values.length+i]=number.getUint8(b);}
  const packed=zeroRuns(bytes),rle=packed.length<bytes.length;return {length:values.length,width,bytes:rle?packed:bytes,rle};
 });
 const text=new TextEncoder().encode('{"keys":'+JSON.stringify(keySets)+',"root":'+manifest+'}'),header=16+vectors.length*12,total=header+text.length+encoded.reduce((sum,vector)=>sum+vector.bytes.length,0);
 if(total>SAVE_RAW_LIMIT)throw tooLarge();
 const bytes=new Uint8Array(total),view=new DataView(bytes.buffer);bytes.set(MAGIC);view.setUint32(8,text.length,true);view.setUint32(12,vectors.length,true);
 bytes.set(text,header);let offset=header+text.length;
 encoded.forEach((vector,index)=>{
  view.setUint32(16+index*12,vector.length,true);view.setUint32(20+index*12,vector.width|(vector.rle?256:0),true);view.setUint32(24+index*12,vector.bytes.length,true);
  bytes.set(vector.bytes,offset);offset+=vector.bytes.length;
 });
 return bytes;
}
export function unpackSave(bytes:Uint8Array):unknown{
 if(bytes.length>SAVE_RAW_LIMIT)throw tooLarge();
 if(!MAGIC.every((b,i)=>bytes[i]===b))return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(bytes.length<16)throw new Error('저장본의 헤더가 손상되었습니다.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),textLength=view.getUint32(8,true),count=view.getUint32(12,true),header=16+count*12;
 if(header>bytes.length||textLength>bytes.length-header)throw new Error('저장본의 크기가 맞지 않습니다.');
 let offset=header+textLength,expanded=0;const vectors:number[][]=[];
 for(let index=0;index<count;index++){
  const length=view.getUint32(16+index*12,true),format=view.getUint32(20+index*12,true),width=format&255,size=view.getUint32(24+index*12,true);expanded+=length*width;
  if((width!==4&&width!==8)||format!==width&&format!==(width|256)||length<16||expanded>VECTOR_LIMIT||size>bytes.length-offset||format===width&&size!==length*width)throw new Error('저장본의 수치 배열이 손상되었습니다.');
  const source=format===width?bytes.subarray(offset,offset+size):expandZeroRuns(bytes.subarray(offset,offset+size),length*width);
  const values=new Array<number>(length),number=new DataView(new ArrayBuffer(8));
  for(let i=0;i<length;i++){for(let b=0;b<width;b++)number.setUint8(b,source[b*length+i]);const value=width===4?number.getFloat32(0,true):number.getFloat64(0,true);if(!Number.isFinite(value))throw new Error('저장본에 잘못된 수치가 있습니다.');values[i]=value;}
  vectors.push(values);offset+=size;
 }
 if(offset!==bytes.length)throw new Error('저장본의 끝이 맞지 않습니다.');
 const used=new Set<number>();
 const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(header,header+textLength))) as {keys:unknown;root:unknown};
 if(!Array.isArray(manifest.keys)||manifest.keys.some(keys=>!Array.isArray(keys)||keys.length<16||keys.some(key=>typeof key!=='string')||new Set(keys).size!==keys.length))throw new Error('저장본의 수치 필드가 손상되었습니다.');
 const keys=manifest.keys as string[][];
 const revive=(item:unknown):unknown=>{
  if(!item||typeof item!=='object')return item;
  const record=item as Record<string,unknown>;
  if(Object.hasOwn(record,NEGATIVE_ZERO)){if(Object.keys(record).length!==1||record[NEGATIVE_ZERO]!==true)throw new Error('저장본의 수치가 손상되었습니다.');return -0;}
  if(Object.hasOwn(record,MARKER)){
   const index=record[MARKER];if(typeof index!=='number'||!Number.isInteger(index)||index<0||index>=vectors.length||used.has(index))throw new Error('저장본의 배열 참조가 손상되었습니다.');used.add(index);
   const values=vectors[index];if(Object.keys(record).length===1)return values;
   const key=record.keys,nulls=record.nulls;
   if(Object.keys(record).length!==3||typeof key!=='number'||!Number.isInteger(key)||!keys[key]||keys[key].length!==values.length||typeof nulls!=='string'||nulls.length!==Math.ceil(values.length/4)||!/^[0-9a-f]+$/.test(nulls))throw new Error('저장본의 관측 필드가 손상되었습니다.');
   return Object.fromEntries(keys[key].map((name,i)=>[name,parseInt(nulls[Math.floor(i/4)],16)&1<<(i%4)?null:values[i]]));
  }
  for(const key of Object.keys(record))record[key]=revive(record[key]);return item;
 };
 const value=revive(manifest.root);
 if(used.size!==vectors.length)throw new Error('저장본에 사용하지 않은 수치 배열이 있습니다.');return value;
}
export async function encodeSaveBytes(value:unknown):Promise<Uint8Array<ArrayBuffer>>{
 const bytes=packSave(value),compressed=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 if(compressed.length>SAVE_COMPRESSED_LIMIT)throw new Error('압축한 저장 데이터가 최대 크기(20MB)를 넘었습니다.');return compressed;
}
export async function decodeSaveBytes(bytes:Uint8Array<ArrayBuffer>):Promise<unknown>{
 if(bytes.length>SAVE_COMPRESSED_LIMIT)throw tooLarge();
 const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>SAVE_RAW_LIMIT){await reader.cancel();throw tooLarge();}chunks.push(next.value);}}finally{reader.releaseLock();}
 const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}return unpackSave(raw);
}
