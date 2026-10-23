import {encodeStoredSave,decodeStoredSave} from './saveCodecClient';
/** Browser persistence only. The snapshot schema and its migrations live in storage.ts. */
export interface SnapshotCompanion {slot:string;value:unknown;}
interface StampedSnapshot {savedAt:number;}
interface LegacyReceipt {version:1;savedAt:number;fingerprint:string;}
interface PendingCheckpoint {version:1;savedAt:number;}
interface LifecycleCheckpoint {version:1;system:StampedSnapshot;receipt?:LegacyReceipt;generation?:string;}
export interface LifecycleCheckpointWrite {target:string;value:unknown;companions:SnapshotCompanion[];}
let lifecycleWriter:((write:LifecycleCheckpointWrite)=>Promise<boolean>)|undefined;
export function setLifecycleCheckpointWriter(writer:(write:LifecycleCheckpointWrite)=>Promise<boolean>){lifecycleWriter=writer;}
/** Also used by the dedicated persistence Service Worker, whose message event
 * keeps the transaction alive after its originating document has gone away. */
export async function commitLifecycleCheckpoint(write:LifecycleCheckpointWrite):Promise<boolean>{
 const value=write.value as LifecycleCheckpoint;
 if(value?.version===1&&value.system)value.system=await compactSnapshot(value.system);
 return writeSnapshot(value,write.target,write.companions);
}
interface CompactSnapshot extends StampedSnapshot {transport:'sandsphere-binary-gzip-1';bytes:Uint8Array<ArrayBuffer>;}
const compact=(value:unknown):value is CompactSnapshot=>!!value&&typeof value==='object'&&(value as CompactSnapshot).transport==='sandsphere-binary-gzip-1'&&(value as CompactSnapshot).bytes instanceof Uint8Array;
async function compactSnapshot(value:StampedSnapshot):Promise<CompactSnapshot>{return {transport:'sandsphere-binary-gzip-1',savedAt:value.savedAt,bytes:await encodeStoredSave(value)};}
async function expandSnapshot(value:unknown):Promise<unknown>{
 if(!compact(value))return value;
 try{const decoded=await decodeStoredSave(value.bytes);if((decoded as StampedSnapshot)?.savedAt!==value.savedAt)throw new Error('Save transport timestamp mismatch.');return decoded;}catch{return value;}
}
export class BrowserSaveConflict extends Error {constructor(){super('다른 창에서 사용할 저장본을 바꿨습니다. 이 창을 다시 불러온 뒤 계속하세요.');this.name='BrowserSaveConflict';}}
const stamped=(value:unknown):value is StampedSnapshot=>!!value&&typeof value==='object'&&Number.isFinite((value as StampedSnapshot).savedAt);
const lifecyclePrefix=(slot:string)=>slot+'-lifecycle-';
const checkpointStamp=(key:IDBValidKey,prefix:string)=>typeof key==='string'?Number(key.slice(prefix.length).split('|')[0]):NaN;
const checkpointGeneration=(key:IDBValidKey)=>typeof key==='string'?key.split('|')[2]||undefined:undefined;

let connection:IDBDatabase|undefined,opening:Promise<IDBDatabase>|undefined;

/** Keep a connection ready so a lifecycle checkpoint starts its transaction before
 * returning to the browser; opening a database for the first time at pagehide is too late. */
export function prepareBrowserStorage():Promise<IDBDatabase> {
 if(connection)return Promise.resolve(connection);
 if(opening)return opening;
 opening=new Promise<IDBDatabase>((resolve,reject)=>{
  let settled=false;
  const req=indexedDB.open('sandsphere',1);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('snapshots'))req.result.createObjectStore('snapshots');};
  req.onsuccess=()=>{
   const db=req.result;if(settled){db.close();return;}settled=true;connection=db;
   db.onversionchange=()=>{db.close();if(connection===db)connection=undefined;};
   db.onclose=()=>{if(connection===db)connection=undefined;};
   resolve(db);
  };
  req.onerror=()=>{settled=true;reject(req.error??new Error('브라우저 저장소를 열지 못했습니다.'));};
  req.onblocked=()=>{settled=true;reject(new Error('다른 창에서 저장소를 사용 중입니다.'));};
 }).finally(()=>{opening=undefined;});
 return opening;
}

