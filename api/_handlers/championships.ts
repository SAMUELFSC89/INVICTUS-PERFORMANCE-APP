import { timingSafeEqual } from 'crypto';
import { verifyAuth, db } from '../_lib/common.js';
import { listRuntimeChampionships, getRuntimeChampionship } from '../_lib/championship-catalog.js';
import {
  registrarAceiteRegulamento,
  criarInscricaoChampionship,
  confirmarInscricaoChampionshipPorCheckout,
  confirmarInscricaoChampionshipPorPagamento,
  encerrarCheckoutChampionship,
  registrarEventoFinanceiroChampionship,
  type ChampionshipPaymentRiskEvent,
  getUserRegistrations,
} from '../_lib/championship-inscription-service.js';
import { recordCompetitiveHrAcknowledgement } from '../_lib/competitive-heart-rate-acknowledgement.js';
import { getChampionshipProgress, getChampionshipLeaderboard, getUserChampionshipActivities } from '../_lib/championship-scoring-service.js';
import {
  getPaidChampionshipEditionGate,
  paidChampionshipSettlementDocumentId,
} from '../_lib/paid-championship-edition.js';
import { computeFinalPrizeForEdition, registrationHasClosed } from '../_lib/paid-championship-dynamic-prize.js';
import { publishAdminRealtimeSignalSafe } from '../_lib/admin-realtime.js';

const CHAMPIONSHIP_PAYMENT_RISK_EVENTS = new Set<ChampionshipPaymentRiskEvent>([
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
]);

function erroComoResposta(erro: any): { status: number; message: string } {
  const mensagem = erro?.message || 'Falha ao processar a solicitacao.';
  const ehRegra = /campeonato|regulamento|inscri|CPF|Usuario nao encontrado|encerrad|frequência cardíaca|aceite|regras competitivas|checkout|calendário|premiação|edição|configuração/i.test(mensagem);
  return { status: ehRegra ? 400 : 500, message: mensagem };
}

async function withRevealedPrize(championship: any) {
  // A premiação final (pode ser maior que o mínimo garantido em `prizePool`)
  // só é revelada depois que as inscrições fecham — decisão explícita do
  // usuário em 29/08/2026 ("minimo de 500 de premio, so mostre isso" até lá).
  if (!championship.editionId || !registrationHasClosed(championship)) return championship;
  try {
    const final = await computeFinalPrizeForEdition(championship);
    return {
      ...championship,
      revealedPrizePool: final.prizePool,
      revealedPrizeDistribution: final.prizeDistribution,
      revealedPaidRegistrantCount: final.paidRegistrantCount,
    };
  } catch (error) {
    console.error('[Championships] falha ao calcular premiação final revelada:', error);
    return championship;
  }
}

export async function listChampionshipsHandler(_req: any, res: any) {
  const runtimeChampionships = await listRuntimeChampionships();
  const championships = await Promise.all(runtimeChampionships.map(async (championship) => {
    if (!championship.registrationOpen) return withRevealedPrize(championship);
    try {
      const editionGate = await getPaidChampionshipEditionGate(championship);
      if (editionGate.ok) return withRevealedPrize(championship);
      return withRevealedPrize({
        ...championship,
        registrationOpen: false,
        registrationReadinessReason: editionGate.reason || 'A edição ativa precisa de conciliação antes de novas inscrições.',
      });
    } catch (error) {
      console.error('[Championships] falha ao validar lock da edição no catálogo:', error);
      return withRevealedPrize({
        ...championship,
        registrationOpen: false,
        registrationReadinessReason: 'Não foi possível validar a edição ativa com segurança. Novas inscrições estão temporariamente bloqueadas.',
      });
    }
  }));
  return res.json({ championships });
}

