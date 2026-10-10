import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import process from 'node:process';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,signInWithEmailAndPassword,signOut} from 'firebase/auth';
import {getFirestore,doc,getDocFromServer} from 'firebase/firestore';
import {FirebaseSaveStore} from '../src/account/firebase';
import {createSphere} from '../src/sim/sphere';
import {seedWorld} from '../src/sim/model';
import {migrateWorld} from '../src/sim/system';

// Explicitly opt in with temporary verification accounts. Never use a real
// player's UID or run this against production from the normal CI workflow.
describe.skipIf(!process.env.SANDSPHERE_LIVE_USERS||!process.env.SANDSPHERE_LIVE_CONFIG)('operational Firebase account saves',()=>{
 it('logs in, saves, switches users and restores only the original owner',async()=>{
  const config=JSON.parse(readFileSync(process.env.SANDSPHERE_LIVE_CONFIG!,'utf8')).result.sdkConfig;
  const users=JSON.parse(readFileSync(process.env.SANDSPHERE_LIVE_USERS!,'utf8'));
  if(users.some((u:{email:string})=>!u.email.endsWith('@example.invalid')))throw new Error('Only disposable verification accounts are allowed.');
  const app=initializeApp(config,'live-verification-'+crypto.randomUUID());
  const auth=getAuth(app),db=getFirestore(app),grid=createSphere(0);
  try{
   await signInWithEmailAndPassword(auth,users[0].email,users[0].password);
   expect(auth.currentUser?.uid).toBe(users[0].uid);
   const alice=new FirebaseSaveStore({auth,db,storage:null},users[0].uid,grid.count);
   expect(await alice.read()).toBeNull();
   const save=migrateWorld({version:4,preset:'coast',state:[...seedWorld(grid)],time:17,discoveries:[],environment:{ambient:18,sunlight:1,sun:[0,1,0]},supplied:0,removed:0},grid.count);
   save.planets[0].name='운영 저장 검증';
   const revision=await alice.write(save,null);
   await signOut(auth);await signInWithEmailAndPassword(auth,users[1].email,users[1].password);
   const bob=new FirebaseSaveStore({auth,db,storage:null},users[1].uid,grid.count);
   expect(await bob.read()).toBeNull();
   await expect(getDocFromServer(doc(db,'users',users[0].uid,'saves','current'))).rejects.toMatchObject({code:'permission-denied'});
   await expect(alice.read()).rejects.toThrow('계정');
   await signOut(auth);await signInWithEmailAndPassword(auth,users[0].email,users[0].password);
   const restored=await alice.read();
   expect(restored?.revision).toBe(revision);expect(restored?.system.planets).toEqual(save.planets);
   console.log('Verified live email login, private cloud write, cross-user denial and fresh-login restore.');
  }finally{await signOut(auth);await deleteApp(app);}
 },60000);
});
