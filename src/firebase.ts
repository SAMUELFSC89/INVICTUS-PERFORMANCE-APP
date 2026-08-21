import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth,
  initializeAuth,
  browserLocalPersistence, 
  onAuthStateChanged, 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult, 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  OAuthProvider, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut
} from 'firebase/auth';
import { 
  getFirestore, 
  initializeFirestore, 
  doc, 
  getDocFromServer,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  setLogLevel
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { Capacitor } from '@capacitor/core';

// #223 - INSTRUMENTACAO TEMPORARIA.
// Nao ha console acessivel no iPhone sem um Mac. Registramos marcos do boot
// com tempo para que o proprio app possa dizer onde travou.
const marcos: string[] = [];
(window as any).__invictusDiag = marcos;
export function marcarDiag(m: string) {
  const t = Math.round(performance.now());
  marcos.push(t + 'ms  ' + m);
  console.log('[DIAG] ' + t + 'ms ' + m);
}
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const isClient = typeof window !== 'undefined';

const getAuthDomain = () => {
  if (isClient) {
    const hostname = window.location.hostname;
    if (hostname.includes('invictusperformance.app.br')) {
      // Usa o hostname atual (com ou sem www) para que o authDomain sempre
      // coincida com a origem real da pagina. Um mismatch aqui (ex: pagina em
      // www.invictusperformance.app.br mas authDomain fixo em invictusperformance.app.br)
      // quebra a comunicacao popup<->opener do Firebase Auth e causa
      // 'auth/popup-closed-by-user' silenciosamente no login com Google.
      return hostname;
    }
    if (hostname.includes('localhost') || hostname.includes('127.0.0.1') || hostname.includes('run.app')) {
      return firebaseConfig.authDomain || `${firebaseConfig.projectId.trim()}.firebaseapp.com`;
    }
  }
  return 'invictusperformance.app.br';
};

const finalConfig = {
  ...firebaseConfig,
  authDomain: getAuthDomain(),
  projectId: firebaseConfig.projectId.trim()
};

console.log('[Firebase] Initializing with Project ID:', finalConfig.projectId);
const app = getApps().length === 0 ? initializeApp(finalConfig) : getApp();

// Initialize Firestore with persistence and specific options
const databaseId = finalConfig.firestoreDatabaseId || '(default)';
console.log('[Firebase] Using Firestore Database ID:', databaseId);

// #223: no app NATIVO nao use cache persistente do Firestore.
//
// persistentLocalCache depende de IndexedDB. No WKWebView servindo pelo
// esquema capacitor://localhost o IndexedDB e inconsistente, e quando ele
// falha o Firestore NAO lanca erro: as leituras simplesmente ficam
// penduradas para sempre. Sintoma exato: o app abre, mostra o spinner do
// perfil e nunca entra.
//
// Na web o cache persistente continua ligado normalmente (offline + multi-aba).
const ehNativo = Capacitor.isNativePlatform();
console.log('[Firebase] Plataforma nativa:', ehNativo, '| cache:', ehNativo ? 'memoria' : 'persistente');

const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  localCache: ehNativo
    ? memoryLocalCache()
    : persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
}, databaseId);

// Suppress clock-skew/system time warnings from logging to the client console
try {
  setLogLevel('error');
} catch (e) {
  console.warn('[Firebase] Failed to set log level:', e);
}

if (isClient) {
  const filterWarnAndError = (originalFn: (...args: any[]) => void) => {
    return (...args: any[]) => {
      try {
        const argStr = args
          .map(a => typeof a === 'string' ? a : (a instanceof Error ? a.message : String(a)))
          .join(' ');
        if (argStr.includes('Detected an update time that is in the future')) {
          // Suppress this specific Firestore clock skew warning to avoid false alarms in error tracking
          return;
        }
      } catch (err) {
        // Safe fallback in case mapping fails
      }
      originalFn.apply(console, args);
    };
  };

  console.error = filterWarnAndError(console.error);
  console.warn = filterWarnAndError(console.warn);
}

// Detect project change to prevent 'incorrect aud' errors
const currentPid = firebaseConfig.projectId;
const storedPid = localStorage.getItem('fb_project_id');

if (storedPid && storedPid !== currentPid) {
  console.warn(`Project ID changed from ${storedPid} to ${currentPid}. Signing out...`);
  const auth = getAuth(app);
  signOut(auth).catch(() => {});
  localStorage.setItem('fb_project_id', currentPid);
} else if (!storedPid) {
  localStorage.setItem('fb_project_id', currentPid);
}

// #223: no app nativo NAO deixe o Firebase Auth escolher IndexedDB sozinho.
//
// O Auth persiste a sessao em IndexedDB por padrao. Sob o esquema
// capacitor:// o IndexedDB e inconsistente no WKWebView, e quando ele trava
// o onAuthStateChanged pode simplesmente NUNCA disparar -- o app fica preso
// na tela de carregamento sem nenhum erro. browserLocalPersistence usa
// localStorage, que funciona de forma confiavel nesse ambiente.
const auth = ehNativo
  ? initializeAuth(app, { persistence: browserLocalPersistence })
  : getAuth(app);
marcarDiag('auth inicializado (persistencia: ' + (ehNativo ? 'localStorage' : 'padrao') + ')');

// Marca se e quando o estado de autenticacao resolve. Se este marco nunca
// aparecer no diagnostico, o problema esta no Auth, nao na leitura de dados.
onAuthStateChanged(auth, (u) => {
  marcarDiag('onAuthStateChanged -> ' + (u ? 'com usuario' : 'sem usuario'));
});
marcarDiag('firestore pronto (cache: ' + (ehNativo ? 'memoria' : 'persistente') + ')');
const storage = getStorage(app);

export { 
  app, 
  db, 
  auth,
  storage,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut
};

/*
async function testConnection() {
  try {
    console.log("Firebase: Starting Firestore connection test...");
    await getDocFromServer(doc(db, '_connection_test_', 'ping'));
    console.log("Firebase: Firestore connection test successful.");
  } catch (error: any) {
    console.warn("Firebase: Firestore connection test failed:", error.message || error);
    if (error.message?.includes('offline')) {
      console.error("CRITICAL: Firestore is reporting OFFLINE. Check network/CSP.");
    }
  }
}
testConnection();
*/

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}