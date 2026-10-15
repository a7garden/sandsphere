import {firebaseConfigured} from './config';
import {initializeApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,type Auth} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,getDocFromServer,runTransaction,writeBatch,Bytes,type Firestore} from 'firebase/firestore';
import {getStorage,connectStorageEmulator,ref,getBytes,type FirebaseStorage} from 'firebase/storage';
import {validSystem,type SystemSave} from '../sim/system';
import {packSaveAsync,unpackSaveAsync,SAVE_RAW_LIMIT} from '../sim/saveCodec';
import {validateSystemSaveAsync} from '../sim/savePreparation';
import {SaveConflict,type RemoteSave} from './sync';

export interface FirebaseServices {auth:Auth;db:Firestore;storage:FirebaseStorage|null;}
let services:FirebaseServices|null=null;
export function firebaseServices(){
  if(services)return services;
  const e=import.meta.env;
  if(!firebaseConfigured(e))return null;
  const app=initializeApp({apiKey:e.VITE_FIREBASE_API_KEY,authDomain:e.VITE_FIREBASE_AUTH_DOMAIN,
    projectId:e.VITE_FIREBASE_PROJECT_ID,storageBucket:e.VITE_FIREBASE_STORAGE_BUCKET,appId:e.VITE_FIREBASE_APP_ID});
  services={auth:getAuth(app),db:getFirestore(app),storage:e.VITE_FIREBASE_STORAGE_BUCKET?getStorage(app):null};
  if(import.meta.env.DEV&&e.VITE_FIREBASE_EMULATORS==='1'){
    connectAuthEmulator(services.auth,'http://127.0.0.1:9099',{disableWarnings:true});
    connectFirestoreEmulator(services.db,'127.0.0.1',8085);
    if(services.storage)connectStorageEmulator(services.storage,'127.0.0.1',9199);
  }
  return services;
}
const RAW_LIMIT=SAVE_RAW_LIMIT,COMPRESSED_LIMIT=20*1024*1024;
export async function encodeSave(system:SystemSave){
  const bytes=await packSaveAsync(system);
  if(bytes.byteLength>RAW_LIMIT)throw new Error('저장 데이터가 최대 크기(64MB)를 넘었습니다.');
  const blob=await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  if(blob.size>COMPRESSED_LIMIT)throw new Error('압축한 저장 데이터가 최대 크기(20MB)를 넘었습니다.');
  return blob;
}
export async function decodeSave(bytes:ArrayBuffer,count:number):Promise<SystemSave>{
  if(bytes.byteLength>COMPRESSED_LIMIT)throw new Error('클라우드 저장본이 너무 큽니다.');
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>RAW_LIMIT){await reader.cancel();throw new Error('클라우드 저장본이 너무 큽니다.');}chunks.push(new Uint8Array(next.value));}}
  finally{reader.releaseLock();}
  const value=await unpackSaveAsync(await new Blob(chunks).arrayBuffer());
  if(!validSystem(value,count)||value.telemetry?.baseSavedAt!==undefined)throw new Error('클라우드 저장본의 형식이 맞지 않습니다.');
  return value;
}
const PART_SIZE=512*1024,PARTS_PER_BATCH=8;
interface RevisionInfo {revision:string;parts:number;bytes:number;}
function validRevision(value:unknown):value is RevisionInfo {
  const v=value as RevisionInfo|undefined;
  return !!v&&typeof v.revision==='string'&&/^[\w-]{1,80}$/.test(v.revision)
    &&Number.isInteger(v.parts)&&v.parts>0&&v.parts<=40
    &&Number.isInteger(v.bytes)&&v.bytes>0&&v.bytes<=COMPRESSED_LIMIT&&v.parts===Math.ceil(v.bytes/PART_SIZE);
}
async function serverRead<T>(operation:Promise<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  return Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('클라우드 연결 시간이 초과되었습니다.')),12000);})]).finally(()=>clearTimeout(timer));
}
/** Private immutable chunks and a transactional pointer preserve two complete revisions. */
export class FirebaseSaveStore {
  constructor(private services:FirebaseServices,readonly uid:string,private count:number){}
  private manifest(){return doc(this.services.db,'users',this.uid,'saves','current');}
  private part(revision:string,index:number){return doc(this.services.db,'users',this.uid,'revisions',revision,'parts',String(index).padStart(2,'0'));}
  private assertOwner(){if(this.services.auth.currentUser?.uid!==this.uid)throw new Error('계정이 변경되었습니다. 다시 로그인하세요.');}
  async read():Promise<RemoteSave|null>{return this.readCurrent(0);}
  private async readCurrent(attempt:number):Promise<RemoteSave|null>{
    this.assertOwner();
    const value=await serverRead(getDocFromServer(this.manifest()));
    if(!value.exists())return null;
    const data=value.data();
    let bytes:ArrayBuffer;
    if(data.format===1&&this.services.storage&&typeof data.revision==='string'&&/^[\w-]{1,80}$/.test(data.revision)){
      bytes=await getBytes(ref(this.services.storage,`users/${this.uid}/saves/${data.revision}.json.gz`),COMPRESSED_LIMIT);
    }else{
      if(data.format!==2||!validRevision(data))throw new Error('클라우드 저장 정보를 읽지 못했습니다.');
      try{bytes=await this.readParts(data);}
      catch(error){
        // A second device may commit twice while this download is in flight.
        // Follow its new pointer once instead of treating pruned chunks as loss.
        const latest=attempt===0?await serverRead(getDocFromServer(this.manifest())):null;
        if(latest?.exists()&&latest.data().revision!==data.revision)return this.readCurrent(1);
        throw error;
      }
    }
    const system=await decodeSave(bytes,this.count);
    this.assertOwner();return {revision:data.revision,system};
  }
  private async readParts(data:RevisionInfo):Promise<ArrayBuffer>{
      const buffer=new Uint8Array(data.bytes);
      // Bounded parallel reads avoid a large burst against the free project quota.
      for(let start=0;start<data.parts;start+=PARTS_PER_BATCH){
        const parts=await Promise.all(Array.from({length:Math.min(PARTS_PER_BATCH,data.parts-start)},async(_,offset)=>{
          const index=start+offset,snapshot=await serverRead(getDocFromServer(this.part(data.revision,index)));
          const part=snapshot.data()?.bytes;
          if(!(part instanceof Bytes))throw new Error('클라우드 저장본의 일부를 읽지 못했습니다. 다시 불러오세요.');
          const chunk=part.toUint8Array(),expected=Math.min(PART_SIZE,data.bytes-index*PART_SIZE);
          if(chunk.length!==expected)throw new Error('클라우드 저장본의 크기가 맞지 않습니다.');
          return {index,chunk};
        }));
        for(const {index,chunk} of parts)buffer.set(chunk,index*PART_SIZE);
      }
      return buffer.buffer;
  }
  async write(system:SystemSave,expectedRevision:string|null):Promise<string>{
    this.assertOwner();await validateSystemSaveAsync(system,this.count);if(system.telemetry?.baseSavedAt!==undefined)throw new Error('완전한 저장본만 업로드할 수 있습니다.');
    const revision=crypto.randomUUID(),bytes=new Uint8Array(await (await encodeSave(system)).arrayBuffer());this.assertOwner();
    const info:RevisionInfo={revision,parts:Math.ceil(bytes.length/PART_SIZE),bytes:bytes.length};
    let prune:RevisionInfo|null=null;
    try{
      for(let start=0;start<info.parts;start+=PARTS_PER_BATCH){
        this.assertOwner();const batch=writeBatch(this.services.db);
        for(let index=start;index<Math.min(start+PARTS_PER_BATCH,info.parts);index++)batch.set(this.part(revision,index),{bytes:Bytes.fromUint8Array(bytes.slice(index*PART_SIZE,(index+1)*PART_SIZE))});
        await batch.commit();
      }
      prune=await runTransaction(this.services.db,async tx=>{
        this.assertOwner();const current=await tx.get(this.manifest()),data=current.data();
        if((current.exists()?data?.revision:null)!==expectedRevision)throw new SaveConflict();
        const previous=validRevision(data)?{revision:data.revision,parts:data.parts,bytes:data.bytes}:null;
        tx.set(this.manifest(),{...info,format:2,savedAt:system.savedAt,previous});
        return validRevision(data?.previous)?data.previous:null;
      });
    }catch(error){
      // Rules forbid deleting the current/previous revision, including an
      // ambiguously acknowledged commit. Cleanup never decides save ownership.
      await this.remove(info).catch(()=>{});throw error;
    }
    // Keep current and one preceding revision. Cleanup failure does not turn a
    // committed save into a reported failure or discard the local checkpoint.
    if(prune)await this.remove(prune).catch(()=>{});
    return revision;
  }
  private async remove(info:RevisionInfo){
    this.assertOwner();const batch=writeBatch(this.services.db);
    for(let index=0;index<info.parts;index++)batch.delete(this.part(info.revision,index));
    await batch.commit();
  }
}
