import {describe,it,beforeAll,afterAll,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import process from 'node:process';
import {initializeTestEnvironment,assertSucceeds,assertFails,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,type Firestore} from 'firebase/firestore';
import {ref,uploadBytes,getBytes,type FirebaseStorage} from 'firebase/storage';
import type {Auth} from 'firebase/auth';
import {FirebaseSaveStore} from '../src/account/firebase';
import {createSphere} from '../src/sim/sphere';
import {seedWorld} from '../src/sim/model';
import {migrateWorld} from '../src/sim/system';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Firebase user isolation and atomic cloud saves',()=>{
 let env:RulesTestEnvironment;
 beforeAll(async()=>{env=await initializeTestEnvironment({projectId:'demo-sandsphere',
  firestore:{host:'127.0.0.1',port:8085,rules:readFileSync('firestore.rules','utf8')},
  storage:{host:'127.0.0.1',port:9199,rules:readFileSync('storage.rules','utf8')}});},30000);
 afterAll(async()=>{await env?.cleanup();});
 it('allows only the owner to read and write a valid manifest, denies listing and malformed values',async()=>{
  const alice=env.authenticatedContext('alice').firestore(),bob=env.authenticatedContext('bob').firestore(),anon=env.unauthenticatedContext().firestore();
  await assertSucceeds(setDoc(doc(alice,'users/alice/saves/current'),{revision:'v1',format:1,savedAt:1}));
  await assertFails(getDoc(doc(bob,'users/alice/saves/current')));
  await assertFails(getDoc(doc(anon,'users/alice/saves/current')));
  await assertFails(setDoc(doc(bob,'users/alice/saves/current'),{revision:'evil',format:1,savedAt:2}));
  await assertFails(setDoc(doc(alice,'users/alice/saves/current'),{revision:'../bob',format:1,savedAt:2}));
  await assertFails(getDocs(collection(alice,'users/alice/saves')));
 });
 it('makes compressed revisions private and immutable',async()=>{
  const alice=env.authenticatedContext('alice').storage(),bob=env.authenticatedContext('bob').storage(),anon=env.unauthenticatedContext().storage();
  const path=`users/alice/saves/revision-${crypto.randomUUID()}.json.gz`,bytes=new Uint8Array([1,2,3]);
  await assertSucceeds(uploadBytes(ref(alice,path),bytes,{contentType:'application/gzip'}));
  await assertSucceeds(getBytes(ref(alice,path)));
  await assertFails(getBytes(ref(bob,path)));await assertFails(getBytes(ref(anon,path)));
  await assertFails(uploadBytes(ref(alice,path),bytes,{contentType:'application/gzip'}));
  await assertFails(uploadBytes(ref(alice,'users/alice/saves/not-gzip.json.gz'),bytes,{contentType:'text/plain'}));
  await assertFails(uploadBytes(ref(bob,'users/alice/saves/other.json.gz'),bytes,{contentType:'application/gzip'}));
 });
 it('permits exactly one concurrent writer and restores the committed world',async()=>{
  const uid='concurrent-'+crypto.randomUUID(),ctx=env.authenticatedContext(uid),grid=createSphere(0);
  const services={auth:{currentUser:{uid}} as Auth,db:(ctx.firestore() as unknown as {_delegate:Firestore})._delegate,storage:(ctx.storage() as unknown as {_delegate:FirebaseStorage})._delegate};
  const a=new FirebaseSaveStore(services,uid,grid.count),b=new FirebaseSaveStore(services,uid,grid.count);
  const save=migrateWorld({version:4,preset:'coast',state:[...seedWorld(grid)],time:0,discoveries:[],environment:{ambient:18,sunlight:1,sun:[0,1,0]},supplied:0,removed:0},grid.count);
  const results=await Promise.allSettled([a.write(save,null),b.write({...save,savedAt:20},null)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  const loaded=await a.read();expect(loaded?.system.planets).toEqual(save.planets);
  await expect(b.write(save,null)).rejects.toThrow('다른 기기');
  services.auth={currentUser:{uid:'different'}} as Auth;
  await expect(a.read()).rejects.toThrow('계정');
 },30000);
});
