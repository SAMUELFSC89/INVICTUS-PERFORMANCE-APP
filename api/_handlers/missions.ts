import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth } from '../_lib/common.js';
import { MissionEngine } from '../_lib/mission-engine.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });
  }

  const action = (req.query.action || req.body.action) as string;

  try {
    if (req.method === 'GET') {
      const missions = await MissionEngine.getMissions();
      const userProgress = await MissionEngine.getUserMissionProgress(auth.uid);

      return res.status(200).json({
        success: true,
        missions,
        userProgress
      });
    }

    if (req.method === 'POST' && action === 'claim') {
      const { missionId } = req.body;
      if (!missionId) throw new Error('Identificador de missão (missionId) é obrigatório.');

      const result = await MissionEngine.claimMissionReward(auth.uid, String(missionId));
      return res.status(200).json({
        success: true,
        message: `Recompensa resgatada com sucesso! +R$ ${result.rewardCoins} e +${result.rewardXP} XP adicionados!`,
        result
      });
    }

    return res.status(400).json({ success: false, error: 'Ação de missão não suportada.' });
  } catch (err: any) {
    console.error('[Missions Handler Error]:', err);
    return res.status(400).json({ success: false, error: err.message || 'Erro ao processar missões.' });
  }
}