function withDatabase<T>(run:(db:IDBDatabase)=>Promise<T>):Promise<T> {
 // Do not turn this into an async/await wrapper: the ready-connection path must
 // create its transaction synchronously, including during pagehide.
 try{return connection?run(connection):prepareBrowserStorage().then(run);}catch(error){return Promise.reject(error);}
}

/** A world and its recovery metadata either all commit or all remain unchanged. */
function writeSnapshot(snapshot:unknown,slot:string,companions:SnapshotCompanion[],newerOnly=false,expectedGeneration?:{slot:string;value:string|undefined},backupPrevious=false):Promise<boolean> {
 // IDB put clones synchronously. Only the initial database-open path needs an
 // explicit copy to keep later live edits out of an already requested checkpoint.
 const value=connection?snapshot:structuredClone(snapshot),copies=connection?companions:structuredClone(companions),savedAt=(snapshot as StampedSnapshot|undefined)?.savedAt;
 return withDatabase(db=>new Promise<boolean>((resolve,reject)=>{
  const tx=db.transaction('snapshots','readwrite',{durability:'strict'}),store=tx.objectStore('snapshots');let written=false,superseded=false;
  // Aborting a superseded transaction can dispatch request errors before the
  // final abort event. Both paths represent a deliberate stale-write rejection.
  const fail=()=>superseded?resolve(false):reject(tx.error??new Error('브라우저의 저장 처리가 중단되었습니다.'));
  tx.oncomplete=()=>resolve(written);tx.onerror=fail;tx.onabort=fail;
  const put=()=>{
   try{for(const companion of copies)store.put(companion.value,companion.slot);store.put(value,slot);written=true;}
   catch(error){tx.abort();reject(error);}
  };
  if(newerOnly||backupPrevious){
   let previousValue:unknown,backupValue:unknown,backupRead=false,previousRead=false;const preserve=()=>{if(backupRead&&previousRead&&backupValue===undefined&&stamped(previousValue)&&!compact(previousValue))store.put(previousValue,slot+'-before-binary-v1');};
   let checks=(expectedGeneration?2:1)+(backupPrevious?1:0);const checked=()=>{if(!--checks)tx.commit();},obsolete=()=>{superseded=true;tx.abort();};
   const prior=store.get(slot);prior.onsuccess=()=>{previousValue=prior.result;previousRead=true;preserve();const previous=prior.result as StampedSnapshot|undefined;if(newerOnly&&typeof previous?.savedAt==='number'&&previous.savedAt>savedAt!)obsolete();else checked();};
   if(backupPrevious){const backup=store.get(slot+'-before-binary-v1');backup.onsuccess=()=>{backupValue=backup.result;backupRead=true;preserve();checked();};}
   if(expectedGeneration){const epoch=store.get(expectedGeneration.slot);epoch.onsuccess=()=>{const current=typeof epoch.result==='string'?epoch.result:undefined;if(current!==expectedGeneration.value){tx.abort();reject(new BrowserSaveConflict());}else checked();};}
  }
  // Queue puts now, so IDB takes its immutable structured copy in this call stack.
  // The preceding get can still abort every write before an older save commits.
  put();
  // Lifecycle writes have no JS-dependent requests. Explicit commit lets IDB
  // finish them even when navigation prevents further request events reaching us.
  if(!newerOnly&&!backupPrevious&&written)tx.commit();
 }));
}

export function saveSnapshot(snapshot:unknown,slot='latest',companion?:SnapshotCompanion):Promise<void> {
 return writeSnapshot(snapshot,slot,companion?[companion]:[]).then(()=>{});
}

export function loadRecords(slots:string[]):Promise<unknown[]> {
 return withDatabase(db=>new Promise<unknown[]>((resolve,reject)=>{
  const tx=db.transaction('snapshots','readonly'),store=tx.objectStore('snapshots'),values:unknown[]=new Array(slots.length);
  tx.oncomplete=()=>resolve(values);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  slots.forEach((slot,i)=>{const req=store.get(slot);req.onsuccess=()=>{values[i]=req.result;};});
 }));
}
export function loadRecord(slot:string):Promise<unknown> {return loadRecords([slot]).then(values=>values[0]);}

