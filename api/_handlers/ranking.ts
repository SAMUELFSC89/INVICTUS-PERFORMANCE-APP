import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth } from '../_lib/common.js';
import { isActiveAccountState } from '../_lib/account-state.js';
import { isCurrentCompetitiveHrAcknowledgement } from '../_lib/competitive-heart-rate-acknowledgement.js';
import { reconcileWeeklyRankingAchievements } from '../_lib/user-ranking-achievements.js';
import { COMPETITION_RULES_VERSIONS } from '../../shared/competitiveHeartRatePolicy.js';

async function reconcileCanonicalRankingAchievement(userId: string, period: string, currentUser: any) {
  // Somente o ranking semanal opt-in é fonte de conquista. Monthly/all são
  // visualizações alternativas e não podem criar novas oportunidades de XP.
  if (period !== 'weekly' || !currentUser || !Number.isFinite(Number(currentUser.rank))) return;
  await reconcileWeeklyRankingAchievements(userId, Number(currentUser.rank)).catch((error) => {
    // Ranking precisa continuar disponível mesmo se o ledger estiver
    // temporariamente indisponível; a concessão é idempotente e será tentada
    // novamente na próxima leitura semanal.
    console.warn('[Ranking API] Falha ao reconciliar conquista semanal:', error);
  });
}

function finiteScore(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });
  if (!db) return res.status(500).json({ error: 'Banco de dados indisponível.' });

  const period = req.query.period === 'monthly' ? 'monthly' : req.query.period === 'all' ? 'all' : 'weekly';
  const scoreField = period === 'weekly' ? 'weeklyScore' : period === 'monthly' ? 'monthlyScore' : 'score';

  try {
    const [ownEnrollmentSnapshot, ownProfileSnapshot] = await Promise.all([
      db.collection('gym_ranking_enrollments').doc(auth.uid).get(),
      db.collection('users').doc(auth.uid).get(),
    ]);
    if (!ownProfileSnapshot.exists) {
      return res.status(404).json({ error: 'Perfil não encontrado.', topUsers: [] });
    }

    const ownProfile = ownProfileSnapshot.data() || {};
    if (!isActiveAccountState(ownProfile)) {
      return res.status(403).json({ error: 'Conta inativa não pode acessar o ranking.', topUsers: [], enrolled: false });
    }

    const profileGymId = String(ownProfile.gymId || '').trim();
    if (!profileGymId) {
      return res.status(422).json({ topUsers: [], enrolled: false, error: 'Defina sua academia no perfil para acessar o ranking.' });
    }

    const ownEnrollment = ownEnrollmentSnapshot.exists ? ownEnrollmentSnapshot.data() : undefined;
    if (ownEnrollment?.enrolled !== true
      || !isCurrentCompetitiveHrAcknowledgement(ownEnrollment, 'gym_ranking', COMPETITION_RULES_VERSIONS.gym_ranking)) {
      return res.status(200).json({
        topUsers: [],
        enrolled: false,
        message: 'Entre voluntariamente no ranking para comparar seu IGA com atletas da sua academia.'
      });
    }

    const gymId = String(ownEnrollment.gymId || '').trim();
    if (!gymId || gymId !== profileGymId) {
      return res.status(409).json({ topUsers: [], enrolled: false, error: 'Sua adesão não corresponde à academia atual. Saia e entre novamente no ranking.' });
    }

    const requestedLimit = Number(req.query.limit || 50);
    const responseLimit = Math.min(100, Math.max(20, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50));
    const gymName = String(ownProfile.gymName || ownProfile.gym || '').trim();

    // Não cacheamos nome/foto/score/adesão do ranking no processo serverless.
    // Opt-out, suspensão, exclusão ou troca de academia precisam refletir na
    // próxima leitura; uma janela de cache aqui serviria identidades inativas.
    const enrollments = await db.collection('gym_ranking_enrollments')
      .where('gymId', '==', gymId)
      .limit(500)
      .get();

    const userRefs = enrollments.docs
      .filter((entry) => entry.data().enrolled === true
        && isCurrentCompetitiveHrAcknowledgement(entry.data(), 'gym_ranking', COMPETITION_RULES_VERSIONS.gym_ranking))
      .map((entry) => db.collection('users').doc(entry.id));
    const userSnapshots = userRefs.length ? await db.getAll(...userRefs) : [];
    const topUsers = userSnapshots
      .filter((snapshot) => {
        if (!snapshot.exists) return false;
        const data = snapshot.data() || {};
        return String(data.gymId || '').trim() === gymId
          && isActiveAccountState(data);
      })
      .map((snapshot) => {
        const data = snapshot.data() || {};
        return {
          uid: snapshot.id,
          displayName: data.displayName || 'Atleta',
          photoURL: data.photoURL || '',
          score: finiteScore(data[scoreField]),
          streak: finiteScore(data.streak),
          gymId
        };
      })
      .sort((left, right) => {
        const scoreDifference = right.score - left.score;
        if (scoreDifference !== 0) return scoreDifference;
        const nameDifference = left.displayName.localeCompare(right.displayName, 'pt-BR', { sensitivity: 'base' });
        return nameDifference !== 0 ? nameDifference : left.uid.localeCompare(right.uid);
      })
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    const currentUser = topUsers.find((entry) => entry.uid === auth.uid) || null;
    await reconcileCanonicalRankingAchievement(auth.uid, period, currentUser);
    return res.status(200).json({
      topUsers: topUsers.slice(0, responseLimit),
      currentUser,
      participantCount: topUsers.length,
      enrolled: true,
      gymId,
      gymName
    });
  } catch (error: any) {
    console.error('[Ranking API] Falha ao carregar ranking opt-in:', error);
    const isQuotaError = String(error?.message || '').includes('RESOURCE_EXHAUSTED');
    return res.status(isQuotaError ? 429 : 500).json({
      error: isQuotaError ? 'Ranking temporariamente sobrecarregado.' : 'Falha ao carregar ranking.',
      topUsers: []
    });
  }
}