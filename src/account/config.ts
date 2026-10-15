/** Guest-only builds do not need to evaluate the Firebase SDK. Configured builds
 * still resolve authentication before selecting a save scope. */
export function firebaseConfigured(env:Record<string,unknown>){return ['VITE_FIREBASE_API_KEY','VITE_FIREBASE_AUTH_DOMAIN','VITE_FIREBASE_PROJECT_ID','VITE_FIREBASE_APP_ID'].every(key=>typeof env[key]==='string'&&env[key]!=='');}
