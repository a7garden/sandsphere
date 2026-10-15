import {it,expect} from 'vitest';
import {firebaseConfigured} from '../src/account/config';
it('loads account services only with complete web configuration and keeps demo policy outside this gate',()=>{
 const env={VITE_FIREBASE_API_KEY:'key',VITE_FIREBASE_AUTH_DOMAIN:'auth',VITE_FIREBASE_PROJECT_ID:'demo-sandsphere',VITE_FIREBASE_APP_ID:'app'};expect(firebaseConfigured({})).toBe(false);expect(firebaseConfigured(env)).toBe(true);
 for(const key of Object.keys(env))expect(firebaseConfigured({...env,[key]:''})).toBe(false);
 expect(firebaseConfigured({...env,VITE_FIREBASE_API_KEY:false})).toBe(false);
});