function serializarRegistro(dados: any) {
  const paraIso = (v: any) => {
    if (!v) return undefined;
    if (typeof v === 'string') return v;
    if (typeof v?.toDate === 'function') return v.toDate().toISOString();
    return undefined;
  };
  return {
    ...dados,
    criadaEm: paraIso(dados.criadaEm),
    pagaEm: paraIso(dados.pagaEm),
    reembolsadaEm: paraIso(dados.reembolsadaEm),
    checkoutCriadoEm: paraIso(dados.checkoutCriadoEm),
    checkoutFinalizadoEm: paraIso(dados.checkoutFinalizadoEm),
  };
}

export async function getMyRegistrationsHandler(req: any, res: any) {
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });
  const registrations = await getUserRegistrations(auth.uid);
  return res.json({ registrations: registrations.map(serializarRegistro) });
}

function toIso(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function athleteFinalResult(champ: any, settlement: Record<string, any>, userId: string) {
  if (String(settlement.status || '') !== 'FINALIZED') return null;
  if (String(settlement.championshipId || '') !== String(champ.id || '')
    || String(settlement.editionId || '') !== String(champ.editionId || '')) return null;
  const ranking = Array.isArray(settlement.ranking) ? settlement.ranking : [];
  const index = ranking.findIndex((entry: any) => String(entry?.userId || '') === userId);
  if (index < 0) return null;

  const ineligibleFinalists = Array.isArray(settlement.ineligibleFinalists) ? settlement.ineligibleFinalists : [];
  const ineligibleUserIds = new Set(ineligibleFinalists.map((entry: any) => String(entry?.userId || '')).filter(Boolean));
  if (ineligibleUserIds.has(userId)) return null;

  const assignments = Array.isArray(settlement.winnerAssignments) ? settlement.winnerAssignments : [];
  const assignment = assignments.find((entry: any) => String(entry?.userId || '') === userId);
  const ineligibleFrozenRanks = ineligibleFinalists
    .map((entry: any) => Number(entry?.frozenRank))
    .filter((rank: number) => Number.isInteger(rank) && rank > 0);
  const skippedBefore = ineligibleFrozenRanks.filter((frozenRank: number) => frozenRank < index + 1).length;
  const adjustedRank = Math.max(1, index + 1 - skippedBefore);
  const adjustedParticipants = Math.max(0, ranking.length - new Set(ineligibleFinalists.map((entry: any) => String(entry?.userId || '')).filter(Boolean)).size);

  return {
    championshipId: champ.id,
    editionId: champ.editionId,
    championshipTitle: champ.title,
    edition: champ.edition,
    finalRank: Number(assignment?.rank) || adjustedRank,
    totalParticipants: adjustedParticipants,
    prizeWon: Math.max(0, Number(assignment?.amount) || 0),
    status: 'finalized' as const,
    homologatedAt: toIso(settlement.finalizedAt) || new Date().toISOString(),
  };
}

export async function getChampionshipProgressHandler(req: any, res: any) {
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });
  const championshipId = String(req.query?.championshipId || '');
  const champ = await getRuntimeChampionship(championshipId);
  if (!champ) return res.status(404).json({ error: 'Campeonato nao encontrado.' });
  const editionId = String(champ.editionId || '');
  if (!editionId) return res.status(409).json({ error: 'A edição atual ainda não possui identidade publicada.' });

  const [progresso, settlementSnap] = await Promise.all([
    getChampionshipProgress(championshipId, auth.uid),
    db.collection('championship_settlements').doc(paidChampionshipSettlementDocumentId(editionId)).get(),
  ]);
  const agora = Date.now();
  const fimMs = new Date(champ.endAt).getTime();
  const homologacaoMs = new Date(champ.settlementAt || '').getTime();
  const diasRestantes = Number.isFinite(fimMs) ? Math.max(0, Math.ceil((fimMs - agora) / 86_400_000)) : 0;
  const settlement = settlementSnap.exists ? settlementSnap.data() || {} : {};
  const settlementBelongsToCurrentEdition = String(settlement.editionId || '') === editionId
    && String(settlement.championshipId || '') === championshipId;
  const persistedStatus = settlementBelongsToCurrentEdition ? String(settlement.status || '') : '';
  const settlementStatus = persistedStatus === 'FINALIZED'
    ? 'FINALIZED'
    : persistedStatus === 'LOCKED'
      ? 'LOCKED'
      : Number.isFinite(homologacaoMs) && agora >= homologacaoMs
        ? 'PENDING_REVIEW'
        : 'NOT_DUE';
  const finalResult = settlementBelongsToCurrentEdition ? athleteFinalResult(champ, settlement, auth.uid) : null;

  return res.json({
    championshipId,
    editionId,
    userId: auth.uid,
    ...progresso,
    progressPercentage: champ.durationDays > 0
      ? Math.min(100, Math.round((progresso.totalTimeMinutes / (champ.durationDays * 30)) * 100))
      : 0,
    daysRemaining: diasRestantes,
    settlementStatus,
    settlementAt: champ.settlementAt,
    finalResult,
    lastUpdated: new Date().toISOString(),
  });
}

