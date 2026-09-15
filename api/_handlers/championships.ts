import { timingSafeEqual } from 'crypto';
import { verifyAuth, db } from '../_lib/common.js';
import { listChampionships, getChampionship } from '../_lib/championship-catalog.js';
import {
  registrarAceiteRegulamento,
  confirmarInscricaoChampionshipPorCheckout,
  confirmarInscricaoChampionshipPorPagamento,
  encerrarCheckoutChampionship,
  registrarEventoFinanceiroChampionship,
  type ChampionshipPaymentRiskEvent,
  getUserRegistrations,
} from '../_lib/championship-inscription-service.js';
import { recordCompetitiveHrAcknowledgement } from '../_lib/competitive-heart-rate-acknowledgement.js';
import { getChampionshipProgress, getChampionshipLeaderboard, getUserChampionshipActivities } from '../_lib/championship-scoring-service.js';
import { criarPresenceCheck } from '../_lib/presence-check-service.js';

const CHAMPIONSHIP_PAYMENT_RISK_EVENTS = new Set<ChampionshipPaymentRiskEvent>([
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
]);

/**
 * Campeonatos pagos usam um catálogo servidor-autoritativo, aceite versionado,
 * presença verificada e Checkout Asaas hospedado. O navegador apenas conduz o
 * pagamento; a inscrição só é ativada por evento financeiro autenticado.
 */

function erroComoResposta(erro: any): { status: number; message: string } {
  const mensagem = erro?.message || 'Falha ao processar a solicitacao.';
  const ehRegra = /campeonato|regulamento|inscri|CPF|Usuario nao encontrado|encerrad|frequência cardíaca|aceite|regras competitivas|checkout|calendário|premiação/i.test(mensagem);
  return { status: ehRegra ? 400 : 500, message: mensagem };
}

export async function listChampionshipsHandler(_req: any, res: any) {
  return res.json({ championships: listChampionships() });
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
  const ranking = Array.isArray(settlement.ranking) ? settlement.ranking : [];
  const index = ranking.findIndex((entry: any) => String(entry?.userId || '') === userId);
  if (index < 0) return null;
  const assignment = (Array.isArray(settlement.winnerAssignments) ? settlement.winnerAssignments : [])
    .find((entry: any) => String(entry?.userId || '') === userId);
  return {
    championshipId: champ.id,
    championshipTitle: champ.title,
    edition: champ.edition,
    finalRank: Number(assignment?.rank) || index + 1,
    totalParticipants: ranking.length,
    prizeWon: Math.max(0, Number(assignment?.amount) || 0),
    status: 'finalized' as const,
    homologatedAt: toIso(settlement.finalizedAt) || new Date().toISOString(),
  };
}

export async function getChampionshipProgressHandler(req: any, res: any) {
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });
  const championshipId = String(req.query?.championshipId || '');
  const champ = getChampionship(championshipId);
  if (!champ) return res.status(404).json({ error: 'Campeonato nao encontrado.' });

  const [progresso, settlementSnap] = await Promise.all([
    getChampionshipProgress(championshipId, auth.uid),
    db.collection('championship_settlements').doc(championshipId).get(),
  ]);
  const agora = Date.now();
  const fimMs = new Date(champ.endAt).getTime();
  const homologacaoMs = new Date(champ.settlementAt || '').getTime();
  const diasRestantes = Number.isFinite(fimMs) ? Math.max(0, Math.ceil((fimMs - agora) / 86_400_000)) : 0;
  const settlement = settlementSnap.exists ? settlementSnap.data() || {} : {};
  const persistedStatus = String(settlement.status || '');
  const settlementStatus = persistedStatus === 'FINALIZED'
    ? 'FINALIZED'
    : persistedStatus === 'LOCKED'
      ? 'LOCKED'
      : Number.isFinite(homologacaoMs) && agora >= homologacaoMs
        ? 'PENDING_REVIEW'
        : 'NOT_DUE';
  const finalResult = athleteFinalResult(champ, settlement, auth.uid);

  return res.json({
    championshipId,
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
  if (!getChampionship(championshipId)) return res.status(404).json({ error: 'Campeonato nao encontrado.' });
  const leaderboard = await getChampionshipLeaderboard(championshipId, 50);
  return res.json({ championshipId, leaderboard });
}

export async function getMyChampionshipActivitiesHandler(req: any, res: any) {
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });
  const championshipId = String(req.query?.championshipId || '');
  if (!getChampionship(championshipId)) return res.status(404).json({ error: 'Campeonato nao encontrado.' });
  const activities = await getUserChampionshipActivities(championshipId, auth.uid);
  return res.json({ championshipId, activities });
}

