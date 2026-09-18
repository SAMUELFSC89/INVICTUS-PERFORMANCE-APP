import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authMiddleware } from './_middleware/auth.js';
import { corsMiddleware } from './_middleware/cors.js';
import { db } from './_lib/common.js';
import { getRuntimeChampionship } from './_lib/championship-catalog.js';
import { getAsaasBaseUrl } from './_lib/asaas-client.js';
import { confirmarInscricaoChampionshipPorPagamento } from './_lib/championship-inscription-service.js';
import { paidChampionshipRegistrationId } from './_lib/paid-championship-edition.js';
import { logEvent } from './_lib/observability.js';

const CONFIRMED_PROVIDER_STATUSES = new Set(['RECEIVED', 'CONFIRMED']);
const TERMINAL_LOCAL_STATUSES = new Set(['reembolsada', 'contestada']);

function amountMatches(expected: unknown, received: unknown): boolean {
  const expectedValue = Number(expected);
  const receivedValue = Number(received);
  return Number.isFinite(expectedValue)
    && Number.isFinite(receivedValue)
    && Math.abs(expectedValue - receivedValue) < 0.01;
}

function providerObservedAt(payment: any): string {
  return payment?.confirmedDate
    || payment?.paymentDate
    || payment?.clientPaymentDate
    || payment?.dateCreated
    || new Date().toISOString();
}

export default async function handler(
  req: VercelRequest & { userId?: string; userEmail?: string },
  res: VercelResponse,
) {
  if (corsMiddleware(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  if (!(await authMiddleware(req, res))) return;

  const championshipId = String(req.body?.championshipId || '').trim();
  if (!championshipId) return res.status(400).json({ error: 'championshipId é obrigatório.' });

  const championship = await getRuntimeChampionship(championshipId);
  if (!championship) return res.status(404).json({ error: 'Campeonato não encontrado.' });

  const editionId = String(championship.editionId || '').trim();
  if (!editionId) return res.status(409).json({ error: 'A edição atual ainda não possui identidade publicada.' });

  const registrationId = paidChampionshipRegistrationId(req.userId!, editionId);
  const registrationRef = db.collection('championship_registrations').doc(registrationId);
  const registrationSnap = await registrationRef.get();
  if (!registrationSnap.exists) {
    return res.status(404).json({ error: 'Inscrição não encontrada para esta edição.' });
  }

  const registration = registrationSnap.data() || {};
  if (
    String(registration.userId || '') !== req.userId
    || String(registration.championshipId || '') !== championshipId
    || String(registration.editionId || '') !== editionId
  ) {
    return res.status(409).json({ error: 'A inscrição localizada não corresponde à conta e edição atuais.' });
  }

  if (registration.status === 'paga' && registration.paymentStatus === 'PAID') {
    return res.status(200).json({
      success: true,
      reconciled: false,
      alreadyPaid: true,
      championshipId,
      editionId,
      registrationId,
      status: 'paga',
      paymentStatus: 'PAID',
    });
  }

  if (TERMINAL_LOCAL_STATUSES.has(String(registration.status || ''))) {
    return res.status(409).json({
      error: 'Esta inscrição possui estado financeiro encerrado e não pode ser reativada por consulta de status.',
    });
  }

  const checkoutId = String(registration.asaasCheckoutId || '').trim();
  if (!checkoutId) {
    return res.status(409).json({ error: 'A inscrição ainda não possui checkout vinculado.' });
  }

  const apiKey = String(process.env.ASAAS_API_KEY || '').trim();
  if (!apiKey) {
    console.error('[Championship reconcile] ASAAS_API_KEY ausente.');
    return res.status(503).json({ error: 'Consulta ao provedor temporariamente indisponível.' });
  }

  const endpoint = new URL(`${getAsaasBaseUrl().replace(/\/$/, '')}/payments`);
  endpoint.searchParams.set('checkoutSession', checkoutId);
  endpoint.searchParams.set('limit', '100');

  let providerResponse: Response;
  try {
    providerResponse = await fetch(endpoint, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'InvictusPerformance/1.0 (Node.js)',
        access_token: apiKey,
      },
    });
  } catch (error) {
    console.error('[Championship reconcile] falha de rede ao consultar Asaas:', error);
    return res.status(503).json({ error: 'Não foi possível consultar o provedor agora. Tente novamente em instantes.' });
  }

  const providerData: any = await providerResponse.json().catch(() => ({}));
  if (!providerResponse.ok) {
    console.error('[Championship reconcile] Asaas recusou consulta pontual:', providerResponse.status);
    return res.status(502).json({ error: 'O provedor não respondeu à consulta de status como esperado.' });
  }

  const candidates = (Array.isArray(providerData?.data) ? providerData.data : [])
    .filter((payment: any) => payment?.id
      && String(payment.checkoutSession || payment.checkout?.id || '') === checkoutId
      && payment.deleted !== true);

  if (candidates.length === 0) {
    return res.status(200).json({
      success: true,
      reconciled: false,
      paymentFound: false,
      championshipId,
      editionId,
      registrationId,
      status: registration.status || 'pendente',
      paymentStatus: registration.paymentStatus || 'PENDING',
    });
  }

  const matchingPaid = candidates.filter((payment: any) =>
    CONFIRMED_PROVIDER_STATUSES.has(String(payment.status || '').toUpperCase())
    && amountMatches(registration.valor, payment.value));

  if (matchingPaid.length > 1) {
    await logEvent({
      severity: 'HIGH_RISK',
      category: 'system_logs',
      message: 'Conciliação automática de campeonato bloqueada por múltiplos pagamentos confirmados no mesmo checkout.',
      userId: req.userId!,
      route: '/api/championship-payment-reconcile',
      details: { championshipId, editionId, registrationId, checkoutId, paymentIds: matchingPaid.map((payment: any) => payment.id) },
    });
    return res.status(409).json({ error: 'Foram encontrados múltiplos pagamentos confirmados. A inscrição exige conciliação manual.' });
  }

  if (matchingPaid.length === 0) {
    const latest = candidates
      .slice()
      .sort((left: any, right: any) => String(right.dateCreated || '').localeCompare(String(left.dateCreated || '')))[0];
    return res.status(200).json({
      success: true,
      reconciled: false,
      paymentFound: true,
      providerStatus: String(latest?.status || 'PENDING'),
      championshipId,
      editionId,
      registrationId,
      status: registration.status || 'pendente',
      paymentStatus: registration.paymentStatus || 'PENDING',
    });
  }

  const payment = matchingPaid[0];
  const result = await confirmarInscricaoChampionshipPorPagamento(
    String(payment.id),
    Number(payment.value),
    checkoutId,
    payment.externalReference,
    providerObservedAt(payment),
  );
  const requiresReconciliation = 'requerReconciliacao' in result
    && result.requerReconciliacao === true;

  if (!result.encontrada || requiresReconciliation) {
    return res.status(409).json({
      error: 'O pagamento foi confirmado no provedor, mas a inscrição exige conciliação adicional.',
    });
  }

  await logEvent({
    severity: 'HIGH_RISK',
    category: 'system_logs',
    message: 'Pagamento de campeonato reconciliado por consulta pontual autenticada ao Asaas.',
    userId: req.userId!,
    route: '/api/championship-payment-reconcile',
    details: {
      championshipId,
      editionId,
      registrationId,
      checkoutId,
      paymentId: payment.id,
      providerStatus: payment.status,
      providerValue: payment.value,
    },
  });

  return res.status(200).json({
    success: true,
    reconciled: true,
    championshipId,
    editionId,
    registrationId,
    status: 'paga',
    paymentStatus: 'PAID',
  });
}
