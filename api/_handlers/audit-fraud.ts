import { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../_lib/common.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(401).json({ success: false, message: 'CRON_SECRET not configured on server' });
  }

  const authHeader = req.headers['authorization'];
  const customSecretHeader = req.headers['x-cron-secret'];
  const providedSecret = authHeader?.startsWith('Bearer ') 
    ? authHeader.slice(7).trim() 
    : ((customSecretHeader as string) || (authHeader as string) || '').trim();

  if (!providedSecret || providedSecret !== cronSecret) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Invalid or missing secret header' });
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
    return res.status(500).json({ success: false, message: error?.message || 'Internal error' });
  }
}

                                                                                                                                  