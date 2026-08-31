import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { MissionEngine } from '../_lib/mission-engine.js';
import { RewardCoinEngine } from '../_lib/reward-coin-engine.js';

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
      await MissionEngine.syncUserProgressFromValidatedActivities(auth.uid).catch((error) => {
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

      return res.status(200).json({
        success: true,
        missions,
        userProgress,
        coinWallet,
      });
    }

    if (req.method === 'POST' && action === 'claim') {
      const { missionId } = req.body;
      if (!missionId) throw new Error('Identificador de missão (missionId) é obrigatório.');

      const result = await MissionEngine.claimMissionReward(auth.uid, String(missionId));
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
