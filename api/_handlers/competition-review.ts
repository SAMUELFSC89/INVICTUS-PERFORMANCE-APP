import { createHash } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue, cors, db, verifyAuth } from '../_lib/common.js';

const SOURCES = {
  workout: 'workouts',
  checkin: 'gym_checkins',
  power: 'power_records',
} as const;
const CATEGORIES = new Set(['activity', 'heart_rate', 'discarded_samples', 'validation', 'score', 'ranking', 'technical_failure']);
const REVIEW_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const REVIEW_RATE_MAX = 10;

function reviewRateLimitId(userId: string): string {
  return `competition_review_${createHash('sha256').update(userId).digest('hex')}`;
}

export function competitionReviewRequestId(
  userId: string,
  source: keyof typeof SOURCES,
  subjectId: string,
  category: string,
  now = new Date(),
): string {
  const day = now.toISOString().slice(0, 10);
  const digest = createHash('sha256')
    .update(`${userId}|${source}|${subjectId}|${category}|${day}`)
    .digest('hex');
  return `review_${digest}`;
}

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

  const now = new Date();
  const nowMs = now.getTime();
  const ref = db.collection('competition_review_requests').doc(
    competitionReviewRequestId(auth.uid, source, subjectId, category, now),
  );
  const rateRef = db.collection('api_rate_limits').doc(reviewRateLimitId(auth.uid));

  const result = await db.runTransaction(async (transaction: any) => {
    const [existing, rateSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(rateRef),
    ]);

    if (existing.exists) {
      const data = existing.data() || {};
      return {
        created: false,
        rateLimited: false,
        requestId: ref.id,
        status: String(data.status || 'submitted'),
        retryAfterSeconds: 0,
      };
    }

    const rate = rateSnapshot.exists ? rateSnapshot.data() || {} : {};
    const windowStartedAt = Number(rate.windowStartedAt) || 0;
    const inCurrentWindow = windowStartedAt > 0 && nowMs - windowStartedAt < REVIEW_RATE_WINDOW_MS;
    const count = inCurrentWindow ? Math.max(0, Number(rate.count) || 0) : 0;

    if (count >= REVIEW_RATE_MAX) {
      const retryAfterSeconds = Math.max(1, Math.ceil((REVIEW_RATE_WINDOW_MS - (nowMs - windowStartedAt)) / 1000));
      return { created: false, rateLimited: true, requestId: ref.id, status: 'rate_limited', retryAfterSeconds };
    }

    transaction.set(rateRef, {
      scope: 'competition-review',
      windowStartedAt: inCurrentWindow ? windowStartedAt : nowMs,
      count: count + 1,
      updatedAt: now.toISOString(),
    }, { merge: true });

    transaction.create(ref, {
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

    return { created: true, rateLimited: false, requestId: ref.id, status: 'submitted', retryAfterSeconds: 0 };
  });

  if (result.rateLimited) {
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    return res.status(429).json({
      error: 'Limite de contestações atingido. Aguarde antes de enviar uma nova solicitação.',
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }

  return res.status(result.created ? 201 : 200).json({
    requestId: result.requestId,
    status: result.status,
    idempotent: !result.created,
    message: result.created
      ? 'Contestação registrada para análise. O resultado não é alterado automaticamente.'
      : 'Esta contestação já foi registrada hoje e continua na fila de análise.',
  });
}
