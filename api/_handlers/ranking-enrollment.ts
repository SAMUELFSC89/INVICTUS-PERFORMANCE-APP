import { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue, cors, db, verifyAuth } from '../_lib/common.js';
import { recalculateAllUserScores } from '../_lib/igaService.js';
import { isCurrentCompetitiveHrAcknowledgement, recordCompetitiveHrAcknowledgement } from '../_lib/competitive-heart-rate-acknowledgement.js';
import { COMPETITION_RULES_VERSIONS, COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION } from '../../shared/competitiveHeartRatePolicy.js';

const CONSENT_VERSION = 'gym-ranking-v1';

async function handleRankingEnrollment(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });
  if (!db) return res.status(500).json({ error: 'Banco de dados indisponível.' });

  const enrollmentRef = db.collection('gym_ranking_enrollments').doc(auth.uid);

  if (req.method === 'GET') {
    const snapshot = await enrollmentRef.get();
    const data = snapshot.exists ? snapshot.data() : undefined;
    return res.status(200).json({
      enrolled: data?.enrolled === true && isCurrentCompetitiveHrAcknowledgement(data, 'gym_ranking', COMPETITION_RULES_VERSIONS.gym_ranking),
      gymId: data?.gymId || '',
      consentVersion: data?.consentVersion || null,
      enrolledAt: data?.enrolledAt?.toDate?.()?.toISOString?.() || data?.enrolledAt || null
    });
  }

  if (req.method === 'POST') {
    const [userSnapshot, currentEnrollment] = await Promise.all([
      db.collection('users').doc(auth.uid).get(),
      enrollmentRef.get(),
    ]);
    if (!userSnapshot.exists) return res.status(404).json({ error: 'Perfil não encontrado.' });

    const userData = userSnapshot.data() || {};
    const requestedGymId = typeof req.body?.gymId === 'string' ? req.body.gymId.trim() : '';
    const profileGymId = String(userData.gymId || '').trim();
    if (requestedGymId && requestedGymId !== profileGymId) {
      return res.status(409).json({ error: 'A academia informada não corresponde à academia vinculada ao seu perfil.' });
    }
    const gymId = profileGymId;
    if (!gymId) {
      return res.status(422).json({
        error: 'Defina sua academia no perfil antes de entrar no ranking.'
      });
    }

    let acknowledgement;
    try {
      acknowledgement = await recordCompetitiveHrAcknowledgement(auth.uid, 'gym_ranking', COMPETITION_RULES_VERSIONS.gym_ranking, req.body?.hrAcknowledgement);
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : 'Não foi possível registrar o aceite competitivo.' });
    }

    const current = currentEnrollment.data() || {};
    const keepEnrollmentEpoch = current.enrolled === true && current.gymId === gymId && current.enrolledAt;
    await enrollmentRef.set({
      userId: auth.uid,
      gymId,
      enrolled: true,
      consentVersion: CONSENT_VERSION,
      accepted: true,
      consentType: acknowledgement.consentType,
      competitionId: 'gym_ranking',
      competitionRulesVersion: COMPETITION_RULES_VERSIONS.gym_ranking,
      hrAcknowledgementVersion: COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION,
      hrAcknowledgementId: acknowledgement.acknowledgementId,
      ...(!keepEnrollmentEpoch ? { enrolledAt: FieldValue.serverTimestamp() } : {}),
      withdrawnAt: null,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    if (!keepEnrollmentEpoch) {
      await db.collection('users').doc(auth.uid).set({
        weeklyScore: 0,
        monthlyScore: 0,
        score: 0,
        rankingEpochResetAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    await recalculateAllUserScores(auth.uid).catch((error) => {
      console.error('[Ranking Enrollment] adesão salva, mas IGA não foi recalculado:', error);
    });

    return res.status(200).json({ enrolled: true, gymId, consentVersion: CONSENT_VERSION });
  }

  if (req.method === 'DELETE') {
    const batch = db.batch();
    batch.set(enrollmentRef, {
      userId: auth.uid,
      enrolled: false,
      withdrawnAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    batch.set(db.collection('users').doc(auth.uid), {
      weeklyScore: 0,
      monthlyScore: 0,
      score: 0,
      rankingEpochResetAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    await recalculateAllUserScores(auth.uid).catch((error) => {
      console.error('[Ranking Enrollment] saída salva, mas scores não foram zerados:', error);
    });
    return res.status(200).json({ enrolled: false });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Método não permitido.' });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    return await handleRankingEnrollment(req, res);
  } catch (error) {
    console.error('[Ranking Enrollment] Falha ao processar adesão:', error);
    return res.status(500).json({ error: 'Não foi possível processar sua adesão ao ranking agora.' });
  }
}
