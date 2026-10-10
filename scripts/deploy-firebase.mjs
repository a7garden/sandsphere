import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
if(!process.env.VITE_FIREBASE_PROJECT_ID)throw new Error('Firebase project is required.');
const dir=await mkdtemp(join(tmpdir(),'sandsphere-firebase-'));
try{
 const credential=join(dir,'service-account.json');
 const env={...process.env};
 if(process.env.FIREBASE_SERVICE_ACCOUNT){
   await writeFile(credential,JSON.stringify(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),{mode:0o600});
   env.GOOGLE_APPLICATION_CREDENTIALS=credential;
 }
 // The private repository's dedicated runner may use its owner's Firebase CLI
 // login. Shared runners must supply a scoped service account instead.
 execFileSync('npx',['firebase','deploy','--project',process.env.VITE_FIREBASE_PROJECT_ID,'--only','firestore:rules,firestore:indexes','--non-interactive'],{stdio:'inherit',env});
}finally{await rm(dir,{recursive:true,force:true});}
