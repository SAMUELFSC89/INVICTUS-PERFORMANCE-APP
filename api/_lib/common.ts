import 'dotenv/config';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps, getApp, App, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import path from 'path';
import fs from 'fs';

// Helper to fix project ID (ensure gen-lang-client- prefix for numeric IDs)
function fixProjectId(id?: string): string | undefined {
  if (!id) return id;
  const trimmed = id.trim();
  if (/^\d+$/.test(trimmed)) {
    return `gen-lang-client-${trimmed}`;
  }
  return trimmed;
}

// 0. Load Config
const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
let config: any = {};
try {
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (e) {}

// 1. Load Service Account
let serviceAccount: any;
const saPath = path.resolve(process.cwd(), 'api/_lib/serviceAccountKey.json');

try {
  if (fs.existsSync(saPath)) {
    serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    console.log(`[Firebase Admin] Service Account loaded from file: ${saPath}`);
  }
} catch (e: any) {
  // Silent fallback
}

if ((!serviceAccount || !serviceAccount.private_key) && process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log(`[Firebase Admin] Service Account loaded from FIREBASE_SERVICE_ACCOUNT`);
  } catch (e: any) {
    console.error(`[Firebase Admin] Failed to parse env FIREBASE_SERVICE_ACCOUNT`);
  }
}

// 2. Initialize App
let app: App;
let dbInstance: Firestore | null = null;
let initError: Error | null = null;

// Determine best Project ID
const configPid = fixProjectId(config.projectId);
const envPid = fixProjectId(process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID);

// Force the correct project ID into the environment to help auto-detection
if (configPid) {
  process.env.PROJECT_ID = configPid;
  process.env.GOOGLE_CLOUD_PROJECT = configPid;
}

const saPid = serviceAccount?.project_id ? fixProjectId(serviceAccount.project_id) : undefined;
const primaryPid = configPid || saPid || envPid;

// Check if service account project matches current primary project
const isSaMatching = !configPid || !saPid || saPid === configPid;

try {
  if (!getApps().length) {
    console.log(`[Firebase Admin] Forcing environment Project ID to: ${primaryPid || 'auto-detect'}`);
    try {
      const options: any = { projectId: primaryPid };
      // Only use cert() if the service account matches the target project_id
      if (serviceAccount?.private_key && isSaMatching) {
        options.credential = cert(serviceAccount);
      }
      app = initializeApp(options);
    } catch (e: any) {
      console.warn(`[Firebase Admin] Init with options failed: ${e.message}. Trying generic init.`);
      app = initializeApp();
    }
  } else {
    app = getApp();
  }

  // Check if we should use a specific database from config
  const firestoreDbId = config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)' 
    ? config.firestoreDatabaseId 
    : undefined;

  dbInstance = getFirestore(app, firestoreDbId);
  try {
    dbInstance.settings({ ignoreUndefinedProperties: true });
  } catch (e: any) {
    // Settings might already be set or not supported
  }
} catch (e: any) {
  console.error(`[Firebase Admin Init Error] Failed to initialize App or Firestore safely: ${e.message}`);
  initError = e;
}

/**
 * Sanitizes object payload by stripping undefined values recursively before Firestore writes.
 */
export function sanitizeForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as any;
  }
  if (typeof data !== 'object') {
    return data;
  }
  if (data.constructor && data.constructor.name !== 'Object' && !Array.isArray(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return data
      .filter(item => item !== undefined)
      .map(item => sanitizeForFirestore(item)) as any;
  }

  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(data as Record<string, any>)) {
    if (value !== undefined) {
      cleaned[key] = sanitizeForFirestore(value);
    }
  }
  return cleaned as T;
}

// 4. Initialize Firestore as a safe Proxy to prevent load-time process crashes
export const db = new Proxy({} as Firestore, {
  get(target, prop, receiver) {
    if (!dbInstance) {
      throw new Error(`[Firebase Connection Error] O Firestore não foi inicializado corretamente fora do ambiente de produção. Verifique se o arquivo /api/_lib/serviceAccountKey.json ou a variável de ambiente FIREBASE_SERVICE_ACCOUNT está configurada.`);
    }
    const value = Reflect.get(dbInstance, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(dbInstance);
    }
    return value;
  }
});

