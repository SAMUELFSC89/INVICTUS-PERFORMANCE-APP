import 'dotenv/config';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps, getApp, App, applicationDefault, ServiceAccount } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';

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

/**
 * Credenciais de servidor nunca devem ser lidas do repositório. Em Vercel, use
 * FIREBASE_SERVICE_ACCOUNT (JSON completo) ou uma Application Default
 * Credential configurada pela própria plataforma.
 */
function loadServiceAccountFromEnvironment(): ServiceAccount | undefined {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const projectId = typeof parsed.projectId === 'string' ? parsed.projectId : typeof parsed.project_id === 'string' ? parsed.project_id : undefined;
    const clientEmail = typeof parsed.clientEmail === 'string' ? parsed.clientEmail : typeof parsed.client_email === 'string' ? parsed.client_email : undefined;
    const privateKey = typeof parsed.privateKey === 'string' ? parsed.privateKey : typeof parsed.private_key === 'string' ? parsed.private_key : undefined;

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('campos obrigatórios ausentes');
    }
    return {
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n')
    };
  } catch (error: any) {
    console.error(`[Firebase Admin] FIREBASE_SERVICE_ACCOUNT inválida: ${error?.message || 'JSON inválido'}`);
    return undefined;
  }
}

const serviceAccount = loadServiceAccountFromEnvironment();

// 2. Initialize App
let app: App;
let dbInstance: Firestore | null = null;
let initError: Error | null = null;

// Determine best Project ID
const configPid = fixProjectId(config.projectId);
const envPid = fixProjectId(process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID);

const saPid = serviceAccount?.projectId ? fixProjectId(serviceAccount.projectId) : undefined;
const primaryPid = configPid || saPid || envPid;

// Check if service account project matches current primary project
const isSaMatching = !configPid || !saPid || saPid === configPid;

const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;

try {
  if (isTestEnv && !serviceAccount?.privateKey && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const createMockDoc = (id: string = 'mock-id'): any => {
      const docObj: any = {
        id,
        exists: false,
        data: () => ({}),
        get: async () => docObj,
        set: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
        collection: (subName: string) => createMockCollection(subName)
      };
      docObj.ref = docObj;
      return docObj;
    };

    const createMockCollection = (name: string): any => {
      const collObj: any = {
        doc: (id?: string) => createMockDoc(id || `doc_${Math.random().toString(36).substring(2, 9)}`),
        add: async () => createMockDoc(),
        where: () => collObj,
        orderBy: () => collObj,
        limit: () => collObj,
        get: async () => ({ empty: true, size: 0, docs: [] })
      };
      return collObj;
    };

    dbInstance = {
      collection: (name: string) => createMockCollection(name),
      doc: (path: string) => createMockDoc(path),
      runTransaction: async (cb: any) => cb({
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: any) => {},
        update: (ref: any, data: any) => {},
        delete: (ref: any) => {}
      }),
      batch: () => ({
        set: () => {},
        update: () => {},
        delete: () => {},
        commit: async () => {}
      }),
      settings: () => {}
    } as any;
  } else {
    if (!getApps().length) {
      const options: any = {};
      if (primaryPid) options.projectId = primaryPid;
      const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || config.storageBucket;
      if (storageBucket) options.storageBucket = String(storageBucket).trim();

      if (serviceAccount?.privateKey && isSaMatching) {
        options.credential = cert(serviceAccount);
        console.log('[Firebase Admin] Inicializado com credencial de ambiente.');
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        options.credential = applicationDefault();
        console.log('[Firebase Admin] Inicializado com Application Default Credentials.');
      } else if (serviceAccount?.privateKey && !isSaMatching) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT pertence a um projeto diferente do Firebase configurado.');
      } else {
        console.warn('[Firebase Admin] Nenhuma credencial de servidor configurada; operações de banco falharão até FIREBASE_SERVICE_ACCOUNT ou ADC ser configurada.');
      }

      app = initializeApp(options);
    } else {
      app = getApp();
    }

    const firestoreDbId = config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)' 
      ? config.firestoreDatabaseId 
      : undefined;

    dbInstance = getFirestore(app, firestoreDbId);
    try {
      dbInstance.settings({ ignoreUndefinedProperties: true });
    } catch (e: any) {
      // Settings might already be set or not supported
    }
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
      throw new Error('[Firebase Connection Error] O Firestore não foi inicializado. Configure FIREBASE_SERVICE_ACCOUNT ou uma Application Default Credential no ambiente seguro.');
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

  const token = authHeader.split('Bearer ')[1];
  try {
    const authInstance = getAuth(app);
    const decodedToken = await authInstance.verifyIdToken(token);
    console.log(`[AUTH] [VERIFY_TOKEN] [${decodedToken.uid}] [SUCCESS] Token de autenticação verificado`);
    return { uid: decodedToken.uid, email: decodedToken.email };
  } catch (error: any) {
    // Nunca decodifique o payload como fallback: JWT sem verificação de
    // assinatura permite que qualquer pessoa forje uid, email e permissões.
    console.warn(`[AUTH] [VERIFY_TOKEN] [ANONYMOUS] [REJECTED] Token inválido (${error?.message || 'erro de verificação'}).`);
    return null;
  }
}

export { FieldValue, FieldPath, getAuth, app };

// The initialization sets exported db above

export function auth() {
  return getAuth(app);
}

const DEFAULT_CORS_ORIGINS = [
  'https://invictusperformance.app.br',
  'https://www.invictusperformance.app.br',
  // WebViews oficiais: Capacitor no iOS e localhost/https no Android.
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173'
];

function getCorsOrigins(): Set<string> {
  const configured = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_CORS_ORIGINS, ...configured]);
}

export function isCorsOriginAllowed(origin?: string): boolean {
  // Requisições servidor-a-servidor (webhooks, cron e app nativo fora de um
  // browser) não carregam Origin. A autenticação própria continua obrigatória.
  if (!origin) return true;
  return getCorsOrigins().has(origin);
}

export interface CorsCompatibleRequest {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
}

export interface CorsCompatibleResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): {
    json(body: unknown): unknown;
    end(): unknown;
  } | any;
}

/**
 * Aplica CORS por allowlist. Retorna true quando a resposta já foi finalizada
 * (preflight ou origem não autorizada), mantendo o contrato dos handlers.
 */
export function cors(req: CorsCompatibleRequest, res: CorsCompatibleResponse) {
  const originHeader = req.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;

  if (origin && !isCorsOriginAllowed(origin)) {
    res.status(403).json({ error: 'Origem não autorizada.' });
    return true;
  }

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-cron-secret'
  );

  if (req.method === 'OPTIONS') {
    res.status(204).end();
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
