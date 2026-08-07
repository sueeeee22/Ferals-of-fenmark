import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

// These values are NOT secrets. Firebase web config ships inside the client
// bundle by design and is visible to anyone who loads the page — access is
// controlled by firestore.rules, not by hiding these strings. They live in env
// vars so that dev/staging/prod can point at different projects, nothing more.
const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missing = Object.entries(config)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length > 0) {
  throw new Error(
    `Missing Firebase config: ${missing.join(', ')}. ` +
      'Copy .env.example to .env.local and fill in the values from the ' +
      'Firebase console (Project settings > Your apps).',
  );
}

export const app = initializeApp(config);
export const db = getFirestore(app);

// Point at the local emulator during `npm run dev` so development never writes
// to the real database. Production builds skip this entirely.
if (import.meta.env.DEV && import.meta.env.VITE_FIRESTORE_EMULATOR === 'true') {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
