import { timingSafeEqual } from 'crypto';
import { verifyAuth } from '../_lib/common.js';
import { listChampionships, getChampionship } from '../_lib/championship-catalog.js';
import {
  registrarAceiteRegulamento,
  confirmarInscricaoChampionshipPorPagamento,
  marcarInscricaoChampionshipComoReembolsada,
  getUserRegistrations,
} from '../_lib/championship-inscription-service.js';
import { getChampionshipProgress, getChampionshipLeaderboard, getUserChampionshipActivities } from '../_lib/championship-scoring-service.js';
import { db } from '../_lib/common.js';
import { criarPresenceCheck } from '../_lib/presence-check-service.js';

/**
 * Handlers de Campeonatos -- reescritos em 2026-08 para rodar sobre
 * Firestore + Asaas de verdade.
 *
 * Ate aqui (ver AUDITORIA-CORE-INVICTUS.md e git blame deste arquivo):
 * - accept-regulation gravava o aceite num Map em memoria (perdido a cada
 *   cold start / cada instancia serverless tem o seu proprio Map).
 * - payment confiava em `userId` mandado no corpo da requisicao -- qualquer
 *   pessoa podia se inscrever em nome de outra so trocando o body.
 * - o "checkout" no app (ChampionshipCheckoutAsaas.tsx) nunca chamava esse
 *   endpoint de pagamento de verdade: mostrava um QR code decorativo fixo e
 *   tinha um botao "Simular Pagamento Aprovado" que so chamava o webhook
 *   diretamente -- ou seja, NENHUM dinheiro real trafegava, mas a tela
 *   parecia uma cobranca real de producao.
 * - submit-activity confiava no `riskScore` que o proprio cliente mandava.
 *
 * Todos os pontos acima foram corrigidos: userId sempre vem do token
 * verificado (verifyAuth), a cobranca e uma cobranca PIX real via
 * AsaasClient (mesmo cliente ja usado e comprovado pela inscricao de
 * temporada), e a pontuacao de campeonato e escrita so pelo servidor,
 * automaticamente, a partir de atividades ja homologadas pelo
 * SecurityPipeline + IGA (ver championship-scoring-service.ts).
 */

function erroComoResposta(erro: any): { status: number; message: string } {
  const mensagem = erro?.message || 'Falha ao processar a solicitacao.';
  const ehRegra = /campeonato|regulamento|inscri|CPF|Usuario nao encontrado|encerrad/i.test(mensagem);
  return { status: ehRegra ? 400 : 500, message: mensagem };
}

/** GET /api/championships -- catalogo publico (preco, janela, regulamento vigente). */
export async function listChampionshipsHandler(req: any, res: any) {
  return res.json({ championships: listChampionships() });
}

/**
 * Campos gravados com FieldValue.serverTimestamp() viram um Timestamp do
 * Admin SDK, que NAO serializa como string ISO num res.json() comum -- viraria
 * {_seconds,_nanoseconds} ou objeto vazio no JSON. Normaliza pra ISO string
 * antes de responder ao app.
 */
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
  };
}

/** GET /api/championships/my-registrations -- inscricoes do usuario autenticado. */
export async function getMyRegistrationsHandler(req: any, res: any) {
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });

  const registrations = await getUserRegistrations(auth.uid);
  return res.json({ registrations: registrations.map(serializarRegistro) });
}

/** GET /api/championships/progress?championshipId=X -- progresso real do usuario autenticado. */
export async function getChampionshipProgressHandler(req: any, res: any) {
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });

  const championshipId = String(req.query?.championshipId || '');
  const champ = getChampionship(championshipId);
  if (!champ) return res.status(404).json({ error: 'Campeonato nao encontrado.' });

  const progresso = await getChampionshipProgress(championshipId, auth.uid);
  const agora = Date.now();
  const fimMs = new Date(champ.endAt).getTime();
  const diasRestantes = Math.max(0, Math.ceil((fimMs - agora) / (1000 * 60 * 60 * 24)));

  return res.json({
    championshipId,
    userId: auth.uid,
    ...progresso,
    progressPercentage: champ.durationDays > 0
      ? Math.min(100, Math.round((progresso.totalTimeMinutes / (champ.durationDays * 30)) * 100))
      : 0,
    daysRemaining: diasRestantes,
    lastUpdated: new Date().toISOString(),
  });
}

/** GET /api/championships/leaderboard?championshipId=X -- ranking real (publico). */
export async function getChampionshipLeaderboardHandler(req: any, res: any) {
  const championshipId = String(req.query?.championshipId || '');
  if (!getChampionship(championshipId)) {
    return res.status(404).json({ error: 'Campeonato nao encontrado.' });
  }
  const leaderboard = await getChampionshipLeaderboard(championshipId, 50);
  return res.json({ championshipId, leaderboard });
}

/** GET /api/championships/my-activities?championshipId=X -- atividades homologadas do usuario neste campeonato. */
export async function getMyChampionshipActivitiesHandler(req: any, res: any) {
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });

  const championshipId = String(req.query?.championshipId || '');
  if (!getChampionship(championshipId)) {
    return res.status(404).json({ error: 'Campeonato nao encontrado.' });
  }

  const activities = await getUserChampionshipActivities(championshipId, auth.uid);
  return res.json({ championshipId, activities });
}

/**
 * POST /api/championships/accept-regulation
 * Body: { championshipId, regulationVersion, regulationHash }
 */
