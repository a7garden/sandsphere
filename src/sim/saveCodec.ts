/** Lossless numeric payload for persistence. Snapshot/schema versions stay unchanged.
 * The gzip transport still accepts legacy JSON. Every packed number is IEEE-754
 * Float64; caches, inventories and restart state are preserved without quantizing. */
export const SAVE_RAW_LIMIT=64*1024*1024;
const MAGIC=new Uint8Array([83,65,78,68,83,86,48,49]),HEADER=16,TAG='$sandsphereFloat64';
const littleEndian=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});

export function packSave(value:unknown):ArrayBuffer {
 const arrays:ArrayLike<number>[]=[],offsets:number[]=[];let numbers=0;
 const visit=(v:unknown,depth:number):unknown=>{
  if(depth>64)throw new Error('저장 데이터의 중첩이 너무 깊습니다.');
  const numeric=Array.isArray(v)||v instanceof Float32Array||v instanceof Float64Array;
  if(numeric){
   const a=v as number[];
   if(a.length>=32&&a.every(x=>typeof x==='number'&&Number.isFinite(x))){
    const start=numbers;numbers+=a.length;if(numbers*8>SAVE_RAW_LIMIT)throw new Error('저장 데이터가 최대 크기(64MB)를 넘었습니다.');
    arrays.push(a);offsets.push(start);return {[TAG]:[start,a.length]};
   }
   return Array.from(a,x=>visit(x,depth+1));
  }
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x,depth+1)]));
  return v;
 };
 const metadata=encoder.encode(JSON.stringify(visit(value,0))),start=HEADER+Math.ceil(metadata.length/8)*8,length=start+numbers*8;
 if(length>SAVE_RAW_LIMIT)throw new Error('저장 데이터가 최대 크기(64MB)를 넘었습니다.');
 const buffer=new ArrayBuffer(length),bytes=new Uint8Array(buffer),view=new DataView(buffer);
 bytes.set(MAGIC);view.setUint32(8,metadata.length,true);view.setUint32(12,numbers,true);bytes.set(metadata,HEADER);
 if(littleEndian){const data=new Float64Array(buffer,start,numbers);for(let i=0;i<arrays.length;i++)data.set(arrays[i],offsets[i]);}
 else for(let i=0;i<arrays.length;i++)for(let n=0;n<arrays[i].length;n++)view.setFloat64(start+(offsets[i]+n)*8,arrays[i][n],true);
 return buffer;
}

export function unpackSave(buffer:ArrayBuffer):unknown {
 if(buffer.byteLength>SAVE_RAW_LIMIT)throw new Error('클라우드 저장본이 너무 큽니다.');
 const bytes=new Uint8Array(buffer);
 if(bytes.length<MAGIC.length||!MAGIC.every((v,i)=>bytes[i]===v))return JSON.parse(decoder.decode(bytes));
 if(bytes.length<HEADER)throw new Error('저장 데이터의 이진 헤더가 올바르지 않습니다.');
 const view=new DataView(buffer),metadataLength=view.getUint32(8,true),numbers=view.getUint32(12,true),start=HEADER+Math.ceil(metadataLength/8)*8;
 if(start>bytes.length||start+numbers*8!==bytes.length)throw new Error('저장 데이터의 이진 크기가 올바르지 않습니다.');
 const metadata:unknown=JSON.parse(decoder.decode(bytes.subarray(HEADER,HEADER+metadataLength)));
 const visit=(v:unknown,depth:number):unknown=>{
  if(depth>64)throw new Error('저장 데이터의 중첩이 너무 깊습니다.');
  if(Array.isArray(v))return v.map(x=>visit(x,depth+1));
  if(v&&typeof v==='object'){
   const object=v as Record<string,unknown>,keys=Object.keys(object);
   if(keys.length===1&&keys[0]===TAG){
    const bounds=object[TAG];if(!Array.isArray(bounds)||bounds.length!==2)throw new Error('저장 데이터의 배열 범위가 올바르지 않습니다.');
    const [offset,length]=bounds as number[];
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0||offset+length>numbers)throw new Error('저장 데이터의 배열 범위가 올바르지 않습니다.');
    const a=new Array<number>(length);for(let i=0;i<length;i++)a[i]=view.getFloat64(start+(offset+i)*8,true);return a;
   }
   return Object.fromEntries(Object.entries(object).map(([k,x])=>[k,visit(x,depth+1)]));
  }
  return v;
 };
 return visit(metadata,0);
}