export async function getChampionshipLeaderboardHandler(req: any, res: any) {
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });
  const championshipId = String(req.query?.championshipId || '');
  const championship = await getRuntimeChampionship(championshipId);
  if (!championship) return res.status(404).json({ error: 'Campeonato nao encontrado.' });
  const leaderboard = await getChampionshipLeaderboard(championshipId, 50);
  return res.json({ championshipId, editionId: championship.editionId, leaderboard });
}

export async function getMyChampionshipActivitiesHandler(req: any, res: any) {
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });
  const championshipId = String(req.query?.championshipId || '');
  const championship = await getRuntimeChampionship(championshipId);
  if (!championship) return res.status(404).json({ error: 'Campeonato nao encontrado.' });
  const activities = await getUserChampionshipActivities(championshipId, auth.uid);
  return res.json({ championshipId, editionId: championship.editionId, activities });
}

export async function acceptChampionshipRegulationHandler(req: any, res: any) {
  try {
    const auth = await verifyAuth(req);
    if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });

    const { championshipId, regulationVersion, regulationHash, locale, platform } = req.body || {};
    if (!championshipId) return res.status(400).json({ error: 'championshipId e obrigatorio.' });

    const championship = await getRuntimeChampionship(championshipId);
    if (!championship) return res.status(404).json({ error: 'Campeonato nao encontrado.' });
    const editionGate = await getPaidChampionshipEditionGate(championship);
    if (!editionGate.ok) {
      return res.status(409).json({ error: editionGate.reason || 'A edição ativa exige conciliação antes de novos aceites.' });
    }
    if (regulationVersion !== championship.regulationVersion || regulationHash !== championship.regulationHash) {
      return res.status(400).json({ error: 'O regulamento foi atualizado. Reabra a inscricao, leia e aceite a versao vigente.' });
    }

    const clientIp = (req.headers?.['x-forwarded-for'] as string) || req.socket?.remoteAddress || '127.0.0.1';
    const userAgent = req.headers?.['user-agent'] || 'Invictus Client';
    const hrAcknowledgement = await recordCompetitiveHrAcknowledgement(
      auth.uid,
      championshipId,
      championship.regulationVersion,
      req.body?.hrAcknowledgement,
    );
    const resultado = await registrarAceiteRegulamento({
      userId: auth.uid,
      championshipId,
      regulationVersion,
      regulationHash,
      ip: Array.isArray(clientIp) ? clientIp[0] : clientIp,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
      locale,
      platform,
      hrAcknowledgementId: hrAcknowledgement.acknowledgementId,
      hrAcknowledgementVersion: hrAcknowledgement.hrAcknowledgementVersion,
    });
    return res.status(201).json({ success: true, ...resultado });
  } catch (erro: any) {
    const { status, message } = erroComoResposta(erro);
    if (status === 500) console.error('[Championships] erro em accept-regulation:', erro);
    return res.status(status).json({ error: message });
  }
}

