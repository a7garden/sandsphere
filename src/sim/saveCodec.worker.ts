import {encodeSaveBytes,decodeSaveBytes} from './saveCodec';
self.onmessage=async({data}:{data:{id:number;operation:'encode'|'decode';value:unknown}})=>{
 try{const value=data.operation==='encode'?await encodeSaveBytes(data.value):await decodeSaveBytes(data.value as Uint8Array<ArrayBuffer>);(self as unknown as {postMessage(value:unknown,transfer:Transferable[]):void}).postMessage({id:data.id,value},data.operation==='encode'?[(value as Uint8Array<ArrayBuffer>).buffer]:[]);}
 catch(error){self.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});}
};
