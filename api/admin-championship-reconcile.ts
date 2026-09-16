import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authMiddleware } from './_middleware/auth.js';
import { corsMiddleware } from './_middleware/cors.js';
import { db } from './_lib/common.js';
import { hasActiveAdminAuthority } from './_lib/admin-authority.js';
import { logEvent } from './_lib/observability.js';

/**
 * Administrative recovery for a paid championship edition whose immutable
 * config lock prevents a new sandbox edition from opening.
 *
 * Fail closed: the previous edition is finalized only when Firestore has no
 * registration with a provider checkout/payment binding and no paid/disputed
 * financial state. Failed deterministic checkout attempts are safe to close.
 */
export default async function handler(req: VercelRequest & { userId?: string; userEmail?: string }, res: VercelResponse) {
  if (corsMiddleware(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  if (!(await authMiddleware(req, res))) return;

  const userSnap = await db.collection('users').doc(req.userId!).get();
  if (!userSnap.exists || !hasActiveAdminAuthority(userSnap.data())) {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }

  const championshipId = String(req.body?.championshipId || '').trim();
  if (!championshipId || championshipId.length > 128) {
    return res.status(400).json({ error: 'championshipId inválido.' });
  }

  const lockRef = db.collection('championship_edition_locks').doc(championshipId);
  const lockSnap = await lockRef.get();
  if (!lockSnap.exists) return res.status(409).json({ error: 'Não existe edição bloqueada para este campeonato.' });

  const lock = lockSnap.data() || {};
  const previousEditionId = String(lock.activeEditionId || '').trim();
  if (!previousEditionId) return res.status(409).json({ error: 'O lock não possui edição ativa.' });

  const existingSettlement = await db.collection('championship_settlements').doc(previousEditionId).get();
  if (existingSettlement.exists && existingSettlement.data()?.status === 'FINALIZED') {
    return res.status(200).json({ success: true, alreadyFinalized: true, championshipId, previousEditionId });
  }

  const registrations = await db.collection('championship_registrations')
    .where('editionId', '==', previousEditionId)
    .get();

  const unsafe = registrations.docs.filter((doc: any) => {
    const data = doc.data() || {};
    const paymentStatus = String(data.paymentStatus || '').toUpperCase();
    const status = String(data.status || '').toLowerCase();
    const checkoutState = String(data.checkoutCreationStatus || '').toUpperCase();
    const hasProviderBinding = Boolean(data.asaasCheckoutId || data.asaasPaymentId);
    const hasFinancialState = status === 'paga' || status === 'reembolsada' || status === 'contestada'
      || ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'RECONCILIATION_REQUIRED'].includes(paymentStatus)
      || paymentStatus.includes('CHARGEBACK');
    const ambiguousCheckout = checkoutState === 'UNCERTAIN' || checkoutState === 'CREATING';
    return hasProviderBinding || hasFinancialState || ambiguousCheckout;
  });

  if (unsafe.length > 0) {
    await logEvent({
      severity: 'HIGH_RISK',
      category: 'system_logs',
      message: 'Reconciliação administrativa de campeonato recusada por evidência financeira.',
      userId: req.userId!,
      route: '/api/admin-championship-reconcile',
      details: { championshipId, previousEditionId, unsafeRegistrationIds: unsafe.map((doc: any) => doc.id) },
    });
    return res.status(409).json({
      error: 'A edição possui checkout, pagamento ou estado financeiro que exige conciliação manual.',
      championshipId,
      previousEditionId,
      unsafeRegistrations: unsafe.length,
    });
  }

  const now = new Date().toISOString();
  const settlementRef = db.collection('championship_settlements').doc(previousEditionId);
  const editionRef = db.collection('championship_editions').doc(previousEditionId);

  await db.runTransaction(async (transaction: any) => {
    const [freshLock, freshSettlement] = await Promise.all([
      transaction.get(lockRef),
      transaction.get(settlementRef),
    ]);
    if (!freshLock.exists || String(freshLock.data()?.activeEditionId || '') !== previousEditionId) {
      throw new Error('O lock da edição mudou durante a reconciliação; nenhuma alteração foi aplicada.');
    }
    if (freshSettlement.exists && freshSettlement.data()?.status === 'FINALIZED') return;

    transaction.set(settlementRef, {
      editionId: previousEditionId,
      championshipId,
      status: 'FINALIZED',
      settlementType: 'ADMIN_EMPTY_EDITION_RECONCILIATION',
      participantCount: 0,
      grossRevenue: 0,
      prizePool: 0,
      ranking: [],
      finalizedAt: now,
      finalizedBy: req.userId,
      reconciliationReason: 'EMPTY_SANDBOX_EDITION_NO_PROVIDER_PAYMENT',
      updatedAt: now,
    }, { merge: true });
    transaction.set(editionRef, {
      status: 'FINALIZED',
      finalizedAt: now,
      finalizedBy: req.userId,
      updatedAt: now,
    }, { merge: true });
    transaction.set(lockRef, {
      lastFinalizedEditionId: previousEditionId,
      lastFinalizedAt: now,
      updatedAt: now,
    }, { merge: true });
  });

  await logEvent({
    severity: 'HIGH_RISK',
    category: 'system_logs',
    message: 'Edição vazia de campeonato finalizada por reconciliação administrativa.',
    userId: req.userId!,
    route: '/api/admin-championship-reconcile',
    details: { championshipId, previousEditionId, registrationsChecked: registrations.size },
  });

  return res.status(200).json({
    success: true,
    championshipId,
    previousEditionId,
    registrationsChecked: registrations.size,
    finalizedAt: now,
  });
}
