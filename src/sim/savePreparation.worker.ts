import {prepareSystemSave,validSystem,type SystemSave} from './system';
import {packSave,unpackSave} from './saveCodec';
const scope=self as unknown as {onmessage:((event:MessageEvent<{id:number;action:'prepare'|'validate';count:number;payload:ArrayBuffer}>)=>void)|null;postMessage:(message:unknown,transfer?:Transferable[])=>void;};
scope.onmessage=({data})=>{
 try{
  const system=unpackSave(data.payload) as SystemSave;
  if(data.action==='prepare'){const payload=packSave(prepareSystemSave(system,data.count));scope.postMessage({id:data.id,payload},[payload]);}
  else{if(!validSystem(system,data.count))throw new Error('완전한 저장본만 업로드할 수 있습니다.');scope.postMessage({id:data.id});}
 }catch(error){scope.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});}
};