export async function createChampionshipPaymentHandler(req: any, res: any) {
  try {
    const auth = await verifyAuth(req);
    if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });

    const { championshipId, acceptanceId, checkoutSurface } = req.body || {};
    if (!championshipId || !acceptanceId) {
      return res.status(400).json({ error: 'championshipId e acceptanceId sao obrigatorios.' });
    }
    if (!['ios_native', 'web'].includes(checkoutSurface)) {
      return res.status(400).json({ error: 'Superficie de checkout nao autorizada.' });
    }

    const championship = await getRuntimeChampionship(championshipId);
    if (!championship) return res.status(404).json({ error: 'Campeonato nao encontrado.' });
    if (!championship.registrationOpen) {
      return res.status(400).json({ error: championship.registrationReadinessReason || 'Inscricoes ainda nao disponiveis.' });
    }
    const editionGate = await getPaidChampionshipEditionGate(championship);
    if (!editionGate.ok) {
      return res.status(409).json({ error: editionGate.reason || 'A edição ativa exige conciliação antes de novas inscrições.' });
    }

    const checkout = await criarInscricaoChampionship(
      auth.uid,
      String(championshipId),
      String(acceptanceId),
      checkoutSurface as 'ios_native' | 'web',
    );
    publishAdminRealtimeSignalSafe({ type: 'CHAMPIONSHIP_REGISTRATION_PENDING', source: 'championships:create-payment' });

    return res.json({ success: true, ...checkout });
  } catch (erro: any) {
    const { status, message } = erroComoResposta(erro);
    if (status === 500) console.error('[Championships] erro em payment:', erro);
    return res.status(status).json({ error: message });
  }
}

function webhookTokenIsValid(req: any): boolean {
  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
  const headerToken = req.headers?.['asaas-access-token'];
  const receivedToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  if (!expectedToken || typeof receivedToken !== 'string' || receivedToken.length !== expectedToken.length) return false;
  return timingSafeEqual(Buffer.from(receivedToken), Buffer.from(expectedToken));
}

