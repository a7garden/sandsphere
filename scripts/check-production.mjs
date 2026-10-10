import {loadEnv} from 'vite';
const env={...loadEnv('production',process.cwd(),'VITE_'),...process.env};
const required=['API_KEY','AUTH_DOMAIN','PROJECT_ID','STORAGE_BUCKET','APP_ID'].map(k=>'VITE_FIREBASE_'+k);
const missing=required.filter(k=>!env[k]);
if(missing.length||env.VITE_FIREBASE_EMULATORS==='1'||env.VITE_FIREBASE_PROJECT_ID?.startsWith('demo-')){
  console.error('Production requires a real Firebase configuration. Missing:',missing.join(', ')||'emulator/demo configuration');process.exit(1);
}
console.log('Production Firebase configuration is present.');
