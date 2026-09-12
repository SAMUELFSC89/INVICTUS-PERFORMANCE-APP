import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { MissionEngine } from '../_lib/mission-engine.js';
import { RewardCoinEngine } from '../_lib/reward-coin-engine.js';
import { reconcileUserActivityStats } from '../_lib/user-activity-stats.js';
import { reconcileUserSocialStats } from '../_lib/user-social-stats.js';

function safeUserId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id.length <= 128 && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
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
      // Estatísticas do perfil são derivadas do histórico canônico do próprio
      // atleta e nunca de números enviados pelo cliente. A operação é
      // idempotente, portanto também recupera perfis antigos que ficaram com
      // totalWorkouts/streak defasados depois da migração para o fluxo v2.
      const stats = await reconcileUserActivityStats(auth.uid);
      return res.status(200).json({ success: true, stats });
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