export async function acceptChampionshipRegulationHandler(req: any, res: any) {
  try {
    const auth = await verifyAuth(req);
    if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });

    const { championshipId, regulationVersion, regulationHash, locale, platform } = req.body || {};
    if (!championshipId) return res.status(400).json({ error: 'championshipId e obrigatorio.' });

    const championship = getChampionship(championshipId);
    if (!championship) return res.status(404).json({ error: 'Campeonato nao encontrado.' });
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

/**
 * Inicia a inscrição. Antes de criar o Checkout hospedado, confirma presença
 * e identidade por selfie. `checkoutSurface` aceita iOS nativo agora e web
 * para o site Android futuro; o app Android não expõe esse CTA.
 */
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

    const championship = getChampionship(championshipId);
    if (!championship) return res.status(404).json({ error: 'Campeonato nao encontrado.' });
    if (!championship.registrationOpen) {
      return res.status(400).json({ error: championship.registrationReadinessReason || 'Inscricoes ainda nao disponiveis.' });
    }

    const { presenceCheckId, livenessPrompt } = await criarPresenceCheck({
      userId: auth.uid,
      actionType: 'championship_registration',
      payload: { championshipId, acceptanceId, checkoutSurface },
    });

    return res.json({
      success: true,
      presenceCheckRequired: true,
      presenceCheckId,
      livenessPrompt,
      userMessage: 'Confirme sua presença por selfie. Depois da aprovação, o checkout seguro do Asaas será aberto.',
    });
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

/**
 * Aceita eventos CHECKOUT_* atuais e mantém PAYMENT_* por compatibilidade.
 * Ambos seguem a mesma maquina de estados financeira do webhook central.
 */
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
        return res.status(200).json({ received: true, inscricao: resultado });
      }
      if (event === 'CHECKOUT_CANCELED') {
        const resultado = await encerrarCheckoutChampionship(checkout.id, 'cancelled');
        return res.status(200).json({ received: true, inscricao: resultado });
      }
      if (event === 'CHECKOUT_EXPIRED') {
        const resultado = await encerrarCheckoutChampionship(checkout.id, 'expired');
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
      return res.status(200).json({ received: true, inscricao: resultado });
    }
    return res.status(200).json({ received: true, ignored: event });
  } catch (erro: any) {
    console.error('[Championship Webhook] erro:', erro);
    return res.status(500).json({ error: 'Erro interno ao processar webhook do Asaas.' });
  }
}

/**
 * Consulta somente o resultado já calculado pelo servidor. O cliente nunca
 * envia score ou risco como autoridade competitiva.
 */
export async function submitActivityToChampionshipHandler(req: any, res: any) {
  try {
    const auth = await verifyAuth(req);
    if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });

    const { championshipId, activityId } = req.body || {};
    if (!championshipId || !activityId) {
      return res.status(400).json({ error: 'championshipId e activityId sao obrigatorios.' });
    }

    const scoreId = `${activityId}_${championshipId}`;
    const doc = await db.collection('championship_scores').doc(scoreId).get();
    if (!doc.exists) {
      return res.json({
        success: true,
        computed: false,
        message: 'Esta atividade ainda nao foi processada para este campeonato (ou nao se qualifica).',
      });
    }

    const dados: any = doc.data();
    if (dados.userId !== auth.uid) return res.status(403).json({ error: 'Esta atividade nao pertence a este usuario.' });
    return res.json({
      success: true,
      computed: true,
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
