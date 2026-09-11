import { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue, cors, db, verifyAuth } from '../_lib/common.js';
import { getCommunityGymChampionshipStatus } from '../_lib/championship-scoring-service.js';
import { recordCompetitiveHrAcknowledgement, isCurrentCompetitiveHrAcknowledgement } from '../_lib/competitive-heart-rate-acknowledgement.js';
import { COMPETITION_RULES_VERSIONS, COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION } from '../../shared/competitiveHeartRatePolicy.js';

const EVENT_ID = 'community_friends_v1';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });
  if (!db) return res.status(500).json({ error: 'Banco de dados indisponível.' });
  const ref = db.collection('community_championship_enrollments').doc(`${EVENT_ID}_${auth.uid}`);

  if (req.method === 'GET') {
    const rawPeriod = String(req.query.period || 'weekly');
    const period = rawPeriod === 'monthly' || rawPeriod === 'all' ? rawPeriod : 'weekly';
    const [own, count, championship] = await Promise.all([
      ref.get(),
      db.collection('community_championship_enrollments').where('eventId', '==', EVENT_ID).where('status', '==', 'active').count().get(),
      getCommunityGymChampionshipStatus(auth.uid, new Date(), period),
    ]);
    const ownData = own.data() || {};
    const enrolled = ownData.status === 'active'
      && isCurrentCompetitiveHrAcknowledgement(ownData, EVENT_ID, COMPETITION_RULES_VERSIONS.community_friends_v1);
    return res.status(200).json({ eventId: EVENT_ID, enrolled, requiresHrAcknowledgement: !enrolled, participantCount: count.data().count, championship });
  }
  if (req.method === 'POST') {
    let acknowledgement;
    try {
      acknowledgement = await recordCompetitiveHrAcknowledgement(auth.uid, EVENT_ID, COMPETITION_RULES_VERSIONS.community_friends_v1, req.body?.hrAcknowledgement);
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : 'Não foi possível registrar o aceite competitivo.' });
    }
    const current = await ref.get();
    const keepEnrollmentEpoch = current.data()?.status === 'active' && current.data()?.joinedAt;
    await ref.set({ eventId: EVENT_ID, userId: auth.uid, status: 'active', consentVersion: 'community-friends-v1', accepted: true, consentType: acknowledgement.consentType, competitionId: EVENT_ID, competitionRulesVersion: COMPETITION_RULES_VERSIONS.community_friends_v1, hrAcknowledgementVersion: COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION, hrAcknowledgementId: acknowledgement.acknowledgementId, ...(!keepEnrollmentEpoch ? { joinedAt: FieldValue.serverTimestamp() } : {}), withdrawnAt: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return res.status(200).json({ eventId: EVENT_ID, enrolled: true, hrAcknowledgementVersion: COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION });
  }
  if (req.method === 'DELETE') {
    await ref.set({ status: 'withdrawn', withdrawnAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return res.status(200).json({ eventId: EVENT_ID, enrolled: false });
  }
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Método não permitido.' });
}
