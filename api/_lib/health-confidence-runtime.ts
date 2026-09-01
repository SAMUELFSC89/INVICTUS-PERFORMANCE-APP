import { db } from './common.js';
import { ConfidenceEngineConfig, DEFAULT_CONFIDENCE_CONFIG, DEFAULT_EVIDENCE_REGISTRY, HealthEvidenceEntry } from './health-evidence-registry.js';

type Runtime = { config: ConfidenceEngineConfig; registry: HealthEvidenceEntry[] };
let cache: { value: Runtime; expiresAt: number } | null = null;
let pending: Promise<Runtime> | null = null;
const CACHE_MS = 5 * 60 * 1000;

/** Configuração backend cacheada: nenhuma consulta científica remota ocorre por datapoint. */
export async function loadHealthConfidenceRuntime(): Promise<Runtime> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  if (pending) return pending;
  pending = (async () => { try {
    const [configDoc, evidenceSnapshot] = await Promise.all([
      db.collection('health_confidence_config').doc('current').get(),
      db.collection('health_evidence').where('status', '==', 'active').get()
    ]);
    const remote = configDoc.exists ? configDoc.data() as Partial<ConfidenceEngineConfig> : {};
    const config: ConfidenceEngineConfig = {
      ...DEFAULT_CONFIDENCE_CONFIG, ...remote,
      thresholds: { ...DEFAULT_CONFIDENCE_CONFIG.thresholds, ...(remote.thresholds || {}) },
      baseMetricScores: { ...DEFAULT_CONFIDENCE_CONFIG.baseMetricScores, ...(remote.baseMetricScores || {}) },
      contextModifiers: { ...DEFAULT_CONFIDENCE_CONFIG.contextModifiers, ...(remote.contextModifiers || {}) },
      provenanceModifiers: { ...DEFAULT_CONFIDENCE_CONFIG.provenanceModifiers, ...(remote.provenanceModifiers || {}) },
      evidenceModifiers: { ...DEFAULT_CONFIDENCE_CONFIG.evidenceModifiers, ...(remote.evidenceModifiers || {}) },
      completeness: { ...DEFAULT_CONFIDENCE_CONFIG.completeness, ...(remote.completeness || {}) }
    };
    const remoteEvidence = evidenceSnapshot.docs.map((doc) => ({ evidenceId: doc.id, ...doc.data() } as HealthEvidenceEntry));
    const value = { config, registry: remoteEvidence.length ? remoteEvidence : DEFAULT_EVIDENCE_REGISTRY };
    cache = { value, expiresAt: Date.now() + CACHE_MS };
    return value;
  } catch {
    const value = { config: DEFAULT_CONFIDENCE_CONFIG, registry: DEFAULT_EVIDENCE_REGISTRY };
    cache = { value, expiresAt: Date.now() + 30_000 };
    return value;
  } finally { pending = null; } })();
  return pending;
}

export function clearHealthConfidenceRuntimeCache(): void { cache = null; pending = null; }