export async function asaasChampionshipWebhookHandler(req: any, res: any) {
  try {
    if (!process.env.ASAAS_WEBHOOK_TOKEN?.trim()) {
      console.error('[Championship Webhook] ASAAS_WEBHOOK_TOKEN ausente; evento recusado por seguranca.');
      return res.status(503).json({ error: 'Webhook temporariamente indisponivel.' });
    }
    if (!webhookTokenIsValid(req)) {
      console.warn('[Championship Webhook] Requisicao rejeitada: token invalido ou ausente.');
      return res.status(401).json({ error: 'Nao autorizado.' });
    }

    const event = String(req.body?.event || '');
    const checkout = req.body?.checkout;
    const payment = req.body?.payment;
    const providerEventAt = req.body?.dateCreated;
    if (!event) return res.status(200).json({ received: true, ignored: true, reason: 'Evento ausente.' });

    if (event.startsWith('CHECKOUT_')) {
      if (!checkout?.id) return res.status(200).json({ received: true, ignored: true, reason: 'Checkout ausente.' });
      console.log(`[Championship Webhook] ${event} checkout=${checkout.id}`);
      if (event === 'CHECKOUT_PAID') {
        const resultado = await confirmarInscricaoChampionshipPorCheckout(checkout.id);
        publishAdminRealtimeSignalSafe({ type: 'CHAMPIONSHIP_REGISTRATION_CONFIRMED', source: 'championship-webhook:checkout-paid' });
        return res.status(200).json({ received: true, inscricao: resultado });
      }
      if (event === 'CHECKOUT_CANCELED') {
        const resultado = await encerrarCheckoutChampionship(checkout.id, 'cancelled');
        publishAdminRealtimeSignalSafe({ type: 'CHAMPIONSHIP_CHANGED', source: 'championship-webhook:checkout-cancelled' });
        return res.status(200).json({ received: true, inscricao: resultado });
      }
      if (event === 'CHECKOUT_EXPIRED') {
        const resultado = await encerrarCheckoutChampionship(checkout.id, 'expired');
        publishAdminRealtimeSignalSafe({ type: 'CHAMPIONSHIP_CHANGED', source: 'championship-webhook:checkout-expired' });
        return res.status(200).json({ received: true, inscricao: resultado });
      }
      return res.status(200).json({ received: true, ignored: event });
    }

    if (!payment?.id) {
      return res.status(200).json({ received: true, ignored: true, reason: 'Payload sem cobranca.' });
    }
    const checkoutSession = String(payment.checkoutSession || payment.checkout?.id || '');
    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_REFUND_DENIED') {
      const resultado = await confirmarInscricaoChampionshipPorPagamento(
        payment.id,
        payment.value,
        checkoutSession || undefined,
        payment.externalReference,
        providerEventAt,
      );
      publishAdminRealtimeSignalSafe({ type: 'CHAMPIONSHIP_REGISTRATION_CONFIRMED', source: 'championship-webhook:payment-confirmed' });
      return res.status(200).json({ received: true, inscricao: resultado });
    }
    if (CHAMPIONSHIP_PAYMENT_RISK_EVENTS.has(event as ChampionshipPaymentRiskEvent)) {
      const resultado = await registrarEventoFinanceiroChampionship(
        payment.id,
        event as ChampionshipPaymentRiskEvent,
        checkoutSession || undefined,
        payment.externalReference,
        payment.value,
        providerEventAt,
      );
      publishAdminRealtimeSignalSafe({ type: 'CHAMPIONSHIP_PAYMENT_RECONCILIATION_REQUIRED', source: 'championship-webhook:payment-risk' });
      return res.status(200).json({ received: true, inscricao: resultado });
    }
    return res.status(200).json({ received: true, ignored: event });
  } catch (erro: any) {
    console.error('[Championship Webhook] erro:', erro);
    return res.status(500).json({ error: 'Erro interno ao processar webhook do Asaas.' });
  }
}

export async function submitActivityToChampionshipHandler(req: any, res: any) {
  try {
    const auth = await verifyAuth(req);
    if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });

    const { championshipId, activityId } = req.body || {};
    if (!championshipId || !activityId) {
      return res.status(400).json({ error: 'championshipId e activityId sao obrigatorios.' });
    }
    const championship = await getRuntimeChampionship(String(championshipId));
    if (!championship?.editionId) return res.status(404).json({ error: 'Campeonato ou edição não encontrado.' });

    const scoreId = `${activityId}_${championship.editionId}`;
    const doc = await db.collection('championship_scores').doc(scoreId).get();
    if (!doc.exists) {
      return res.json({
        success: true,
        computed: false,
        message: 'Esta atividade ainda nao foi processada para esta edição (ou nao se qualifica).',
      });
    }

    const dados: any = doc.data();
    if (dados.userId !== auth.uid) return res.status(403).json({ error: 'Esta atividade nao pertence a este usuario.' });
    if (String(dados.championshipId || '') !== championship.id || String(dados.editionId || '') !== championship.editionId) {
      return res.status(409).json({ error: 'O score encontrado pertence a outra edição.' });
    }
    return res.json({
      success: true,
      computed: true,
      championshipId: championship.id,
      editionId: championship.editionId,
      eligible: dados.championshipValidation?.eligible ?? false,
      scoreAdded: dados.score || 0,
      riskScore: dados.championshipValidation?.riskScore ?? 0,
      evaluatedAt: dados.championshipValidation?.evaluatedAt,
      message: dados.validationStatus === 'VALIDATED'
        ? 'Atividade homologada com sucesso no ranking do campeonato.'
        : 'Atividade nao atende aos criterios de integridade do campeonato.',
    });
  } catch (erro: any) {
    console.error('[Championships] erro em submit-activity:', erro);
    return res.status(500).json({ error: 'Erro ao consultar homologacao da atividade no campeonato.' });
  }
}
