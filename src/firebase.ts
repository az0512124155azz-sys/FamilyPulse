import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCX-A4X8yYPbImPSU51ozSQSyK20plRSAs',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'familypulse-8de4f.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'familypulse-8de4f',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'familypulse-8de4f.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '892197219421',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:892197219421:web:650ead5832aa5264a7b1b4',
};

export const firebaseReady = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);

export const app: FirebaseApp | null = firebaseReady ? initializeApp(firebaseConfig) : null;

export const auth = (app ? getAuth(app) : null) as Auth;
export const db = (app ? getFirestore(app) : null) as Firestore;
export const storage = (app ? getStorage(app) : null) as FirebaseStorage;

export async function ensureAuth() {
  if (!firebaseReady || !auth) {
    throw new Error('Firebase is not configured.');
  }
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}
