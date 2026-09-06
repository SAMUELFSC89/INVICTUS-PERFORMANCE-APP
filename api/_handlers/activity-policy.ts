import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db, verifyAuth } from '../_lib/common.js';
import { createActivityCompetitionPolicySnapshot } from '../_lib/activity-competition-policy.js';
import { normalizeSessionPolicyModality } from '../_lib/modality-config.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Autenticação necessária.' });
  if (!db) return res.status(503).json({ error: 'Banco de dados indisponível.' });

  let modality;
  try {
    modality = normalizeSessionPolicyModality({
      activityType: req.body?.activityType || req.body?.type,
      cardioType: req.body?.cardioType,
      isIndoorCardio: req.body?.isIndoorCardio,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'Modalidade da atividade inválida.' });
  }
  // O instante é sempre do servidor; aceitar startTime do cliente permitiria
  // criar uma política retroativa para um campeonato já encerrado.
  const when = new Date();
  const policy = await createActivityCompetitionPolicySnapshot({
    userId: auth.uid,
    activityType: modality.activityType,
    cardioType: modality.cardioType,
    isIndoorCardio: modality.isIndoorCardio,
    when,
  });
  return res.status(200).json(policy);
}
