import { createHash } from 'node:crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth } from '../_lib/common.js';
import { isActiveAccountState } from '../_lib/account-state.js';
import { logEvent } from '../_lib/observability.js';

const REPORT_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const REPORT_RATE_MAX = 5;

function reportRateLimitId(userId: string): string {
  return `denounce_${createHash('sha256').update(userId).digest('hex')}`;
}

function reportDocumentId(reporterUserId: string, suspectUserId: string, gymId: string, now = new Date()): string {
  const cycle = now.toISOString().slice(0, 7);
  return createHash('sha256')
    .update(`${reporterUserId}|${suspectUserId}|${gymId}|${cycle}`)
    .digest('hex');
}

async function consumeReportRateLimit(userId: string): Promise<boolean> {
  const ref = db.collection('api_rate_limits').doc(reportRateLimitId(userId));
  const now = Date.now();
  return db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const windowStartedAt = Number(data.windowStartedAt) || 0;
    const count = Math.max(0, Number(data.count) || 0);

    if (!windowStartedAt || now - windowStartedAt >= REPORT_RATE_WINDOW_MS) {
      transaction.set(ref, {
        scope: 'denounce',
        userId,
        windowStartedAt: now,
        count: 1,
        updatedAt: new Date(now).toISOString(),
      }, { merge: true });
      return true;
    }

    if (count >= REPORT_RATE_MAX) return false;
    transaction.set(ref, {
      count: count + 1,
      updatedAt: new Date(now).toISOString(),
    }, { merge: true });
    return true;
  });
}

function profileGymId(profile: any): string {
  return String(profile?.gymId || profile?.academyId || '').trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido.' });
  }

  const authUser = await verifyAuth(req);
  if (!authUser) {
    return res.status(401).json({ success: false, error: 'Sessão expirada. Entre novamente.' });
  }

  const suspectUserId = String(req.body?.suspectUserId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(suspectUserId)) {
    return res.status(400).json({ success: false, error: 'Usuário suspeito não informado.' });
  }
  if (authUser.uid === suspectUserId) {
    return res.status(400).json({ success: false, error: 'Você não pode denunciar a si mesmo.' });
  }

  try {
    if (!db) {
      return res.status(500).json({ success: false, error: 'Serviço temporariamente indisponível.' });
    }

    const reporterRef = db.collection('users').doc(authUser.uid);
    const suspectRef = db.collection('users').doc(suspectUserId);
    const reporterEnrollmentRef = db.collection('gym_ranking_enrollments').doc(authUser.uid);
    const suspectEnrollmentRef = db.collection('gym_ranking_enrollments').doc(suspectUserId);
    const [reporterSnap, suspectSnap, reporterEnrollmentSnap, suspectEnrollmentSnap] = await Promise.all([
      reporterRef.get(),
      suspectRef.get(),
      reporterEnrollmentRef.get(),
      suspectEnrollmentRef.get(),
    ]);

    if (!reporterSnap.exists || !isActiveAccountState(reporterSnap.data())) {
      return res.status(403).json({ success: false, error: 'Sua conta não está elegível para esta ação.' });
    }
    if (!suspectSnap.exists || !isActiveAccountState(suspectSnap.data())) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
    }

    const reporter = reporterSnap.data() || {};
    const suspect = suspectSnap.data() || {};
    const reporterEnrollment = reporterEnrollmentSnap.exists ? reporterEnrollmentSnap.data() || {} : {};
    const suspectEnrollment = suspectEnrollmentSnap.exists ? suspectEnrollmentSnap.data() || {} : {};
    const reporterGymId = profileGymId(reporter);
    const suspectGymId = profileGymId(suspect);
    const reporterRankingGymId = String(reporterEnrollment.gymId || '').trim();
    const suspectRankingGymId = String(suspectEnrollment.gymId || '').trim();

    const sameActiveRanking = reporterEnrollment.enrolled === true
      && suspectEnrollment.enrolled === true
      && reporterGymId
      && reporterGymId === suspectGymId
      && reporterRankingGymId === reporterGymId
      && suspectRankingGymId === reporterGymId;

    if (!sameActiveRanking) {
      return res.status(403).json({
        success: false,
        error: 'Denúncias competitivas só podem ser feitas entre atletas do mesmo ranking ativo.',
      });
    }

    if (!await consumeReportRateLimit(authUser.uid)) {
      return res.status(429).json({
        success: false,
        error: 'Limite de denúncias atingido. Aguarde antes de enviar uma nova denúncia.',
      });
    }

    const now = new Date();
    const denounceRef = db.collection('denunciations').doc(
      reportDocumentId(authUser.uid, suspectUserId, reporterGymId, now),
    );

    const created = await db.runTransaction(async (transaction: any) => {
      const existing = await transaction.get(denounceRef);
      if (existing.exists) return false;
      transaction.create(denounceRef, {
        id: denounceRef.id,
        reporterUserId: authUser.uid,
        suspectUserId,
        suspectDisplayName: suspect.displayName || suspect.name || 'Atleta',
        gymId: reporterGymId,
        rankingEnrollmentEpoch: suspectEnrollment.enrolledAt || null,
        createdAt: now.toISOString(),
        status: 'pending',
        reviewRequired: true,
        automaticPenaltyApplied: false,
      });
      return true;
    });

    if (!created) {
      return res.status(409).json({
        success: false,
        error: 'Você já enviou uma denúncia para este atleta neste período. Aguarde a revisão.',
      });
    }

    const logId = db.collection('fraud_audit_logs').doc().id;
    await db.collection('fraud_audit_logs').doc(logId).set({
      id: logId,
      userId: suspectUserId,
      displayName: suspect.displayName || suspect.name || 'Competidor',
      type: 'user_reported',
      fraudFlags: ['USER_REPORT_PENDING_REVIEW'],
      trustLevel: 'unverified_report',
      severity: 'WARNING',
      actionTaken: 'queued_for_review',
      denunciationId: denounceRef.id,
      createdAt: now.toISOString(),
      timestamp: now.toISOString(),
      reviewStatus: 'pending',
    });

    await logEvent({
      severity: 'WARNING',
      category: 'fraud_audit_logs',
      message: `Denúncia competitiva recebida e enviada para revisão (alvo: ${suspectUserId}).`,
      userId: authUser.uid,
      route: '/api/denounce',
      details: { suspectUserId, gymId: reporterGymId, denunciationId: denounceRef.id },
    });

    return res.status(201).json({
      success: true,
      reviewStatus: 'pending',
      message: 'Denúncia registrada. Ela será analisada antes de qualquer impacto competitivo.',
    });
  } catch (error: any) {
    console.error('Denounce error:', error);
    return res.status(500).json({ success: false, error: 'Ocorreu um erro ao enviar a denúncia.' });
  }
}
