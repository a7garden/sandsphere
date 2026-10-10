import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
if(!process.env.FIREBASE_SERVICE_ACCOUNT||!process.env.VITE_FIREBASE_PROJECT_ID)throw new Error('Firebase deployment credentials and project are required.');
const dir=await mkdtemp(join(tmpdir(),'sandsphere-firebase-'));
try{
 const credential=join(dir,'service-account.json');
 await writeFile(credential,JSON.stringify(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),{mode:0o600});
 execFileSync('npx',['firebase','deploy','--project',process.env.VITE_FIREBASE_PROJECT_ID,'--only','firestore:rules,storage','--non-interactive'],{stdio:'inherit',env:{...process.env,GOOGLE_APPLICATION_CREDENTIALS:credential}});
}finally{await rm(dir,{recursive:true,force:true});}
