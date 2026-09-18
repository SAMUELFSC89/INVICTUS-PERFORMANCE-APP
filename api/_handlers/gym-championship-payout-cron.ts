import { timingSafeEqual } from 'crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../_lib/common.js';
import { finalizeCommunityGymChampionshipCycle } from '../_lib/championship-scoring-service.js';
import { runPaidChampionshipSettlementSweep } from '../_lib/paid-championship-settlement-orchestrator.js';
import { runPowerLiftSettlementSweep } from '../_lib/powerlift-season-engine.js';

/**
 * Somente condições transitórias/operacionais conhecidas retornam 200 para o
 * cron tentar novamente depois. Divergência de regulamento ou de dados
 * competitivos é anomalia de integridade e precisa subir como 500/alerta.
 */
function isExpectedPaidBlock(reason: string): boolean {
  return reason.startsWith('FINANCIAL_REVIEW_PENDING:')
    || reason.startsWith('ACTIVITY_REVIEW_PENDING:')
    || reason === 'UNRESOLVED_PRIZE_TIE'
    || reason === 'Settlement já está em execução por outro worker.';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ success: false, message: 'Método não permitido.' });
  const secret = process.env.CRON_SECRET || '';
  const header = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  const custom = Array.isArray(req.headers['x-cron-secret']) ? req.headers['x-cron-secret'][0] : req.headers['x-cron-secret'];
  const provided = header?.startsWith('Bearer ') ? header.slice(7).trim() : String(custom || header || '').trim();
  const allowed = Boolean(secret) && provided.length === secret.length && timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  if (!allowed) return res.status(401).json({ success: false, message: 'Não autorizado.' });

  const now = new Date();
  const previousMonth = new Date(now);
  previousMonth.setUTCDate(1);
  previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
  const defaultCycle = previousMonth.toISOString().slice(0, 7);
  const requestedCycle = req.query?.cycleKey || req.body?.cycleKey;
  const cycleKey = String(requestedCycle || defaultCycle);

  // O cron agora roda diariamente por causa dos Campeonatos Oficiais pagos e
  // também reconcilia temporadas encerradas do Power Lift. O campeonato
  // comunitário continua mensal.
  const shouldRunCommunity = Boolean(requestedCycle) || now.getUTCDate() === 1;
  let community: Record<string, any> | null = shouldRunCommunity
    ? null
    : { status: 'SKIPPED_NOT_MONTHLY_WINDOW', cycleKey };
  let communityError: string | null = null;

  if (shouldRunCommunity) {
    try {
      community = await finalizeCommunityGymChampionshipCycle(cycleKey);
    } catch (error) {
      communityError = error instanceof Error ? error.message : 'UNKNOWN_COMMUNITY_SETTLEMENT_ERROR';
      console.warn('[GYM_CHAMPIONSHIP_PAYOUT][COMMUNITY_BLOCKED]', { cycleKey, reason: communityError });
    }
  }

  let paid;
  try {
    paid = await runPaidChampionshipSettlementSweep(now);
  } catch (error) {
    console.error('[GYM_CHAMPIONSHIP_PAYOUT][PAID_FATAL]', error);
    return res.status(500).json({ success: false, message: 'Falha técnica ao executar settlement dos Campeonatos Oficiais.' });
  }

  let powerLift;
  try {
    powerLift = await runPowerLiftSettlementSweep(now);
  } catch (error) {
    console.error('[POWER_LIFT_PAYOUT][FATAL]', error);
    return res.status(500).json({ success: false, message: 'Falha técnica ao executar settlement do Power Lift.' });
  }

  for (const blocked of paid.blocked) {
    const log = isExpectedPaidBlock(blocked.reason) ? console.warn : console.error;
    log('[GYM_CHAMPIONSHIP_PAYOUT][PAID_BLOCKED]', blocked);
  }
  for (const blocked of powerLift.blocked) {
    if (blocked.status === 'BLOCKED_REVIEW' || blocked.status === 'IN_PROGRESS') {
      console.warn('[POWER_LIFT_PAYOUT][WAITING]', blocked);
    } else {
      console.error('[POWER_LIFT_PAYOUT][BLOCKED]', blocked);
    }
  }

  const communityExpectedBlock = Boolean(communityError?.includes('atividade(s) competitiva(s) em análise'));
  const unexpectedPaidBlock = paid.blocked.some((item) => !isExpectedPaidBlock(item.reason));
  const unexpectedPowerLiftBlock = powerLift.blocked.some((item) => !['BLOCKED_REVIEW', 'IN_PROGRESS'].includes(String(item.status || '')));
  const unexpectedCommunityError = Boolean(communityError) && !communityExpectedBlock;
  const status = unexpectedPaidBlock || unexpectedPowerLiftBlock || unexpectedCommunityError ? 500 : 200;

  return res.status(status).json({
    success: status === 200,
    cycleKey,
    community: community || { status: communityExpectedBlock ? 'BLOCKED_REVIEW' : 'ERROR', reason: communityError },
    paid,
    powerLift,
  });
}
