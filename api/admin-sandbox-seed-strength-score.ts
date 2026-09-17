import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authMiddleware } from './_middleware/auth.js';
import { corsMiddleware } from './_middleware/cors.js';
import { db } from './_lib/common.js';
import { hasActiveAdminAuthority } from './_lib/admin-authority.js';
import { logEvent } from './_lib/observability.js';

const CHAMPIONSHIP_ID = 'invictus_strength_v1';
const EDITION_ID = 'invictus_strength_v1_99601b0d14ed9184367b44fa';
const CONFIRMATION = 'SEED_STRENGTH_SANDBOX_SCORE_99601';

/**
 * One-shot, sandbox-only fixture used to validate the full paid-championship
 * settlement -> prize wallet -> PIX withdrawal flow without fabricating a
 * production workout. The route is intentionally hard-bound to one edition,
 * requires an authenticated active admin with a PAID registration, and refuses
 * to run outside Asaas Sandbox.
 */
export default async function handler(req: VercelRequest & { userId?: string; userEmail?: string }, res: VercelResponse) {
  if (corsMiddleware(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  if (!(await authMiddleware(req, res))) return;

  if (String(process.env.ASAAS_ENVIRONMENT || '').trim().toLowerCase() !== 'sandbox') {
    return res.status(403).json({ error: 'Fixture permitida somente no Asaas Sandbox.' });
  }

  const userSnap = await db.collection('users').doc(req.userId!).get();
  if (!userSnap.exists || !hasActiveAdminAuthority(userSnap.data())) {
    return res.status(403).json({ error: 'Acesso restrito a administradores ativos.' });
  }

  if (String(req.body?.confirmation || '') !== CONFIRMATION) {
    return res.status(400).json({ error: 'Confirmação inválida.' });
  }

  const registrationSnap = await db.collection('championship_registrations')
    .where('editionId', '==', EDITION_ID)
    .get();
  const registration = registrationSnap.docs
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .find((item: any) => String(item.userId || '') === req.userId);

  if (!registration || registration.status !== 'paga' || registration.paymentStatus !== 'PAID') {
    return res.status(409).json({ error: 'A conta autenticada não possui inscrição PAID nesta edição.' });
  }

  const settlementRef = db.collection('championship_settlements').doc(EDITION_ID);
  const settlementSnap = await settlementRef.get();
  if (settlementSnap.exists && settlementSnap.data()?.status === 'FINALIZED') {
    return res.status(409).json({ error: 'A edição já foi finalizada; fixture não pode mais ser criada.' });
  }

  const activityId = `sandbox-strength-${EDITION_ID}-${req.userId}`;
  const entryId = `sandbox-entry-${EDITION_ID}-${req.userId}`;
  const scoreId = `sandbox-score-${EDITION_ID}-${req.userId}`;
  const entryRef = db.collection('activity_competition_entries').doc(entryId);
  const scoreRef = db.collection('championship_scores').doc(scoreId);
  const [entrySnap, scoreSnap] = await Promise.all([entryRef.get(), scoreRef.get()]);

  if (entrySnap.exists && scoreSnap.exists) {
    return res.status(200).json({
      success: true,
      alreadyExisted: true,
      championshipId: CHAMPIONSHIP_ID,
      editionId: EDITION_ID,
      activityId,
      score: Number(scoreSnap.data()?.score || 0),
    });
  }

  const now = new Date().toISOString();
  const user = userSnap.data() || {};
  const batch = db.batch();
  batch.set(entryRef, {
    contextType: 'paid_championship',
    contextId: CHAMPIONSHIP_ID,
    editionId: EDITION_ID,
    activityId,
    reviewStatus: 'approved',
    userId: req.userId,
    source: 'SANDBOX_TEST_FIXTURE',
    reviewedAt: now,
    reviewedBy: req.userId,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
  batch.set(scoreRef, {
    championshipId: CHAMPIONSHIP_ID,
    editionId: EDITION_ID,
    activityId,
    userId: req.userId,
    userName: String(user.displayName || user.name || user.email || 'Atleta Sandbox'),
    userGymName: String(user.gymName || 'Academia Sandbox'),
    validationStatus: 'VALIDATED',
    score: 100,
    metrics: { durationMinutes: 45 },
    source: 'SANDBOX_TEST_FIXTURE',
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
  await batch.commit();

  await logEvent({
    severity: 'HIGH_RISK',
    category: 'system_logs',
    message: 'Fixture Sandbox de pontuação de campeonato criada para teste de settlement/saque.',
    userId: req.userId!,
    route: '/api/admin-sandbox-seed-strength-score',
    details: { championshipId: CHAMPIONSHIP_ID, editionId: EDITION_ID, activityId, score: 100 },
  });

  return res.status(200).json({
    success: true,
    championshipId: CHAMPIONSHIP_ID,
    editionId: EDITION_ID,
    activityId,
    reviewStatus: 'approved',
    validationStatus: 'VALIDATED',
    score: 100,
    durationMinutes: 45,
    sandboxFixture: true,
  });
}
