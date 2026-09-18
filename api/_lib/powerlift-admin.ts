import { getStorage } from 'firebase-admin/storage';
import { app, db } from './common.js';
import { AppError } from '../_middleware/error.js';
import { logEvent } from './observability.js';
import { publishAdminRealtimeSignalSafe } from './admin-realtime.js';

type PowerLiftDecision = 'approved' | 'rejected';

function safeText(value: unknown, maxLength = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export async function listPowerLiftReviews(status = 'manual_review', requestedLimit = 50) {
  const allowed = new Set(['manual_review', 'approved', 'rejected']);
  const normalizedStatus = allowed.has(status) ? status : 'manual_review';
  const take = Math.min(100, Math.max(1, Math.floor(Number(requestedLimit) || 50)));

  let snapshot: any;
  try {
    snapshot = await db.collection('power_records')
      .where('videoStatus', '==', normalizedStatus)
      .orderBy('createdAt', 'desc')
      .limit(take)
      .get();
  } catch {
    snapshot = await db.collection('power_records')
      .where('videoStatus', '==', normalizedStatus)
      .limit(take)
      .get();
  }

  const records = snapshot.docs
    .map((document: any) => ({ id: document.id, ...document.data() }))
    .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map((record: any) => ({
      id: record.id,
      userId: record.userId || '',
      userName: record.userName || 'Atleta',
      userPhoto: record.userPhoto || '',
      gymId: record.gymId || '',
      gymName: record.gymName || '',
      exercise: record.exercise || '',
      weight: Number(record.weight) || 0,
      videoStatus: record.videoStatus || '',
      confidence: Number(record.confidence) || 0,
      userMessage: safeText(record.userMessage, 2000),
      motives: Array.isArray(record.motives) ? record.motives.slice(0, 10) : [],
      createdAt: record.createdAt || '',
      updatedAt: record.updatedAt || '',
      reviewedAt: record.reviewedAt || '',
      reviewedBy: record.reviewedBy || '',
    }));

  return { success: true, status: normalizedStatus, count: records.length, records };
}

export async function getPowerLiftReviewVideo(recordId: string) {
  const id = safeText(recordId, 180);
  if (!id) throw new AppError('recordId é obrigatório.', 400);

  const snapshot = await db.collection('power_records').doc(id).get();
  if (!snapshot.exists) throw new AppError('Levantamento não encontrado.', 404);
  const record = snapshot.data() || {};
  const storagePath = safeText(record.storagePath, 512);
  const expectedPrefix = `power_records/${safeText(record.userId, 128)}/`;
  if (!storagePath || !storagePath.startsWith(expectedPrefix)) {
    throw new AppError('O arquivo seguro deste levantamento não está disponível.', 409);
  }

  const expiresAtMs = Date.now() + 10 * 60 * 1000;
  const [url] = await getStorage(app).bucket().file(storagePath).getSignedUrl({ action: 'read', expires: expiresAtMs });
  return {
    success: true,
    recordId: id,
    url,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export async function reviewPowerLiftRecord(
  reviewerId: string,
  recordId: string,
  decision: PowerLiftDecision,
  note?: string,
) {
  const id = safeText(recordId, 180);
  if (!id) throw new AppError('recordId é obrigatório.', 400);
  if (decision !== 'approved' && decision !== 'rejected') throw new AppError('Decisão inválida.', 400);
  const reviewNote = safeText(note, 1000) || (decision === 'approved' ? 'Aprovado manualmente pelo administrador.' : 'Rejeitado manualmente pelo administrador.');
  const recordRef = db.collection('power_records').doc(id);
  const auditRef = db.collection('power_audit_logs').doc(`manual_${id}_${Date.now()}`);

  const result = await db.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(recordRef);
    if (!snapshot.exists) throw new AppError('Levantamento não encontrado.', 404);
    const record = snapshot.data() || {};
    if (record.videoStatus !== 'manual_review') {
      throw new AppError('Este levantamento não está mais aguardando revisão manual.', 409);
    }

    const now = new Date().toISOString();
    const updates: Record<string, any> = {
      videoStatus: decision,
      reviewedBy: reviewerId,
      reviewedAt: now,
      manualReviewNote: reviewNote,
      updatedAt: now,
      ...(decision === 'approved'
        ? { approvedAt: now, approvalSource: 'admin_manual_review' }
        : { rejectedAt: now, rejectionReason: reviewNote }),
    };

    transaction.update(recordRef, updates);
    transaction.create(auditRef, {
      id: auditRef.id,
      recordId: id,
      userId: record.userId || '',
      userName: record.userName || 'Atleta',
      exercise: record.exercise || '',
      declaredWeight: Number(record.weight) || 0,
      confidence: Number(record.confidence) || 0,
      result: decision === 'approved' ? 'VALIDADO_MANUALMENTE' : 'REPROVADO_MANUALMENTE',
      motivos: Array.isArray(record.motives) ? record.motives.slice(0, 10) : [],
      analysis: reviewNote,
      storagePath: record.storagePath || '',
      timestamp: now,
      reviewedBy: reviewerId,
      source: 'admin_manual_review',
    });

    return { id, ...record, ...updates };
  });

  await logEvent({
    severity: 'INFO',
    category: 'admin_reviews',
    message: `Power Lift ${id} revisado para '${decision}' por Admin (${reviewerId})`,
    userId: result.userId,
    route: '/api/admin',
    details: { recordId: id, decision, exercise: result.exercise, weight: result.weight, note: reviewNote },
  });
  publishAdminRealtimeSignalSafe({ type: 'POWERLIFT_REVIEWED', source: 'powerlift-admin' });

  return {
    success: true,
    message: decision === 'approved' ? 'Levantamento aprovado.' : 'Levantamento rejeitado.',
    record: {
      id: result.id,
      userId: result.userId,
      userName: result.userName || 'Atleta',
      exercise: result.exercise,
      weight: Number(result.weight) || 0,
      videoStatus: result.videoStatus,
      reviewedAt: result.reviewedAt,
      reviewedBy: result.reviewedBy,
    },
  };
}
