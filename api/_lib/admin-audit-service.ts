import { db } from './common.js';
import { SECURITY_CONFIG } from './security-config.js';
import { calculateAllUserScores, recalculateAllUserScores } from './igaService.js';
import {
  DEFAULT_FREQUENCY_CONFIG,
  DEFAULT_TIME_CONFIG,
  DEFAULT_INTENSITY_CONFIG,
} from '../../src/core/iga/normalizers.js';
import { logEvent } from './observability.js';
import { publishAdminRealtimeSignalSafe } from './admin-realtime.js';

const PIPELINE_ORDER = [
  'Validation',
  'Integrity',
  'Behavior',
  'Device Fingerprint',
  'Network',
  'Fraud',
  'Reputation',
  'Trust',
  'Risk',
  'Explainability',
] as const;

function safeLimit(value: unknown, fallback = 100, max = 250): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, parsed)) : fallback;
}

function serializeDocument(document: any) {
  return { id: document.id, ...document.data() };
}

function scoreDrift(persisted: unknown, expected: unknown) {
  const persistedValue = Number(persisted || 0);
  const expectedValue = Number(expected || 0);
  const difference = Number((persistedValue - expectedValue).toFixed(6));
  return {
    persisted: persistedValue,
    expected: expectedValue,
    difference,
    matches: Math.abs(difference) < 0.000001,
  };
}

async function queryByActivity(collectionName: string, activityId: string, limit = 50) {
  try {
    const snapshot = await db.collection(collectionName)
      .where('activityId', '==', activityId)
      .limit(limit)
      .get();
    return snapshot.docs.map(serializeDocument);
  } catch (error: any) {
    console.warn(`[Admin audit] Falha ao consultar ${collectionName}:`, error?.message || error);
    return [];
  }
}

async function readDirectDocument(collectionName: string, documentId: string) {
  try {
    const snapshot = await db.collection(collectionName).doc(documentId).get();
    return snapshot.exists ? serializeDocument(snapshot) : null;
  } catch (error: any) {
    console.warn(`[Admin audit] Falha ao ler ${collectionName}/${documentId}:`, error?.message || error);
    return null;
  }
}

async function calculateIgaPreview(userId: string) {
  try {
    return { result: await calculateAllUserScores(userId), error: null };
  } catch (error: any) {
    console.warn(`[Admin audit] Falha no dry-run IGA de ${userId}:`, error?.message || error);
    return { result: null, error: String(error?.message || 'Falha ao recalcular IGA em modo de auditoria.') };
  }
}