async function readSystemRecords(slot:string,valid:(value:unknown)=>value is StampedSnapshot){
 const records=await withDatabase(db=>new Promise<{primary:unknown;telemetryBase:unknown;receipt:LegacyReceipt|undefined;generation:string|undefined;keys:IDBValidKey[]}>((resolve,reject)=>{
  const tx=db.transaction('snapshots','readonly'),store=tx.objectStore('snapshots'),prefix=lifecyclePrefix(slot);
  let primary:unknown,telemetryBase:unknown,receipt:LegacyReceipt|undefined,generation:string|undefined,keys:IDBValidKey[]=[];
  tx.oncomplete=()=>resolve({primary,telemetryBase,receipt,generation,keys});tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  const world=store.get(slot);world.onsuccess=()=>{primary=world.result;};
  const base=store.get(slot+'-telemetry-base');base.onsuccess=()=>{telemetryBase=base.result;};
  const migration=store.get(slot+'-resume-receipt');migration.onsuccess=()=>{receipt=migration.result;};
  const epoch=store.get(slot+'-lifecycle-generation');epoch.onsuccess=()=>{generation=typeof epoch.result==='string'?epoch.result:undefined;};
  const request=store.getAllKeys(IDBKeyRange.bound(prefix,prefix+'\uffff'));request.onsuccess=()=>{keys=request.result;};
 }));
 let disk=await expandSnapshot(records.primary),receipt=records.receipt;
 const prefix=lifecyclePrefix(slot),ordered=records.keys.filter(key=>Number.isFinite(checkpointStamp(key,prefix))&&checkpointGeneration(key)===records.generation).sort((a,b)=>checkpointStamp(b,prefix)-checkpointStamp(a,prefix));
 // Expand only the newest valid recovery value. Corrupt compact records stay on
 // disk for recovery and never replace a complete earlier save.
 for(const key of ordered){
  const value=await loadRecord(String(key)) as LifecycleCheckpoint|undefined;
  if(value?.version!==1||value.generation!==records.generation)continue;
  const system=await expandSnapshot(value.system);if(!valid(system))continue;
  if(!valid(disk)||system.savedAt>disk.savedAt){disk=system;receipt=value.receipt;}break;
 }
 return {disk,telemetryBase:records.telemetryBase,receipt,generation:records.generation};
}
export function pruneLifecycleCheckpoints(slot:string,savedAt:number,generation:string|undefined):Promise<void>{
 return withDatabase(db=>new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots'),prefix=lifecyclePrefix(slot);
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  // A different page may replace the branch between the original save and this
  // cleanup. Verify the generation inside this same write transaction before
  // enumerating keys; later replacements then serialize after our deletions.
  const epoch=store.get(slot+'-lifecycle-generation');epoch.onsuccess=()=>{
   const current=typeof epoch.result==='string'?epoch.result:undefined;if(current!==generation)return;
   const keys=store.getAllKeys(IDBKeyRange.bound(prefix,prefix+'\uffff'));keys.onsuccess=()=>{for(const key of keys.result){const stamp=checkpointStamp(key,prefix);if(Number.isFinite(stamp)&&(checkpointGeneration(key)!==generation||stamp<=savedAt))store.delete(key);}};
  };
 }));
}

/** Timestamp comparison only chooses between checkpoints from this browser. Cloud
 * conflict resolution still uses revisions, independently of wall clocks. */
export function latestResume<T extends StampedSnapshot>(disk:unknown,legacy:unknown,valid:(value:unknown)=>value is T):T|null {
 const saved=valid(disk)?disk:null,resume=valid(legacy)?legacy:null;
 return resume&&(!saved||resume.savedAt>saved.savedAt)?resume:saved;
}

function parse(raw:string|null):unknown {try{return raw===null?undefined:JSON.parse(raw);}catch{return undefined;}}
function fingerprint(raw:string):string {
 // Two independent 32-bit accumulators identify an unchanged legacy value without
 // copying its megabytes into the receipt. The original value is never removed.
 let a=2166136261,b=5381;
 for(let i=0;i<raw.length;i++){const c=raw.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c;}
 return raw.length+':'+(a>>>0).toString(16)+':'+(b>>>0).toString(16);
}

/** Whole systems use IndexedDB, including lifecycle resumes. localStorage contains
 * only a small best-effort pending-write notice and untouched legacy saves. */