export async function acceptChampionshipRegulationHandler(req: any, res: any) {
  try {
    const auth = await verifyAuth(req);
    if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });

    const { championshipId, regulationVersion, regulationHash, locale, platform } = req.body || {};
    if (!championshipId) {
      return res.status(400).json({ error: 'championshipId e obrigatorio.' });
    }

    const clientIp = (req.headers?.['x-forwarded-for'] as string) || req.socket?.remoteAddress || '127.0.0.1';
    const userAgent = req.headers?.['user-agent'] || 'Invictus Client';

    const resultado = await registrarAceiteRegulamento({
      userId: auth.uid,
      championshipId,
      regulationVersion,
      regulationHash,
      ip: Array.isArray(clientIp) ? clientIp[0] : clientIp,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
      locale,
      platform,
    });

    return res.status(201).json({ success: true, ...resultado });
  } catch (erro: any) {
    const { status, message } = erroComoResposta(erro);
    if (status === 500) console.error('[Championships] erro em accept-regulation:', erro);
    return res.status(status).json({ error: message });
  }
}

/**
 * POST /api/championships/payment
 * Body: { championshipId, acceptanceId }
 * Emite a cobranca PIX real via Asaas e devolve o QR code (base64) + copia-e-cola.
 *
 * Antes de emitir a cobranca (dinheiro real em disputa), exige confirmacao de
 * presenca por selfie -- mesmo mecanismo usado no check-in de academia (ver
 * api/_lib/presence-check-service.ts). Em vez de chamar criarInscricaoChampionship
 * direto, cria um `pending_presence_checks` e devolve presenceCheckRequired; a
 * inscricao so e de fato criada em api/_handlers/validate-presence.ts, apos a
 * selfie ser aprovada (actionType 'championship_registration').
 */
export async function createChampionshipPaymentHandler(req: any, res: any) {
  try {
    const auth = await verifyAuth(req);
    if (!auth) return res.status(401).json({ error: 'Nao autenticado.' });

    const { championshipId, acceptanceId } = req.body || {};
    if (!championshipId || !acceptanceId) {
      return res.status(400).json({ error: 'championshipId e acceptanceId sao obrigatorios.' });
    }

    const { presenceCheckId, livenessPrompt } = await criarPresenceCheck({
      userId: auth.uid,
      actionType: 'championship_registration',
      payload: { championshipId, acceptanceId },
    });

    return res.json({
      success: true,
      presenceCheckRequired: true,
      presenceCheckId,
      livenessPrompt,
      userMessage: 'Confirme sua presenca por selfie para emitir a cobranca da inscricao.',
    });
  } catch (erro: any) {
    const { status, message } = erroComoResposta(erro);
    if (status === 500) console.error('[Championships] erro em payment:', erro);
    return res.status(status).json({ error: message });
  }
}

/**
 * POST /api/championships/webhook-asaas
 * Espelha api/_handlers/asaas-webhook.ts (mesma verificacao de token
 * asaas-access-token via timingSafeEqual), mas so entende eventos de
 * cobranca (PAYMENT_*) de inscricao em campeonato.
 */
export async function asaasChampionshipWebhookHandler(req: any, res: any) {
  try {
    const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
    const headerToken = req.headers?.['asaas-access-token'];
    const receivedToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;

    if (!expectedToken) {
      console.error('[Championship Webhook] ASAAS_WEBHOOK_TOKEN ausente; evento recusado por seguranca.');
      return res.status(503).json({ error: 'Webhook temporariamente indisponivel.' });
    }

    const tokenMatches = typeof receivedToken === 'string'
      && receivedToken.length === expectedToken.length
      && timingSafeEqual(Buffer.from(receivedToken), Buffer.from(expectedToken));

    if (!tokenMatches) {
      console.warn('[Championship Webhook] Requisicao rejeitada: token de acesso invalido ou ausente.');
      return res.status(401).json({ error: 'Nao autorizado.' });
    }

    const event = req.body?.event as string;
    const payment = req.body?.payment;
    if (!event || !payment?.id) {
      return res.status(200).json({ received: true, ignored: true, reason: 'Payload sem evento de cobranca.' });
    }

    console.log(`[Championship Webhook] Evento: ${event} para pagamento ${payment.id} (status: ${payment.status})`);

    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      const resultado = await confirmarInscricaoChampionshipPorPagamento(payment.id, payment.value);
      return res.status(200).json({ received: true, inscricao: resultado });
    }

    if (event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_CHARGEBACK_REQUESTED') {
      const resultado = await marcarInscricaoChampionshipComoReembolsada(payment.id);
      return res.status(200).json({ received: true, inscricao: resultado });
    }

    return res.status(200).json({ received: true, ignorado: event });
  } catch (erro: any) {
    console.error('[Championship Webhook] erro:', erro);
    return res.status(500).json({ error: 'Erro interno ao processar webhook do Asaas.' });
  }
}

/**
 * POST /api/championships/submit-activity
 * Body: { championshipId, activityId }
 *
 * Somente LEITURA hoje: a pontuacao de campeonato e escrita automaticamente
 * pelo servidor (championship-scoring-service.ts, chamado de dentro de
 * validate-activity-service.ts) assim que uma atividade e homologada. Este
 * endpoint so devolve o resultado ja computado para o app confirmar na UI --
 * nunca aceita `score`/`riskScore` vindo do cliente, porque isso seria
 * confiar no cliente para decidir a propria pontuacao de uma competicao com
 * premio em dinheiro real.
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
    if (dados.userId !== auth.uid) {
      return res.status(403).json({ error: 'Esta atividade nao pertence a este usuario.' });
    }

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