export function getAuditEngineCatalog() {
  return {
    generatedAt: new Date().toISOString(),
    security: {
      engineVersion: SECURITY_CONFIG.engineVersion,
      ruleVersion: SECURITY_CONFIG.ruleVersion,
      pipelineVersion: '3.1.0',
      order: PIPELINE_ORDER,
      engines: {
        validation: { version: '2.0.0', purpose: 'Valida estrutura, duração, fonte, GPS e requisitos básicos da atividade.' },
        integrity: { version: '2.0.0', purpose: 'Mede integridade de GPS, frequência cardíaca, movimento, tempo e sensores.' },
        behavior: { version: '1.0.0', purpose: 'Compara a atividade com o padrão estatístico recente do atleta.' },
        deviceFingerprint: { version: '1.0.0', purpose: 'Analisa impressão do dispositivo e sinais de ambiente adulterado.' },
        network: { version: '1.0.0', purpose: 'Avalia risco de rede, proxy/VPN/Tor e inconsistências de acesso.' },
        fraud: { version: '2.0.0', purpose: 'Consolida evidências de GPS, dispositivo, sensores, foto e plausibilidade física.' },
        reputation: { version: '1.0.0', purpose: 'Calcula reputação histórica permanente do atleta.' },
        trust: { version: '1.0.0', purpose: 'Sintetiza confiança usando reputação, integridade, comportamento, aparelho, rede e fonte.' },
        risk: { version: '2.0.0', purpose: 'Transforma evidências em risco e decisão automática.' },
        explainability: { version: '1.0.0', purpose: 'Explica os principais fatores que produziram a decisão.' },
      },
      thresholds: SECURITY_CONFIG,
      authoritativeCollections: ['security_reports', 'security_audit_log', 'user_trust_profiles', 'admin_reviews'],
    },
    iga: {
      formulaVersion: 'IGA-2.0',
      formula: '100 × ∛(Fn × Tn × In)',
      rules: {
        frequency: 'No máximo 5 melhores sessões válidas por semana.',
        time: 'Qualidade de duração por sessão, com retorno decrescente; musculação mínimo 30 min e cardio mínimo 20 min.',
        intensity: 'Usa frequência cardíaca medida. Sem FC medida confiável, intensidade = 0.',
        calories: 'Somente auditoria/telemetria; não alteram o IGA.',
        scoringGate: 'Somente atividade competitiva homologada e elegível entra no ranking.',
        windows: 'Semana usa o IGA semanal; mês e temporada são médias das semanas para não distorcer frequência.',
        auditMode: 'O Admin pode recalcular em dry-run e comparar esperado x persistido sem alterar a pontuação.',
      },
      frequencyConfig: DEFAULT_FREQUENCY_CONFIG,
      timeConfig: DEFAULT_TIME_CONFIG,
      intensityConfig: DEFAULT_INTENSITY_CONFIG,
      persistedFields: ['weeklyScore', 'monthlyScore', 'score', 'igaAudit', 'igaAuditMonthly', 'igaAuditSeason'],
    },
    scoring: {
      gymRanking: {
        engine: 'IGA-2.0',
        source: 'workouts + trusted competition evidence',
        gate: 'competitionReviewStatus=approved, isScoringEligible=true e época atual de adesão à academia.',
      },
      paidChampionships: {
        source: 'championship_scores + activity_competition_entries',
        activityGate: 'Somente atividades homologadas e aprovadas pelo contexto competitivo da edição.',
        aggregation: 'Soma os scores validados da edição por atleta.',
        tieBreak: ['maior score total', 'mais atividades válidas', 'mais minutos válidos', 'atingiu o score final primeiro'],
        finalization: 'Empate técnico material em posição premiada bloqueia settlement para revisão; não há vencedor arbitrário.',
      },
      powerLift: {
        source: 'power_records',
        gate: 'Somente vídeo homologado com videoStatus=approved.',
        ranking: 'Melhor carga aprovada por atleta e exercício; registros pendentes ou rejeitados não entram.',
      },
      activityRewards: {
        source: 'activity_reward_ledger',
        rule: 'Crédito idempotente por activityId; a atividade precisa passar pela elegibilidade econômica canônica.',
      },
    },
    evidence: {
      canonicalActivity: 'workouts',
      competitionProjection: 'activity_competition_entries',
      championshipProjection: 'championship_scores',
      securityDecision: 'security_reports',
      immutableSecurityLog: 'security_audit_log',
      humanReview: 'admin_reviews',
      igaSnapshot: 'users.igaAudit / igaAuditMonthly / igaAuditSeason',
      rewardLedger: 'activity_reward_ledger',
    },
  };
}

export async function listSecurityReports(limitInput?: unknown, decision?: string) {
  const limit = safeLimit(limitInput);
  let snapshot;
  try {
    let query: any = db.collection('security_reports').orderBy('timestamp', 'desc');
    if (decision) query = query.where('decision', '==', decision);
    snapshot = await query.limit(limit).get();
  } catch {
    let query: any = db.collection('security_reports');
    if (decision) query = query.where('decision', '==', decision);
    snapshot = await query.limit(limit).get();
  }

  const reports = snapshot.docs.map((document: any) => {
    const data = document.data() || {};
    return {
      id: document.id,
      activityId: data.activityId || document.id,
      userId: data.userId || '',
      activityType: data.activityType || '',
      decision: data.decision || data.risk?.automaticDecision || '',
      riskScore: Number(data.risk?.riskScore ?? data.riskScore ?? 0),
      riskLevel: data.risk?.riskLevel || '',
      integrityScore: Number(data.integrity?.integrityScore ?? 0),
      behaviorScore: Number(data.behavior?.behaviorScore ?? 0),
      trustScore: Number(data.trust?.trustScore ?? 0),
      reputationScore: Number(data.reputation?.reputationScore ?? 0),
      evidenceCount: Array.isArray(data.fraud?.evidences) ? data.fraud.evidences.length : 0,
      primaryRiskDriver: data.explanation?.primaryRiskDriver || '',
      timestamp: data.timestamp || '',
      securityVersion: data.securityVersion || '',
      pipelineVersion: data.pipelineVersion || '',
      rulesVersion: data.rulesVersion || '',
    };
  });

  return { reports, count: reports.length };
}

