/** Compare with the last GPU submission, including Float32 bit patterns.
 * Reused staging arrays must be copied on a change, never retained by reference. */
export class VertexUploadGate {
 private buffers=new Map<string,Uint32Array|number[]>();
 private checks=0;private uploads=0;private skippedBytes=0;private uploadedBytes=0;
 changed(key:string,data:Float32Array|readonly number[]){
  const words=data instanceof Float32Array?new Uint32Array(data.buffer,data.byteOffset,data.length):data;
  const previous=this.buffers.get(key),bytes=data.length*(data instanceof Float32Array?4:8);this.checks++;
  let equal=previous?.length===words.length;
  if(equal){
   if(words instanceof Uint32Array&&previous instanceof Uint32Array){for(let i=0;i<words.length;i++)if(previous[i]!==words[i]){equal=false;break;}}
   else for(let i=0;i<words.length;i++)if(!Object.is(previous![i],words[i])){equal=false;break;}
  }
  if(equal){this.skippedBytes+=bytes;return false;}
  if(previous&&previous.length===words.length){if(previous instanceof Uint32Array)previous.set(words);else for(let i=0;i<words.length;i++)previous[i]=words[i];}
  else this.buffers.set(key,words instanceof Uint32Array?words.slice():Array.from(words));
  this.uploads++;this.uploadedBytes+=bytes;return true;
 }
 stats(){return {checks:this.checks,uploads:this.uploads,skippedBytes:this.skippedBytes,uploadedBytes:this.uploadedBytes,cacheBytes:[...this.buffers.values()].reduce((n,a)=>n+a.length*(a instanceof Uint32Array?4:8),0)};}
}
