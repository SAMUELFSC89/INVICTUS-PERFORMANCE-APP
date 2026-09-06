import { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'crypto';
import { cors, db } from '../_lib/common.js';
import { SecurityPipeline } from '../_lib/security-pipeline.js';
import { buscarHistoricoRecente } from '../_lib/user-activity-history.js';
import { resolveModality } from '../_lib/modality-config.js';
import { recalculateAllUserScores } from '../_lib/igaService.js';
import { syncReviewedActivityCompetitionScores } from '../_lib/championship-scoring-service.js';
import { classifyPendingReview, resolveSecurityRetryResult } from '../_lib/pending-review-policy.js';

function numberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function reviewReason(workout: Record<string, any>): string {
  return String(workout.nonScoringReason || workout.rejectionReason || 'AUTO_REVIEW_RESOLVED');
}

async function finalizeCompetitionReview(params: {
  doc: FirebaseFirestore.QueryDocumentSnapshot;
  workout: Record<string, any>;
  status: 'approved' | 'rejected' | 'ineligible';
  reason?: string | null;
  security?: {
    decision?: string | null;
    riskScore?: number | null;
    reportId?: string | null;
  };
}) {
  const { doc, workout, status, security } = params;
  const approved = status === 'approved';
  const competitionPoints = approved
    ? Math.max(0, numberOrZero(workout.activityXpAwarded ?? workout.scoreAwarded ?? workout.points))
    : 0;
  const reason = approved ? null : (params.reason || reviewReason(workout));
  const now = new Date().toISOString();
  const entriesSnap = await db.collection('activity_competition_entries')
    .where('activityId', '==', doc.id)
    .get();

  const batch = db.batch();
  batch.set(doc.ref, {
    status: 'completed',
    validationStatus: approved ? 'validated' : status === 'ineligible' ? 'not_eligible' : 'rejected',
    competitionReviewStatus: status,
    competitionStatus: status,
    competitionPoints,
    isScoringEligible: approved,
    pendingReview: false,
    nonScoringReason: reason,
    rejectionReason: reason,
    processingStatus: 'complete',
    autoReviewResolvedAt: now,
    autoReviewResolution: status,
    ...(security ? {
      securityReviewApplied: true,
      securityDecision: security.decision ?? workout.securityDecision ?? null,
      securityRiskScore: Number.isFinite(Number(security.riskScore)) ? Number(security.riskScore) : null,
      securityReportId: security.reportId ?? workout.securityReportId ?? null,
    } : {}),
    updatedAt: now,
  }, { merge: true });

  entriesSnap.docs.forEach((entry) => {
    batch.set(entry.ref, {
      reviewStatus: status,
      competitionPoints,
      reasonCode: reason,
      autoReviewedAt: now,
      updatedAt: now,
    }, { merge: true });
  });
  await batch.commit();

  await Promise.all([
    syncReviewedActivityCompetitionScores(doc.id),
    recalculateAllUserScores(String(workout.userId || '')),
  ]);
}

async function retrySecurityPipeline(doc: FirebaseFirestore.QueryDocumentSnapshot, workout: Record<string, any>) {
  const userId = String(workout.userId || '');
  if (!userId) throw new Error('Atividade pendente sem userId.');
  const [userSnap, history] = await Promise.all([
    db.collection('users').doc(userId).get(),
    buscarHistoricoRecente(userId),
  ]);
  const user = userSnap.data() || {};
  const modality = resolveModality(workout);
  const contexts = Array.isArray(workout.competitionContexts) ? workout.competitionContexts : [];
  const requiresMotionEvidence = contexts.some((context: any) => context?.requiresMotionSensors === true);
  const checkpoints = Array.isArray(workout.trajectory)
    ? workout.trajectory
    : Array.isArray(workout.checkpoints) ? workout.checkpoints : [];

  const result = await SecurityPipeline.runPipeline({
    id: doc.id,
    activityType: modality?.antiFraudProfile || String(workout.type || 'WORKOUT').toUpperCase(),
    type: String(workout.type || 'WORKOUT').toUpperCase(),
    muscleGroup: workout.muscleGroup,
    cardioType: workout.cardioType,
    durationMins: numberOrZero(workout.duration ?? workout.durationMins),
    distanceKm: numberOrZero(workout.distance ?? workout.distanceKm),
    checkpoints,
    timestamp: workout.startTime || workout.createdAt || new Date().toISOString(),
    source: 'UNIFIED_ACTIVITY_ENGINE',
    avgHeartRate: workout.avgHeartRate ?? workout.healthTelemetry?.avgHeartRate,
    steps: workout.steps ?? workout.pedometerSteps ?? workout.healthTelemetry?.steps ?? workout.evidence?.steps,
    calories: workout.calories,
    smartwatchData: workout.smartwatchData,
    healthTelemetry: workout.healthTelemetry,
    metricSources: workout.metricSources,
    sensorTelemetry: workout.sensorTelemetry,
    requiresMotionEvidence,
    isMockLocation: workout.isMockLocation,
    isEmulator: workout.isEmulator,
    isRooted: workout.isRooted,
    isDeveloperMode: workout.isDeveloperMode,
  }, userId, user, history);

  const resolution = resolveSecurityRetryResult({
    decision: result.decision,
    competitivelyEligible: result.report.validation.competitivelyEligible !== false,
  });
  const security = {
    decision: result.decision,
    riskScore: numberOrZero(result.report.risk?.riskScore),
    reportId: result.report.activityId || doc.id,
  };

  if (resolution === 'pending_review') {
    const now = new Date().toISOString();
    await doc.ref.set({
      securityReviewApplied: true,
      securityDecision: result.decision,
      securityRiskScore: security.riskScore,
      securityReportId: security.reportId,
      nonScoringReason: `SECURITY_PIPELINE_${result.decision}`,
      rejectionReason: `SECURITY_PIPELINE_${result.decision}`,
      pendingReview: true,
      technicalRetryCount: numberOrZero(workout.technicalRetryCount) + 1,
      technicalRetryAt: now,
      updatedAt: now,
    }, { merge: true });
    return { resolved: false, becameManual: true };
  }

  await finalizeCompetitionReview({
    doc,
    workout,
    status: resolution,
    reason: resolution === 'approved'
      ? null
      : result.report.validation.ineligibleReason || `SECURITY_PIPELINE_${result.decision}`,
    security,
  });
  return { resolved: true, becameManual: false };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  // Vercel Cron dispara GET com Authorization: Bearer <CRON_SECRET>; POST é
  // aceito para execução manual autenticada.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[FRAUD_AUDIT] CRON_SECRET não configurado; auditoria recusada.');
    return res.status(503).json({ success: false, message: 'Serviço temporariamente indisponível.' });
  }

  const authHeader = req.headers['authorization'];
  const customSecretHeader = req.headers['x-cron-secret'];
  const rawAuthorization = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const rawCustomSecret = Array.isArray(customSecretHeader) ? customSecretHeader[0] : customSecretHeader;
  const providedSecret = rawAuthorization?.startsWith('Bearer ')
    ? rawAuthorization.slice(7).trim()
    : (rawCustomSecret || rawAuthorization || '').trim();

  const secretMatches = providedSecret.length === cronSecret.length
    && timingSafeEqual(Buffer.from(providedSecret), Buffer.from(cronSecret));
  if (!secretMatches) {
    return res.status(401).json({ success: false, message: 'Não autorizado.' });
  }

  try {
    const [recordsSnap, auditLogsSnap, pendingSnap] = await Promise.all([
      db.collection('power_records').get(),
      db.collection('power_audit_logs').get(),
      db.collection('workouts').where('pendingReview', '==', true).limit(100).get(),
    ]);
    const auditLogs: any[] = [];
    auditLogsSnap.forEach(doc => auditLogs.push({ id: doc.id, ...doc.data() }));

    let checked = 0;
    let corrected = 0;
    const correctedIds: string[] = [];

    for (const doc of recordsSnap.docs) {
      const record: any = { id: doc.id, ...doc.data() };
      if (record.videoStatus !== 'approved') continue;
      checked++;

      const hasValidLog = auditLogs.some(log =>
        log.userId === record.userId &&
        log.result === 'VALIDADO' &&
        Number(log.confidence) >= 95 &&
        (!log.exercise || log.exercise === record.exercise) &&
        (!record.videoUrl || !log.videoUrl || log.videoUrl === record.videoUrl)
      );

      if (!hasValidLog) {
        corrected++;
        correctedIds.push(record.id);
        await db.collection('power_records').doc(record.id).update({
          videoStatus: 'rejected',
          rejectionReason: 'Auditoria periodica: sem log VALIDADO com confidence >= 95 correspondente.',
          autoAuditedAt: new Date().toISOString()
        });
      }
    }

    let pendingChecked = 0;
    let pendingResolved = 0;
    let securityRetried = 0;
    let manualReview = 0;
    let technicalPending = 0;
    const resolvedPendingIds: string[] = [];

    for (const doc of pendingSnap.docs) {
      pendingChecked++;
      const workout: any = { id: doc.id, ...doc.data() };
      const action = classifyPendingReview(workout);
      try {
        if (action === 'reject' || action === 'ineligible') {
          await finalizeCompetitionReview({
            doc,
            workout,
            status: action === 'reject' ? 'rejected' : 'ineligible',
            reason: reviewReason(workout),
          });
          pendingResolved++;
          resolvedPendingIds.push(doc.id);
          continue;
        }
        if (action === 'retry_security') {
          securityRetried++;
          const result = await retrySecurityPipeline(doc, workout);
          if (result.resolved) {
            pendingResolved++;
            resolvedPendingIds.push(doc.id);
          } else if (result.becameManual) {
            manualReview++;
          }
          continue;
        }
        if (action === 'technical_pending') {
          technicalPending++;
          continue;
        }
        manualReview++;
      } catch (error: any) {
        technicalPending++;
        const now = new Date().toISOString();
        await doc.ref.set({
          technicalRetryCount: numberOrZero(workout.technicalRetryCount) + 1,
          technicalRetryAt: now,
          technicalRetryLastError: String(error?.message || 'Falha técnica na reconciliação').slice(0, 300),
          updatedAt: now,
        }, { merge: true }).catch(() => undefined);
        console.error(`[FRAUD_AUDIT] Falha ao reconciliar ${doc.id}:`, error);
      }
    }

    await db.collection('fraud_audit_runs').add({
      runAt: new Date().toISOString(),
      recordsChecked: checked,
      recordsCorrected: corrected,
      correctedIds,
      pendingChecked,
      pendingResolved,
      resolvedPendingIds,
      securityRetried,
      manualReview,
      technicalPending,
    });

    return res.status(200).json({
      success: true,
      recordsChecked: checked,
      recordsCorrected: corrected,
      correctedIds,
      pendingChecked,
      pendingResolved,
      resolvedPendingIds,
      securityRetried,
      manualReview,
      technicalPending,
    });
  } catch (error: any) {
    console.error('[FRAUD_AUDIT] Error running periodic audit:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao executar auditoria.' });
  }
}
