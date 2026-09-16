import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authMiddleware } from './_middleware/auth.js';
import { corsMiddleware } from './_middleware/cors.js';
import { db } from './_lib/common.js';
import { hasActiveAdminAuthority } from './_lib/admin-authority.js';
import { logEvent } from './_lib/observability.js';

/**
 * One-purpose administrative reset for the current strength sandbox edition.
 * This intentionally removes Firestore state only; it never calls Asaas and
 * therefore cannot cancel/refund a real provider-side payment.
 *
 * Kept deliberately narrow so it cannot be used as a generic production purge.
 */
const ALLOWED_CHAMPIONSHIP_ID = 'invictus_strength_v1';
const ALLOWED_EDITION_ID = 'invictus_strength_v1_429c3a8a8a022430377afbb7';
const CONFIRMATION = 'RESET_STRENGTH_SANDBOX_429C3A8A';

export default async function handler(
  req: VercelRequest & { userId?: string; userEmail?: string },
  res: VercelResponse,
) {
  if (corsMiddleware(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  if (!(await authMiddleware(req, res))) return;

  const userSnap = await db.collection('users').doc(req.userId!).get();
  if (!userSnap.exists || !hasActiveAdminAuthority(userSnap.data())) {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }

  const championshipId = String(req.body?.championshipId || '').trim();
  const editionId = String(req.body?.editionId || '').trim();
  const confirmation = String(req.body?.confirmation || '').trim();
  if (
    championshipId !== ALLOWED_CHAMPIONSHIP_ID
    || editionId !== ALLOWED_EDITION_ID
    || confirmation !== CONFIRMATION
  ) {
    return res.status(400).json({ error: 'Reset sandbox não autorizado para estes identificadores.' });
  }

  const lockRef = db.collection('championship_edition_locks').doc(championshipId);
  const lockSnap = await lockRef.get();
  if (!lockSnap.exists || String(lockSnap.data()?.activeEditionId || '') !== editionId) {
    return res.status(409).json({ error: 'A edição sandbox informada não é mais a edição ativa bloqueadora. Nenhuma alteração foi feita.' });
  }

  const registrations = await db.collection('championship_registrations')
    .where('editionId', '==', editionId)
    .get();

  // Delete only documents belonging to this exact obsolete sandbox edition.
  // Firestore batches are capped at 500 writes, so chunk conservatively.
  const refs = registrations.docs.map((doc: any) => doc.ref);
  for (let i = 0; i < refs.length; i += 450) {
    const batch = db.batch();
    refs.slice(i, i + 450).forEach((ref: any) => batch.delete(ref));
    await batch.commit();
  }

  // Re-check the lock immediately before deleting edition metadata. If another
  // process advanced it, stop instead of deleting the new active lock.
  const freshLock = await lockRef.get();
  if (!freshLock.exists || String(freshLock.data()?.activeEditionId || '') !== editionId) {
    return res.status(409).json({
      error: 'O lock mudou durante o reset. Inscrições da edição sandbox foram removidas, mas o lock atual foi preservado.',
      registrationsDeleted: refs.length,
    });
  }

  const metadataBatch = db.batch();
  metadataBatch.delete(db.collection('championship_settlements').doc(editionId));
  metadataBatch.delete(db.collection('championship_editions').doc(editionId));
  metadataBatch.delete(lockRef);
  await metadataBatch.commit();

  await logEvent({
    severity: 'HIGH_RISK',
    category: 'system_logs',
    message: 'Edição sandbox de musculação removida por reset administrativo explícito.',
    userId: req.userId!,
    route: '/api/admin-championship-sandbox-reset',
    details: { championshipId, editionId, registrationsDeleted: refs.length },
  });

  return res.status(200).json({
    success: true,
    championshipId,
    editionId,
    registrationsDeleted: refs.length,
    lockDeleted: true,
    editionDeleted: true,
    settlementDeleted: true,
  });
}
