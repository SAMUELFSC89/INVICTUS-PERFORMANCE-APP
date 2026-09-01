import { db } from './common.js';
import type { HealthProvenance } from './health-confidence-engine.js';

export interface UserDeclaredHealthDevice {
  id: string;
  userId: string;
  integration: 'APPLE_HEALTH' | 'HEALTH_CONNECT';
  dataOrigin?: string;
  brand: string;
  model: string;
  generation?: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'active' | 'closed';
  createdAt: string;
}

export const FALLBACK_DEVICE_CATALOG = [
  { brand: 'Apple', family: 'Apple Watch', models: ['Apple Watch', 'Não sei meu modelo'] },
  { brand: 'Samsung', family: 'Galaxy Watch', models: ['Galaxy Watch', 'Não sei meu modelo'] },
  { brand: 'Google', family: 'Pixel Watch', models: ['Pixel Watch', 'Não sei meu modelo'] },
  { brand: 'Garmin', family: 'Garmin', models: ['Garmin', 'Não sei meu modelo'] },
  { brand: 'Fitbit', family: 'Fitbit', models: ['Fitbit', 'Não sei meu modelo'] },
  { brand: 'Xiaomi', family: 'Xiaomi', models: ['Xiaomi Watch / Band', 'Não sei meu modelo'] },
  { brand: 'Huawei', family: 'Huawei', models: ['Huawei Watch / Band', 'Não sei meu modelo'] },
  { brand: 'Outro', family: 'Outro dispositivo', models: ['Não sei meu modelo'] }
];

export async function getDeviceCatalog() {
  try {
    const snapshot = await db.collection('health_device_catalog').where('status', '==', 'active').get();
    const remote = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return remote.length ? remote : FALLBACK_DEVICE_CATALOG;
  } catch {
    return FALLBACK_DEVICE_CATALOG;
  }
}

export async function declareUserDevice(input: Omit<UserDeclaredHealthDevice, 'id' | 'effectiveTo' | 'status' | 'createdAt'>): Promise<UserDeclaredHealthDevice> {
  const now = new Date().toISOString();
  const collection = db.collection('health_user_device_declarations');
  const active = await collection.where('userId', '==', input.userId).where('status', '==', 'active').get();
  const batch = db.batch();
  for (const doc of active.docs) {
    const data = doc.data() as UserDeclaredHealthDevice;
    if (data.integration === input.integration && (data.dataOrigin || '') === (input.dataOrigin || '')) {
      batch.set(doc.ref, { status: 'closed', effectiveTo: now }, { merge: true });
    }
  }
  const ref = collection.doc();
  const declaration: UserDeclaredHealthDevice = { ...input, id: ref.id, effectiveTo: null, status: 'active', createdAt: now };
  batch.set(ref, declaration);
  await batch.commit();
  return declaration;
}

export async function applyUserDeclaredDevice(userId: string, provenance: HealthProvenance, timestamp: string): Promise<HealthProvenance> {
  if (provenance.status === 'VERIFIED_DEVICE') return provenance;
  try {
    return applyUserDeclaredDeviceFromList(provenance, timestamp, await getUserDeviceDeclarations(userId));
  } catch {
    return provenance;
  }
}

export async function getUserDeviceDeclarations(userId: string): Promise<UserDeclaredHealthDevice[]> {
  const snapshot = await db.collection('health_user_device_declarations').where('userId', '==', userId).get();
  return snapshot.docs.map((doc) => doc.data() as UserDeclaredHealthDevice);
}

/** Aplica uma declaração já carregada. A sincronização usa esta versão para
 * fazer uma única leitura do Firestore por lote, e não uma consulta por amostra. */
export function applyUserDeclaredDeviceFromList(
  provenance: HealthProvenance,
  timestamp: string,
  declarations: UserDeclaredHealthDevice[]
): HealthProvenance {
  // Metadado técnico tem precedência e nunca é sobrescrito por declaração manual.
  if (provenance.status === 'VERIFIED_DEVICE') return provenance;
  const at = new Date(timestamp).getTime();
  const match = declarations.filter((item) =>
    item.integration === provenance.integration
    && (!item.dataOrigin || !provenance.dataOrigin || item.dataOrigin === provenance.dataOrigin)
    && new Date(item.effectiveFrom).getTime() <= at
    && (!item.effectiveTo || at <= new Date(item.effectiveTo).getTime())
  ).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (!match) return provenance;
  return {
    ...provenance,
    deviceManufacturer: match.brand,
    deviceModel: match.model,
    deviceName: [match.brand, match.model, match.generation].filter(Boolean).join(' '),
    status: 'USER_DECLARED_DEVICE'
  };
}