// 9. Simple connection test with runtime fallback
export async function testConnection() {
    if (!dbInstance || !app) {
      console.warn('[Firebase Admin] Cannot run connection test - SDK is not initialized.');
      return;
    }
    const targetPid = (app.options as any).projectId || 'auto-detected';
    const firestoreDbId = config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)' 
      ? config.firestoreDatabaseId 
      : undefined;
    const targetDb = firestoreDbId || '(default)';
    console.log(`[Firebase Admin] Connectivity check: Project=${targetPid}, DB=${targetDb}`);
    
    try {
      // Test read
      await dbInstance.collection("_connection_test_").doc("ping").get();
      console.log(`[Firebase Admin] Connectivity check successful.`);
    } catch (e: any) {
      console.warn(`[Firebase Admin] Connectivity check failed: ${e.message}`);
      
      // If it's a permission error, we try to explain why (likely Service Account mismatch)
      if (e.message.includes("PERMISSION_DENIED")) {
        console.warn(`[Firebase Admin] This usually means the Service Account running this code doesn't have the "Cloud Datastore User" or "Firebase Firestore Admin" role on project "${targetPid}".`);
      }

      if (firestoreDbId) {
        console.warn(`[Firebase Admin] Trying fallback to (default) database...`);
        try {
          const fallbackDb = getFirestore(app);
          await fallbackDb.collection("_connection_test_").doc("ping").get();
          console.log(`[Firebase Admin] Fallback successful! Updating current db instance.`);
          dbInstance = fallbackDb;
        } catch (fallbackErr: any) {
          console.error(`[Firebase Admin] Fallback also failed: ${fallbackErr.message}`);
        }
      }
    }
}

// Run test connection asynchronously only if requested or in heavy debug
// testConnection().catch(() => {});


// 6. Validar token do usuário corretamente
export async function verifyAuth(req: VercelRequest): Promise<{ uid: string; email?: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return null;
  }

  try {
    const authInstance = getAuth(app);
    const decodedToken = await authInstance.verifyIdToken(token);
    console.log(`[AUTH] [VERIFY_TOKEN] [${decodedToken.uid}] [SUCCESS] Token de autenticação verificado`);
    return { uid: decodedToken.uid, email: decodedToken.email };
  } catch (error: any) {
    // Nunca aceite um token apenas por decodificar o payload: ele pode ter sido
    // forjado. A assinatura e os claims só são validados pelo Firebase Admin.
    console.warn(`[AUTH] [VERIFY_TOKEN] [ANONYMOUS] [NOTICE] Token rejeitado: ${error.message}`);
    return null;
  }
}

export { FieldValue, FieldPath, getAuth, app };

// The initialization sets exported db above

export function auth() {
  return getAuth(app);
}

const allowedCorsOrigins = new Set(
  [
    'https://invictusperformance.app.br',
    'https://www.invictusperformance.app.br',
    ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()),
  ].filter(Boolean),
);

export function cors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin;
  if (origin && allowedCorsOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    // Só origens explicitamente confiáveis recebem autorização CORS.
    if (origin && !allowedCorsOrigins.has(origin)) {
      res.status(403).end();
    } else {
      res.status(204).end();
    }
    return true;
  }
  return false;
}

// Compatibility exports
export const collection = (d: any, path: string) => d.collection(path);
export const doc = (d: any, path: string, id?: string) => id ? d.collection(path).doc(id) : d.collection(path).doc();
export const getDoc = (ref: any) => ref.get();
export const getDocs = (query: any) => query.get();
export const setDoc = (ref: any, data: any, options?: any) => ref.set(data, options);
export const updateDoc = (ref: any, data: any) => ref.update(data);
export const deleteDoc = (ref: any) => ref.delete();
export const query = (ref: any, ...constraints: any[]) => {
  let q = ref;
  for (const c of constraints) {
    if (c.type === 'where') q = q.where(c.field, c.op, c.val);
    if (c.type === 'orderBy') q = q.orderBy(c.field, c.dir);
    if (c.type === 'limit') q = q.limit(c.val);
  }
  return q;
};
export const where = (field: string, op: any, val: any) => ({ type: 'where', field, op, val });
export const orderBy = (field: string, dir: string = 'asc') => ({ type: 'orderBy', field, dir });
export const limit = (val: number) => ({ type: 'limit', val });
export const getCountFromServer = (query: any) => query.count().get();
export const serverTimestamp = () => FieldValue.serverTimestamp();
export const increment = (val: number) => FieldValue.increment(val);
export const documentId = () => FieldPath.documentId();
