import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  db,
  cors,
  verifyAuth,
  FieldValue
} from '../_lib/common.js';

const BATCH_SIZE = 450;

async function updateAllInBatches(
  snapshot: FirebaseFirestore.QuerySnapshot,
  data: Record<string, unknown>,
) {
  for (let index = 0; index < snapshot.docs.length; index += BATCH_SIZE) {
    const batch = db.batch();
    for (const document of snapshot.docs.slice(index, index + BATCH_SIZE)) {
      batch.update(document.ref, data);
    }
    await batch.commit();
  }
}

async function deleteAllInBatches(snapshot: FirebaseFirestore.QuerySnapshot) {
  for (let index = 0; index < snapshot.docs.length; index += BATCH_SIZE) {
    const batch = db.batch();
    for (const document of snapshot.docs.slice(index, index + BATCH_SIZE)) {
      batch.delete(document.ref);
    }
    await batch.commit();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  // Safety check: verify admin role
  const userSnap = await db.collection('users').doc(auth.uid).get();
  const userData = userSnap.data();
  if (userData?.role !== 'admin' && userData?.email !== 'samuelfsc89@gmail.com') {
    return res.status(403).json({ error: 'Só administradores podem realizar esta ação.' });
  }

  try {
    console.log('[Migration] Starting full progress reset...');

    const usersSnap = await db.collection('users').get();
    await updateAllInBatches(usersSnap, {
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
    console.log(`[Migration] Reset ${usersSnap.size} users.`);

    const collectionsToClear = ['activities', 'workouts', 'run_sessions'];
    for (const collName of collectionsToClear) {
      const snapshot = await db.collection(collName).get();
      await deleteAllInBatches(snapshot);
      console.log(`[Migration] Deleted ${snapshot.size} documents from ${collName}.`);
    }

    const statsSnap = await db.collection('running_stats').get();
    await updateAllInBatches(statsSnap, {
      best_run_km_month: 0,
      best_run_km_week: 0,
      last_run_stats: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    });
    console.log(`[Migration] Reset ${statsSnap.size} running_stats documents.`);

    return res.json({ success: true, message: 'Todo o progresso foi zerado com sucesso.' });
  } catch (error: any) {
    console.error('[Migration] Reset failed:', error);
    return res.status(500).json({ error: error.message });
  }
}
