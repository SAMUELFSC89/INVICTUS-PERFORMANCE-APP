import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  db,
  cors,
  verifyAuth,
  FieldValue
} from '../_lib/common.js';
import { hasActiveAdminAuthority } from '../_lib/admin-authority.js';

const MAX_BATCH_WRITES = 400;
const REQUIRED_CONFIRMATION = 'RESET_ALL_PROGRESS';

async function commitInChunks(
  docs: any[],
  apply: (batch: any, doc: any) => void,
): Promise<void> {
  for (let offset = 0; offset < docs.length; offset += MAX_BATCH_WRITES) {
    const batch = db.batch();
    for (const doc of docs.slice(offset, offset + MAX_BATCH_WRITES)) {
      apply(batch, doc);
    }
    await batch.commit();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  // Esta é uma operação destrutiva de manutenção, nunca um recurso público
  // da produção. Só habilite temporariamente durante uma migração planejada.
  if (process.env.ENABLE_MIGRATE_RESET !== 'true') {
    return res.status(404).json({ error: 'Rota não disponível.' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const userSnap = await db.collection('users').doc(auth.uid).get();
  if (!userSnap.exists || !hasActiveAdminAuthority(userSnap.data())) {
    return res.status(403).json({ error: 'Só administradores ativos podem realizar esta ação.' });
  }

  // Mesmo com a flag temporariamente ligada e uma sessão admin válida, uma
  // chamada genérica não pode apagar o progresso. A confirmação precisa vir
  // explicitamente no corpo da requisição.
  if (String(req.body?.confirm || '') !== REQUIRED_CONFIRMATION) {
    return res.status(409).json({
      error: 'Confirmação destrutiva ausente.',
      code: 'MIGRATION_CONFIRMATION_REQUIRED',
    });
  }

  try {
    console.log('[Migration] Starting full progress reset...');

    // 1. Reset Users Progress. Batches ficam bem abaixo do limite de 500 writes
    // do Firestore para que o utilitário continue operável com bases maiores.
    const usersSnap = await db.collection('users').get();
    await commitInChunks(usersSnap.docs, (batch, doc) => {
      batch.update(doc.ref, {
        score: 0,
        xp: 0,
        level: 1,
        weeklyScore: 0,
        monthlyScore: 0,
        streak: 0,
        totalActiveDays: 0,
        totalWorkouts: 0,
        totalTimeSpent: 0,
        achievements: [],
        firstScoreAt: FieldValue.delete(),
        lastCheckIn: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      });
    });
    console.log(`[Migration] Reset ${usersSnap.size} users.`);

    // 2. Clear Activities, Workouts, Run Sessions
    const collectionsToClear = ['activities', 'workouts', 'run_sessions'];
    const deletedByCollection: Record<string, number> = {};
    for (const collName of collectionsToClear) {
      const snap = await db.collection(collName).get();
      await commitInChunks(snap.docs, (batch, doc) => batch.delete(doc.ref));
      deletedByCollection[collName] = snap.size;
      console.log(`[Migration] Deleted ${snap.size} documents from ${collName}.`);
    }

    // 3. Reset Running Stats
    const statsSnap = await db.collection('running_stats').get();
    await commitInChunks(statsSnap.docs, (batch, doc) => {
      batch.update(doc.ref, {
        best_run_km_month: 0,
        best_run_km_week: 0,
        last_run_stats: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      });
    });
    console.log(`[Migration] Reset ${statsSnap.size} running_stats documents.`);

    return res.json({
      success: true,
      message: 'Todo o progresso foi zerado com sucesso.',
      usersReset: usersSnap.size,
      runningStatsReset: statsSnap.size,
      deletedByCollection,
    });
  } catch (error: any) {
    console.error('[Migration] Reset failed:', error);
    return res.status(500).json({ error: 'Não foi possível executar a migração.' });
  }
}
