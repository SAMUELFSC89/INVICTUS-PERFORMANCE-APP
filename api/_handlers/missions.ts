import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, increment, verifyAuth } from '../_lib/common.js';
import { MissionEngine } from '../_lib/mission-engine.js';
import { RewardCoinEngine } from '../_lib/reward-coin-engine.js';
import { reconcileUserActivityStats } from '../_lib/user-activity-stats.js';
import { reconcileUserSocialStats } from '../_lib/user-social-stats.js';
import { recalculateAllUserScores } from '../_lib/igaService.js';

function safeUserId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id.length <= 128 && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

function safePostId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id.length <= 128 && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

function normalizeSearchTerm(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .slice(0, 128);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });
  }

  const action = (req.query?.action || req.body?.action) as string | undefined;

  try {
    if (req.method === 'GET') {
      // These reads enrich the dashboard, but a temporary integration failure
      // must not take the complete challenges catalogue down.
      await MissionEngine.syncUserProgressFromCompletedActivities(auth.uid).catch((error) => {
        console.warn('[Missions Sync Warning]:', error);
      });
      const missions = await MissionEngine.getMissions();
      const [userProgress, coinWallet] = await Promise.all([
        MissionEngine.getUserMissionProgress(auth.uid),
        RewardCoinEngine.getWallet(auth.uid).catch((error) => {
          console.warn('[Mission Wallet Warning]:', error);
          return { userId: auth.uid, balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 };
        }),
      ]);
      const missionIds = new Set(missions.map((mission) => mission.id));
      const resumableMissions = userProgress
        .filter((progress) => progress.completed && !progress.claimed && !missionIds.has(progress.missionId)
          && (progress.claimState === 'pending'
            || (progress.rewardCoinsSnapshot !== undefined
              && progress.rewardXPSnapshot !== undefined
              && Boolean(progress.missionTitleSnapshot))))
        .map((progress: any) => ({
          id: progress.missionId,
          title: progress.claimMissionTitle || progress.missionTitleSnapshot || 'Desafio concluído',
          description: progress.missionDescriptionSnapshot || 'Recompensa conquistada aguardando resgate.',
          category: progress.missionCategorySnapshot || 'special',
          type: progress.missionTypeSnapshot || 'event_count',
          target: Number(progress.target) || 1,
          rewardCoins: Number(progress.claimRewardCoins ?? progress.rewardCoinsSnapshot) || 0,
          rewardCategory: progress.rewardCategorySnapshot || 'ecosystem',
          rewardXP: Number(progress.claimRewardXP ?? progress.rewardXPSnapshot) || 0,
          isFreeAccess: progress.isFreeAccessSnapshot !== false,
          ledgerType: progress.claimLedgerType || progress.ledgerTypeSnapshot || 'MISSION_REWARD',
          active: false,
        }));

      return res.status(200).json({
        success: true,
        missions: [...missions, ...resumableMissions],
        userProgress,
        coinWallet,
      });
    }

    if (req.method === 'POST' && action === 'sync-activity-stats') {
      // Login/refresh is also the backfill point for legacy Social counters.
      // Both reconciliations are server-derived and idempotent; social runs
      // second so the returned XP/achievements reflect every newly unlocked
      // activity + social achievement after both transactions settle.
      const activityStats = await reconcileUserActivityStats(auth.uid);
      const socialStats = await reconcileUserSocialStats(auth.uid);
      // O mesmo refresh que reconcilia os contadores pessoais também corrige
      // scores competitivos antigos/stale. Sem isso, contas sem nenhuma
      // atividade competitiva válida (inclusive contas administrativas de
      // teste) podiam continuar exibindo um `users.score` legado no perfil.
      const competitionScores = await recalculateAllUserScores(auth.uid);
      return res.status(200).json({
        success: true,
        stats: {
          ...activityStats,
          ...socialStats,
          weeklyScore: competitionScores.weekly.igaRanking,
          monthlyScore: competitionScores.monthly.average,
          score: competitionScores.season.average,
        },
      });
    }

    if (req.method === 'POST' && action === 'sync-social-stats') {
      // O cliente informa no máximo qual outro perfil foi afetado por um
      // follow/unfollow. Nenhum contador é aceito do aparelho: ambos os perfis
      // são recalculados a partir das coleções posts/follows do servidor.
      const affectedUserId = safeUserId(req.body?.affectedUserId);
      const stats = await reconcileUserSocialStats(auth.uid);
      if (affectedUserId && affectedUserId !== auth.uid) {
        await reconcileUserSocialStats(affectedUserId).catch((error) => {
          console.warn('[Social Stats Peer Sync Warning]:', error);
        });
      }
      return res.status(200).json({ success: true, stats });
    }

    if (req.method === 'POST' && action === 'record-post-share') {
      const postId = safePostId(req.body?.postId);
      if (!postId) return res.status(400).json({ success: false, error: 'Post inválido.' });
      const postRef = db.collection('posts').doc(postId);
      const snapshot = await postRef.get();
      if (!snapshot.exists) return res.status(404).json({ success: false, error: 'Post não encontrado.' });
      await postRef.set({ sharesCount: increment(1), lastSharedAt: new Date().toISOString() }, { merge: true });
      return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && action === 'search-users') {
      const searchTerm = normalizeSearchTerm(req.body?.searchTerm);
      if (!searchTerm) return res.status(200).json({ success: true, users: [] });
      const snap = await db.collection('users')
        .where('searchKeywords', 'array-contains', searchTerm)
        .limit(15)
        .get();

      const users = snap.docs
        .filter((doc: any) => doc.id !== auth.uid)
        .map((doc: any) => {
          const data = doc.data() || {};
          return {
            uid: doc.id,
            displayName: String(data.displayName || 'Atleta'),
            displayNameLower: String(data.displayNameLower || data.displayName || '').toLowerCase(),
            username: typeof data.username === 'string' ? data.username : '',
            photoURL: typeof data.photoURL === 'string' ? data.photoURL : '',
            bio: typeof data.bio === 'string' ? data.bio : '',
            city: typeof data.city === 'string' ? data.city : '',
            state: typeof data.state === 'string' ? data.state : '',
            gymId: typeof data.gymId === 'string' ? data.gymId : '',
            gymName: typeof data.gymName === 'string' ? data.gymName : '',
            followersCount: Math.max(0, Number(data.followersCount) || 0),
            followingCount: Math.max(0, Number(data.followingCount) || 0),
            postsCount: Math.max(0, Number(data.postsCount) || 0),
          };
        })
        .sort((a: any, b: any) => {
          const aExact = a.username.toLowerCase() === searchTerm ? 0 : 1;
          const bExact = b.username.toLowerCase() === searchTerm ? 0 : 1;
          return aExact - bExact || Number(!a.displayNameLower.startsWith(searchTerm)) - Number(!b.displayNameLower.startsWith(searchTerm)) || a.displayName.localeCompare(b.displayName);
        })
        .slice(0, 10);

      return res.status(200).json({ success: true, users });
    }

    if (req.method === 'POST' && action === 'claim') {
      const { missionId, progressId } = req.body;
      if (!missionId) throw new Error('Identificador de missão (missionId) é obrigatório.');

      const result = await MissionEngine.claimMissionReward(
        auth.uid,
        String(missionId),
        typeof progressId === 'string' ? progressId : undefined,
      );
      return res.status(200).json({
        success: true,
        message: `Recompensa resgatada: +${result.rewardCoins} Invictus Coins${result.rewardXP > 0 ? ` e +${result.rewardXP} XP` : ''}.`,
        result
      });
    }

    return res.status(400).json({ success: false, error: 'Ação de missão não suportada.' });
  } catch (err: any) {
    console.error('[Missions Handler Error]:', err);
    return res.status(400).json({ success: false, error: err.message || 'Erro ao processar missões.' });
  }
}