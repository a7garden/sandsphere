import {initializeApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,type Auth} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,getDocFromServer,runTransaction,type Firestore} from 'firebase/firestore';
import {getStorage,connectStorageEmulator,ref,getBytes,uploadBytes,type FirebaseStorage} from 'firebase/storage';
import {validSystem,type SystemSave} from '../sim/system';
import {SaveConflict,type RemoteSave} from './sync';

export interface FirebaseServices {auth:Auth;db:Firestore;storage:FirebaseStorage;}
let services:FirebaseServices|null=null;
export function firebaseServices(){
  if(services)return services;
  const e=import.meta.env;
  if(!e.VITE_FIREBASE_API_KEY||!e.VITE_FIREBASE_AUTH_DOMAIN||!e.VITE_FIREBASE_PROJECT_ID||!e.VITE_FIREBASE_STORAGE_BUCKET||!e.VITE_FIREBASE_APP_ID)return null;
  const app=initializeApp({apiKey:e.VITE_FIREBASE_API_KEY,authDomain:e.VITE_FIREBASE_AUTH_DOMAIN,
    projectId:e.VITE_FIREBASE_PROJECT_ID,storageBucket:e.VITE_FIREBASE_STORAGE_BUCKET,appId:e.VITE_FIREBASE_APP_ID});
  services={auth:getAuth(app),db:getFirestore(app),storage:getStorage(app)};
  if(import.meta.env.DEV&&e.VITE_FIREBASE_EMULATORS==='1'){
    connectAuthEmulator(services.auth,'http://127.0.0.1:9099',{disableWarnings:true});
    connectFirestoreEmulator(services.db,'127.0.0.1',8085);
    connectStorageEmulator(services.storage,'127.0.0.1',9199);
  }
  return services;
}
const RAW_LIMIT=64*1024*1024,COMPRESSED_LIMIT=20*1024*1024;
export async function encodeSave(system:SystemSave){
  const bytes=new TextEncoder().encode(JSON.stringify(system));
  if(bytes.length>RAW_LIMIT)throw new Error('저장 데이터가 최대 크기(64MB)를 넘었습니다.');
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
  const value:unknown=JSON.parse(await new Blob(chunks).text());
  if(!validSystem(value,count)||value.telemetry?.baseSavedAt!==undefined)throw new Error('클라우드 저장본의 형식이 맞지 않습니다.');
  return value;
}
/** Immutable compressed blobs plus an atomic manifest prevent cross-device overwrites. */
export class FirebaseSaveStore {
  constructor(private services:FirebaseServices,readonly uid:string,private count:number){}
  private manifest(){return doc(this.services.db,'users',this.uid,'saves','current');}
  private path(revision:string){return `users/${this.uid}/saves/${revision}.json.gz`;}
  private assertOwner(){if(this.services.auth.currentUser?.uid!==this.uid)throw new Error('계정이 변경되었습니다. 다시 로그인하세요.');}
  async read():Promise<RemoteSave|null>{
    this.assertOwner();let timer:ReturnType<typeof setTimeout>|undefined;
    const value=await Promise.race([getDocFromServer(this.manifest()),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('클라우드 연결 시간이 초과되었습니다.')),12000);})]).finally(()=>clearTimeout(timer));
    if(!value.exists())return null;
    const data=value.data();
    if(typeof data.revision!=='string'||!/^[\w-]{1,80}$/.test(data.revision)||data.format!==1)throw new Error('클라우드 저장 정보를 읽지 못했습니다.');
    const system=await decodeSave(await getBytes(ref(this.services.storage,this.path(data.revision)),COMPRESSED_LIMIT),this.count);
    this.assertOwner();return {revision:data.revision,system};
  }
  async write(system:SystemSave,expectedRevision:string|null):Promise<string>{
    this.assertOwner();if(!validSystem(system,this.count)||system.telemetry?.baseSavedAt!==undefined)throw new Error('완전한 저장본만 업로드할 수 있습니다.');
    const revision=crypto.randomUUID(),blob=await encodeSave(system);this.assertOwner();
    await uploadBytes(ref(this.services.storage,this.path(revision)),blob,{contentType:'application/gzip'});
    await runTransaction(this.services.db,async tx=>{
      this.assertOwner();const current=await tx.get(this.manifest());
      if((current.exists()?current.data().revision:null)!==expectedRevision)throw new SaveConflict();
      tx.set(this.manifest(),{revision,format:1,savedAt:system.savedAt});
    });
    // Keep prior revisions for recovery. No live save is deleted during a switch.
    return revision;
  }
}
