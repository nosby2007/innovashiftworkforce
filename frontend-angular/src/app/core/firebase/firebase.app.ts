import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

// ─────────────────────────────────────────────────────────────
// ENVIRONMENT DETECTION
// Emulators are opt-in so local preview still works when the local
// Firebase emulator stack is not available.
// ─────────────────────────────────────────────────────────────
const USE_EMULATOR = (typeof location !== 'undefined')
  ? (() => {
      try {
        return location.search.includes('emulator=1') || localStorage.getItem('USE_FIREBASE_EMULATOR') === '1';
      } catch {
        return false;
      }
    })()
  : false;

let initialized = false;

export function initFirebaseApp() {
  if (initialized) return;

  const app = initializeApp({
    apiKey:            'AIzaSyAF1HZp-9xE_4-MaT_mS-H0KIP_k9j-Org',
    authDomain:        'atlanta-e04aa.firebaseapp.com',
    projectId:         'atlanta-e04aa',
    storageBucket:     'atlanta-e04aa.firebasestorage.app',
    messagingSenderId: '404381833719',
    appId:             '1:404381833719:web:20c22d5b673fe2134d36f2',
  });

  try {
    initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // Firestore may already be initialized in tests or hot reload.
  }

  initialized = true;

  if (USE_EMULATOR) {
    console.info('[InnovaShift] 🔧 Connecting to Firebase emulators');
    connectAuthEmulator(getAuth(), 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(getFirestore(), '127.0.0.1', 8080);
    connectFunctionsEmulator(getFunctions(undefined, 'us-east1'), '127.0.0.1', 5001);
  } else {
    console.info('[InnovaShift] 🚀 Connected to Firebase production');
  }
}