export async function getActivityAudit(activityId: string) {
  const normalized = String(activityId || '').trim();
  if (!normalized || normalized.length > 180) throw new Error('activityId inválido.');

  const workoutRef = db.collection('workouts').doc(normalized);
  const reportRef = db.collection('security_reports').doc(normalized);
  const [workoutSnap, reportSnap] = await Promise.all([workoutRef.get(), reportRef.get()]);
  if (!workoutSnap.exists && !reportSnap.exists) throw new Error('Atividade não encontrada na auditoria.');

  const workout = workoutSnap.exists ? serializeDocument(workoutSnap) : null;
  const securityReport = reportSnap.exists ? serializeDocument(reportSnap) : null;
  const userId = String(workout?.userId || securityReport?.userId || '').trim();

  const [
    userSnap,
    trustSnap,
    securityAudit,
    competitionEntries,
    championshipScores,
    adminReviews,
    activityRewardLedger,
    igaPreview,
  ] = await Promise.all([
    userId ? db.collection('users').doc(userId).get() : Promise.resolve(null as any),
    userId ? db.collection('user_trust_profiles').doc(userId).get() : Promise.resolve(null as any),
    queryByActivity('security_audit_log', normalized),
    queryByActivity('activity_competition_entries', normalized),
    queryByActivity('championship_scores', normalized),
    queryByActivity('admin_reviews', normalized),
    readDirectDocument('activity_reward_ledger', normalized),
    userId ? calculateIgaPreview(userId) : Promise.resolve({ result: null, error: null }),
  ]);

  const user = userSnap?.exists ? serializeDocument(userSnap) : null;
  const trustProfile = trustSnap?.exists ? serializeDocument(trustSnap) : null;
  const weeklyAudit = user?.igaAudit || null;
  const sessionAudit = Array.isArray(weeklyAudit?.topSessions)
    ? weeklyAudit.topSessions.find((entry: any) => String(entry?.sessionId || '') === normalized) || null
    : null;
  const expected = igaPreview.result;
  const drift = user && expected ? {
    weekly: scoreDrift(user.weeklyScore, expected.weekly.igaRanking),
    monthly: scoreDrift(user.monthlyScore, expected.monthly.average),
    season: scoreDrift(user.score, expected.season.average),
  } : null;

  return {
    activityId: normalized,
    generatedAt: new Date().toISOString(),
    workout,
    securityReport,
    securityAudit,
    trustProfile,
    competition: {
      entries: competitionEntries,
      championshipScores,
    },
    economy: {
      activityRewardLedger,
    },
    adminReviews,
    iga: user ? {
      persistedScores: {
        weeklyScore: Number(user.weeklyScore || 0),
        monthlyScore: Number(user.monthlyScore || 0),
        seasonScore: Number(user.score || 0),
      },
      expectedScores: expected ? {
        weeklyScore: expected.weekly.igaRanking,
        monthlyScore: expected.monthly.average,
        seasonScore: expected.season.average,
      } : null,
      drift,
      inSync: drift ? drift.weekly.matches && drift.monthly.matches && drift.season.matches : null,
      dryRunError: igaPreview.error,
      expectedAudit: expected,
      weeklyAudit,
      monthlyAudit: user.igaAuditMonthly || null,
      seasonAudit: user.igaAuditSeason || null,
      sessionAudit,
      activityIncludedInCurrentWeeklyAudit: Boolean(sessionAudit?.eligible),
    } : null,
  };
}

export async function reconcileUserIgaAsAdmin(userId: string, reviewerId: string) {
  const normalized = String(userId || '').trim();
  if (!normalized || normalized.length > 180) throw new Error('userId inválido.');
  const userRef = db.collection('users').doc(normalized);
  const beforeSnap = await userRef.get();
  if (!beforeSnap.exists) throw new Error('Usuário não encontrado.');
  const before = beforeSnap.data() || {};

  const calculated = await recalculateAllUserScores(normalized);
  const afterSnap = await userRef.get();
  const after = afterSnap.data() || {};

  await logEvent({
    severity: 'INFO',
    category: 'admin_reviews',
    message: `Administrador reconciliou a pontuação IGA canônica do usuário ${normalized}.`,
    userId: normalized,
    route: '/api/admin-audit?action=reconcile-iga',
    details: {
      reviewerId,
      before: { weeklyScore: before.weeklyScore || 0, monthlyScore: before.monthlyScore || 0, score: before.score || 0 },
      after: { weeklyScore: after.weeklyScore || 0, monthlyScore: after.monthlyScore || 0, score: after.score || 0 },
    },
  });
  publishAdminRealtimeSignalSafe({ type: 'ADMIN_CONFIG_CHANGED', source: 'admin-audit:reconcile-iga' });

  return {
    success: true,
    userId: normalized,
    before: { weeklyScore: Number(before.weeklyScore || 0), monthlyScore: Number(before.monthlyScore || 0), seasonScore: Number(before.score || 0) },
    after: { weeklyScore: Number(after.weeklyScore || 0), monthlyScore: Number(after.monthlyScore || 0), seasonScore: Number(after.score || 0) },
    calculated,
  };
}