export class BrowserSystemStorage {
 private legacy:unknown;
 private legacyFingerprint:string|undefined;
 private readonly pendingKey:string;
 private readonly writerId=crypto.randomUUID();
 private generation:string|undefined;
 constructor(readonly slot:string,readonly resumeKey:string,private readonly local:Pick<Storage,'getItem'|'setItem'|'removeItem'>=localStorage){
  this.pendingKey=resumeKey+'-pending';
  try{const raw=local.getItem(resumeKey);if(raw!==null){this.legacy=parse(raw);this.legacyFingerprint=fingerprint(raw);}}catch{}
 }
 async read(valid:(value:unknown)=>value is StampedSnapshot=stamped){
  const {disk,telemetryBase,receipt,generation}=await readSystemRecords(this.slot,valid);this.generation=generation;
  const r=receipt as LegacyReceipt|undefined;
  // A receipt is authoritative only alongside the exact world transaction that
  // wrote it. A changed legacy key remains eligible for recovery.
  const retired=r?.version===1&&r.savedAt===(disk as StampedSnapshot|undefined)?.savedAt&&r.fingerprint===this.legacyFingerprint;
  let pending:unknown;try{pending=parse(this.local.getItem(this.pendingKey));}catch{}
  const p=pending as PendingCheckpoint|undefined;
  return {disk,legacy:retired?undefined:this.legacy,telemetryBase,pendingAt:p?.version===1&&Number.isFinite(p.savedAt)?p.savedAt:undefined};
 }
 captureGeneration(){return this.generation;}
 savePrepared(savedAt:number,bytes:Uint8Array<ArrayBuffer>,companion?:SnapshotCompanion,generation={value:this.generation}):Promise<boolean>{
  return this.save({transport:'sandsphere-binary-gzip-1',savedAt,bytes} as CompactSnapshot,companion,{prepared:true,expectedGeneration:generation});
 }
 save(snapshot:StampedSnapshot,companion?:SnapshotCompanion,{replace=false,lifecycle=false,prepared=false,expectedGeneration=undefined as {value:string|undefined}|undefined}={}):Promise<boolean> {
  const companions=companion?[structuredClone(companion)]:[],savedAt=snapshot.savedAt;
  // Replacing a branch is a local generation change, independent of a remote
  // device's clock. A late checkpoint from the former page remains ineligible.
  const generation=replace?crypto.randomUUID():expectedGeneration?expectedGeneration.value:this.generation;
  if(replace)companions.push({slot:this.slot+'-lifecycle-generation',value:generation});
  const legacyStamp=(this.legacy as StampedSnapshot|undefined)?.savedAt;
  const receipt=this.legacyFingerprint&&(replace||typeof legacyStamp!=='number'||legacyStamp<=savedAt)?{version:1 as const,savedAt,fingerprint:this.legacyFingerprint}:undefined;
  if(receipt&&!lifecycle)companions.push({slot:this.slot+'-resume-receipt',value:receipt});
  try{const prior=parse(this.local.getItem(this.pendingKey)) as PendingCheckpoint|undefined;if(!prior||prior.savedAt<=savedAt)this.local.setItem(this.pendingKey,JSON.stringify({version:1,savedAt} satisfies PendingCheckpoint));}catch{}
  // writeSnapshot starts synchronously when read()/prepareBrowserStorage() has
  // opened the connection. Never wait for an earlier automatic save here.
  // Lifecycle transactions must not depend on JS callbacks after navigation.
  // Unique slots allow a put-only explicit commit without letting an older
  // page overwrite a newer primary or another page's lifecycle checkpoint.
  const value=lifecycle?{version:1,system:snapshot,receipt,generation} satisfies LifecycleCheckpoint:snapshot;
  const target=lifecycle?lifecyclePrefix(this.slot)+savedAt+'|'+this.writerId+'|'+(generation??''):this.slot;
  const pending=lifecycle?(lifecycleWriter?lifecycleWriter({target,value,companions}):writeSnapshot(value,target,companions,false)):
   (prepared?Promise.resolve(snapshot):compactSnapshot(snapshot)).then(encoded=>writeSnapshot(encoded,target,companions,!replace,replace?undefined:{slot:this.slot+'-lifecycle-generation',value:generation},true));
  return pending.then(written=>{
   if(written&&replace)this.generation=generation;
   try{const pending=parse(this.local.getItem(this.pendingKey)) as PendingCheckpoint|undefined;if(pending?.savedAt===savedAt)this.local.removeItem(this.pendingKey);}catch{}
   // Cleanup follows a successful durable primary write. Its failure can only
   // retain redundant recovery records, never delete a newer checkpoint.
   if(written&&!lifecycle)void pruneLifecycleCheckpoints(this.slot,savedAt,generation).catch(()=>{});
   return written;
  });
 }
}
