import { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'crypto';
import { cors, db } from '../_lib/common.js';
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
    const recordsSnap = await db.collection('power_records').get();
    const auditLogsSnap = await db.collection('power_audit_logs').get();
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

    await db.collection('fraud_audit_runs').add({
      runAt: new Date().toISOString(),
      recordsChecked: checked,
      recordsCorrected: corrected,
      correctedIds
    });

    return res.status(200).json({
      success: true,
      recordsChecked: checked,
      recordsCorrected: corrected,
      correctedIds
    });
  } catch (error: any) {
    console.error('[FRAUD_AUDIT] Error running periodic audit:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao executar auditoria.' });
  }
}
