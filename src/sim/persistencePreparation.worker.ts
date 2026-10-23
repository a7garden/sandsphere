import {preparePersistenceCapture,type PersistenceCapture} from './persistencePreparation';
import type {SystemSave} from './system';
let otherRevision=-1,other:SystemSave['other'];
self.onmessage=async({data}:{data:{id:number;input:PersistenceCapture}})=>{
 try{
  if(data.input.otherRevision!==otherRevision){other=data.input.other;otherRevision=data.input.otherRevision;}
  const result=await preparePersistenceCapture(data.input,other);
  (self as unknown as {postMessage(value:unknown,transfer:Transferable[]):void}).postMessage({id:data.id,result},[result.bytes.buffer]);
 }catch(error){self.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});}
};
