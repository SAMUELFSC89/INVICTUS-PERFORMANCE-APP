import { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'crypto';
import { cors, db } from '../_lib/common.js';
import { authMiddleware } from '../_middleware/auth.js';
import { reconcilePendingActivityReviews } from '../_lib/pending-review-reconciler.js';

function readProvidedSecret(req: VercelRequest): string {
  const authHeader = req.headers['authorization'];
  const customSecretHeader = req.headers['x-cron-secret'];
  const rawAuthorization = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const rawCustomSecret = Array.isArray(customSecretHeader) ? customSecretHeader[0] : customSecretHeader;
  return rawAuthorization?.startsWith('Bearer ')
    ? rawAuthorization.slice(7).trim()
    : (rawCustomSecret || rawAuthorization || '').trim();
}

function secretMatches(provided: string, expected: string): boolean {
  return !!provided && !!expected && provided.length === expected.length
    && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export default async function handler(req: VercelRequest & { userId?: string }, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido.' });
  }

  const cronSecret = process.env.CRON_SECRET || '';
  const cronAuthorized = secretMatches(readProvidedSecret(req), cronSecret);

  // O mesmo endpoint pode ser acionado pelo atleta para reconciliar APENAS as
  // próprias pendências. O UID vem do token Firebase verificado no servidor;
  // nunca aceitamos userId arbitrário do corpo da requisição.
  if (!cronAuthorized) {
    if (req.method !== 'POST') return res.status(401).json({ success: false, message: 'Não autorizado.' });
    if (!(await authMiddleware(req, res))) return;
    const userId = String(req.userId || '').trim();
    if (!userId) return res.status(401).json({ success: false, message: 'Sessão inválida.' });
    try {
      const pending = await reconcilePendingActivityReviews({ userId, limit: 25 });
      return res.status(200).json({
        success: true,
        scope: 'current_user',
        pendingChecked: pending.checked,
        pendingResolved: pending.resolved,
        securityRetried: pending.securityRetried,
        manualReview: pending.manualReview,
        technicalPending: pending.technicalPending,
      });
    } catch (error: any) {
      console.error('[FRAUD_AUDIT] Falha ao reconciliar fila do atleta:', error);
      return res.status(500).json({ success: false, message: 'Não foi possível atualizar as análises agora.' });
    }
  }

  try {
    const [recordsSnap, auditLogsSnap] = await Promise.all([
      db.collection('power_records').get(),
      db.collection('power_audit_logs').get(),
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

    const pending = await reconcilePendingActivityReviews({ limit: 100 });

    await db.collection('fraud_audit_runs').add({
      runAt: new Date().toISOString(),
      recordsChecked: checked,
      recordsCorrected: corrected,
      correctedIds,
      pendingChecked: pending.checked,
      pendingResolved: pending.resolved,
      resolvedPendingIds: pending.resolvedIds,
      securityRetried: pending.securityRetried,
      manualReview: pending.manualReview,
      technicalPending: pending.technicalPending,
    });

    return res.status(200).json({
      success: true,
      scope: 'cron',
      recordsChecked: checked,
      recordsCorrected: corrected,
      correctedIds,
      pendingChecked: pending.checked,
      pendingResolved: pending.resolved,
      resolvedPendingIds: pending.resolvedIds,
      securityRetried: pending.securityRetried,
      manualReview: pending.manualReview,
      technicalPending: pending.technicalPending,
    });
  } catch (error: any) {
    console.error('[FRAUD_AUDIT] Error running periodic audit:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao executar auditoria.' });
  }
}
