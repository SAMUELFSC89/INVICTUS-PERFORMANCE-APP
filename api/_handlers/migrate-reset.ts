import { VercelRequest, VercelResponse } from '@vercel/node';
import { 
  db, 
  cors, 
  verifyAuth, 
  FieldValue 
} from '../_lib/common.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  // Esta é uma operação destrutiva de manutenção, nunca um recurso público
  // da produção. Só habilite temporariamente durante uma migração planejada.
  if (process.env.ENABLE_MIGRATE_RESET !== 'true') {
    return res.status(404).json({ error: 'Rota não disponível.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  // Safety check: verify admin role
  const userSnap = await db.collection('users').doc(auth.uid).get();
  const userData = userSnap.data();
  if (userData?.role !== 'admin') {
    return res.status(403).json({ error: 'Só administradores podem realizar esta ação.' });
  }

  try {
    console.log('[Migration] Starting full progress reset...');
    
    // 1. Reset Users Progress
    const usersSnap = await db.collection('users').get();
    const batch = db.batch();
    
    usersSnap.forEach(doc => {
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
    
    await batch.commit();
    console.log(`[Migration] Reset ${usersSnap.size} users.`);

    // 2. Clear Activities, Workouts, Run Sessions
    const collectionsToClear = ['activities', 'workouts', 'run_sessions'];
    for (const collName of collectionsToClear) {
      const snap = await db.collection(collName).get();
      const deleteBatch = db.batch();
      snap.forEach(doc => deleteBatch.delete(doc.ref));
      await deleteBatch.commit();
      console.log(`[Migration] Deleted ${snap.size} documents from ${collName}.`);
    }

    // 3. Reset Running Stats
    const statsSnap = await db.collection('running_stats').get();
    const statsBatch = db.batch();
    statsSnap.forEach(doc => {
      statsBatch.update(doc.ref, {
        best_run_km_month: 0,
        best_run_km_week: 0,
        last_run_stats: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      });
    });
    await statsBatch.commit();
    console.log(`[Migration] Reset ${statsSnap.size} running_stats documents.`);

    return res.json({ success: true, message: 'Todo o progresso foi zerado com sucesso.' });
  } catch (error: any) {
    console.error('[Migration] Reset failed:', error);
    return res.status(500).json({ error: 'Não foi possível executar a migração.' });
  }
}
