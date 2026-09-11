import { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue, cors, db, verifyAuth } from '../_lib/common.js';

const SOURCES = {
  workout: 'workouts',
  checkin: 'gym_checkins',
  power: 'power_records',
} as const;
const CATEGORIES = new Set(['activity', 'heart_rate', 'discarded_samples', 'validation', 'score', 'ranking', 'technical_failure']);

export function buildCompetitionReviewAuditSnapshot(data: Record<string, any>) {
  const heartRate = data.healthSession?.heartRate || data.heartRateEvidence || data.heartRateAudit || {};
  const samples = Array.isArray(heartRate.samples) ? heartRate.samples : [];
  const audit = heartRate.audit || data.heartRateAudit || {};
  const rawDiscardReasons = audit.discardedReasons ?? audit.discardReasons;
  const discardReasons = Array.isArray(rawDiscardReasons)
    ? rawDiscardReasons.slice(0, 20).map(String)
    : rawDiscardReasons && typeof rawDiscardReasons === 'object'
      ? Object.entries(rawDiscardReasons).slice(0, 20).map(([reason, count]) => `${reason}: ${Number(count) || 0}`)
      : [];
  return {
    source: heartRate.source || data.metricSources?.heartRate || data.healthTelemetry?.source || null,
    startedAt: data.startTime || data.startedAt || null,
    endedAt: data.endTime || data.endedAt || null,
    heartRateWindow: { startedAt: heartRate.startedAt || null, endedAt: heartRate.endedAt || null },
    receivedSamples: Number.isFinite(Number(audit.receivedSampleCount ?? audit.receivedSamples)) ? Number(audit.receivedSampleCount ?? audit.receivedSamples) : samples.length,
    acceptedSamples: Number.isFinite(Number(audit.validSampleCount ?? audit.acceptedSamples)) ? Number(audit.validSampleCount ?? audit.acceptedSamples) : null,
    discardedSamples: Number.isFinite(Number(audit.discardedSampleCount ?? audit.discardedSamples ?? data.healthSession?.integrity?.discardedHeartRateSamples)) ? Number(audit.discardedSampleCount ?? audit.discardedSamples ?? data.healthSession?.integrity?.discardedHeartRateSamples) : null,
    discardReasons,
    coverage: audit.coveragePercent ?? audit.coverage ?? heartRate.coverage ?? null,
    largestGapSeconds: audit.largestGapSeconds ?? heartRate.largestGapSeconds ?? null,
    quality: audit.quality ?? data.healthSessionStatus ?? data.dataQualityStatus ?? null,
    integrityId: audit.integrityHash ?? audit.seriesHash ?? data.securityReportId ?? data.activityFingerprint ?? null,
    algorithmVersion: data.algorithmVersion ?? data.igaVersion ?? data.validationVersion ?? null,
    competitionRulesVersion: data.competitionRulesVersion ?? data.competitionPolicy?.version ?? null,
    validationStatus: data.validationStatus ?? data.status ?? null,
    nonScoringReason: data.nonScoringReason ?? data.rejectionReason ?? null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });
  if (!db) return res.status(500).json({ error: 'Banco de dados indisponível.' });

  const source = String(req.body?.source || '') as keyof typeof SOURCES;
  const subjectId = String(req.body?.subjectId || '').trim();
  const category = String(req.body?.category || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!SOURCES[source] || !subjectId || subjectId.length > 200 || !CATEGORIES.has(category) || reason.length < 10 || reason.length > 1500) {
    return res.status(400).json({ error: 'Informe a atividade, o tipo de contestação e uma descrição entre 10 e 1.500 caracteres.' });
  }

  const sourceSnapshot = await db.collection(SOURCES[source]).doc(subjectId).get();
  if (!sourceSnapshot.exists) return res.status(404).json({ error: 'Atividade não encontrada.' });
  const sourceData = sourceSnapshot.data() || {};
  if (sourceData.userId !== auth.uid) return res.status(403).json({ error: 'Esta atividade pertence a outra conta.' });

  const ref = db.collection('competition_review_requests').doc();
  await ref.create({
    requestId: ref.id,
    userId: auth.uid,
    subjectType: source,
    subjectId,
    category,
    reason,
    status: 'submitted',
    auditSnapshot: buildCompetitionReviewAuditSnapshot(sourceData),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return res.status(201).json({ requestId: ref.id, status: 'submitted', message: 'Contestação registrada para análise. O resultado não é alterado automaticamente.' });
}
