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

  const requestedMode = req.body?.requestedMode === 'personal' ? 'personal' : 'competitive';
  if (requestedMode === 'personal') {
    // Musculação sempre pôde virar pessoal. Cardio só entra para
    // corrida/caminhada: são as únicas modalidades que exigem GPS contínuo em
    // modo competitivo -- as demais (bike ergométrica, esteira etc.) já
    // rodam sem essa exigência, então o controle de pontuação não se aplica
    // a elas (pedido de produto: "o cardio só vai precisar caso a pessoa for
    // fazer a corrida ou caminhada").
    const isPersonalModeEligible = modality.activityType === 'workout'
      || (modality.activityType === 'cardio' && (modality.cardioType === 'running' || modality.cardioType === 'walking'));
    if (!isPersonalModeEligible) {
      return res.status(400).json({ error: 'O modo pessoal sem pontuação está disponível para musculação, corrida e caminhada neste fluxo.' });
    }

    // O modo pessoal precisa ser decidido no servidor, não por um bypass do
    // cliente. O snapshot nasce sem contextos competitivos e por isso não
    // solicita geofence/GPS/motion e não pode ser promovido para ranking.
    const issuedAt = new Date();
    const startBy = new Date(issuedAt.getTime() + 30 * 60 * 1000).toISOString();
    const expiresAt = new Date(issuedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const ref = db.collection('activity_policy_snapshots').doc();
    const policy = {
      version: 'activity-competition-v2' as const,
      activityType: modality.activityType,
      ...(modality.activityType === 'cardio' ? { cardioType: modality.cardioType } : {}),
      isIndoorCardio: false,
      resolvedAt: issuedAt.toISOString(),
      effectiveAt: issuedAt.toISOString(),
      contexts: [],
      requiresSecurityReview: false,
      requiresGymCheckIn: false,
      requiresContinuousGps: false,
      requiresMotionSensors: false,
      snapshotId: ref.id,
      sessionId: ref.id,
      startBy,
      expiresAt,
    };
    await ref.create({
      id: ref.id,
      sessionId: ref.id,
      userId: auth.uid,
      activityType: modality.activityType,
      cardioType: modality.activityType === 'cardio' ? modality.cardioType : null,
      isIndoorCardio: false,
      policy,
      createdAt: issuedAt.toISOString(),
      startBy,
      expiresAt,
      expiresAtTimestamp: new Date(expiresAt),
      requestedMode: 'personal',
    });
    return res.status(200).json(policy);
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
