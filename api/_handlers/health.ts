import { db, cors, verifyAuth } from '../_lib/common.js';
import { hasActiveAdminAuthority } from '../_lib/admin-authority.js';
import { sanitizeWorkoutHealthRecord } from '../_lib/workout-health-record.js';
import { chunkHeartRateSamples, heartRateSeriesHash } from '../_lib/heart-rate-audit-server.js';

export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;

  if (req.method === 'POST' && req.body?.action === 'archive-workout-heart-rate') {
    const auth = await verifyAuth(req);
    if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });
    const workoutId = req.body?.workoutId;
    if (typeof workoutId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(workoutId)) {
      return res.status(400).json({ error: 'Identificação do treino inválida.' });
    }
    try {
      const workoutRef = db.collection('workouts').doc(workoutId);
      const snap = await workoutRef.get();
      const workout = snap.data();
      if (!snap.exists || workout?.userId !== auth.uid) return res.status(404).json({ error: 'Treino não encontrado.' });

      const sanitized = sanitizeWorkoutHealthRecord(workout.healthSession);
      const healthSession = sanitized.healthSession;
      if (!healthSession) return res.status(409).json({ error: 'Este treino não possui registro de saúde válido.' });
      const samples = healthSession.heartRate.samples;
      const seriesHash = samples.length ? heartRateSeriesHash(samples) : undefined;
      const chunks = chunkHeartRateSamples(samples);
      const archiveCollection = workoutRef.collection('heart_rate_series');
      const existing = await archiveCollection.get();
      if (existing.size + chunks.length + 1 > 450) {
        return res.status(409).json({ error: 'O arquivo de batimentos excedeu o limite operacional seguro.' });
      }

      const batch = db.batch();
      existing.docs.forEach((doc: any) => batch.delete(doc.ref));
      chunks.forEach((chunk) => {
        const ref = archiveCollection.doc(String(chunk.index).padStart(4, '0'));
        batch.set(ref, {
          version: 1,
          workoutId,
          userId: auth.uid,
          index: chunk.index,
          sampleCount: chunk.samples.length,
          samples: chunk.samples,
          seriesHash: seriesHash || null,
          source: healthSession.heartRate.source,
          sourceKey: healthSession.heartRate.sourceKey,
          startedAt: healthSession.startedAt,
          endedAt: healthSession.endedAt,
          updatedAt: new Date().toISOString(),
        });
      });

      if (healthSession.heartRate.audit) {
        healthSession.heartRate.audit.archivedChunkCount = chunks.length;
        if (seriesHash) healthSession.heartRate.audit.seriesHash = seriesHash;
      }
      batch.update(workoutRef, {
        healthSession,
        healthSessionStatus: sanitized.healthSessionStatus || 'partial',
        healthSessionReason: sanitized.healthSessionReason ?? null,
        heartRateArchive: {
          version: 1,
          chunkCount: chunks.length,
          sampleCount: samples.length,
          seriesHash: seriesHash || null,
          updatedAt: new Date().toISOString(),
        },
      });
      await batch.commit();
      return res.status(200).json({
        archived: true,
        chunkCount: chunks.length,
        sampleCount: samples.length,
        seriesHash: seriesHash || null,
        healthSession,
      });
    } catch (error) {
      console.error('[Health] Falha ao arquivar série de FC:', error);
      return res.status(503).json({ error: 'Não foi possível arquivar a série de batimentos agora.', retryable: true });
    }
  }

  // Liveness público não revela projeto, banco, credenciais ou mensagens do
  // SDK. Um teste real de Firestore exige autenticação administrativa.
  if (req.query?.full !== 'true') {
    return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  }

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });

  const userSnap = await db.collection('users').doc(auth.uid).get();
  if (!userSnap.exists || !hasActiveAdminAuthority(userSnap.data())) {
    return res.status(403).json({ error: 'Acesso administrativo necessário.' });
  }

  let firestoreAvailable = false;

  try {
    await db.collection('_connection_test_').doc('ping').get();
    firestoreAvailable = true;
  } catch {
    // A resposta não deve expor detalhes internos de rede ou credencial.
  }

  return res.status(200).json({
    status: firestoreAvailable ? 'ok' : 'degraded',
    firestoreAvailable,
    timestamp: new Date().toISOString()
  });
}
