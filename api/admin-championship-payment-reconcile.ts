import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authMiddleware } from './_middleware/auth.js';
import { corsMiddleware } from './_middleware/cors.js';
import { db } from './_lib/common.js';
import { hasActiveAdminAuthority } from './_lib/admin-authority.js';
import { AsaasClient } from './_lib/asaas-client.js';
import { confirmarInscricaoChampionshipPorPagamento } from './_lib/championship-inscription-service.js';
import { paidChampionshipRegistrationId } from './_lib/paid-championship-edition.js';
import { logEvent } from './_lib/observability.js';

/**
 * Recovery endpoint for the single paid Sandbox checkout that could not reach
 * the application because the Asaas webhook target returned HTTP 308.
 *
 * The endpoint never trusts the browser as payment authority. It re-reads the
 * payment directly from Asaas with the server-side API key, checks the exact
 * checkout/session, amount, edition and provider status, then delegates to the
 * canonical championship payment confirmation path.
 */
const ALLOWED_CHAMPIONSHIP_ID = 'invictus_strength_v1';
const ALLOWED_EDITION_ID = 'invictus_strength_v1_99601b0d14ed9184367b44fa';
const ALLOWED_PAYMENT_ID = 'pay_0vz6pyopftgcso8t';
const ALLOWED_CHECKOUT_ID = '862d7f51-7fa8-48ca-b4ee-32fc7001e54b';
const CONFIRMATION = 'RECONCILE_STRENGTH_SANDBOX_PAYMENT_0VZ6';
const CONFIRMED_PROVIDER_STATUSES = new Set(['RECEIVED', 'CONFIRMED']);

export default async function handler(
  req: VercelRequest & { userId?: string; userEmail?: string },
  res: VercelResponse,
) {
  if (corsMiddleware(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  if (!(await authMiddleware(req, res))) return;

  const userSnap = await db.collection('users').doc(req.userId!).get();
  if (!userSnap.exists || !hasActiveAdminAuthority(userSnap.data())) {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }

  const championshipId = String(req.body?.championshipId || '').trim();
  const editionId = String(req.body?.editionId || '').trim();
  const paymentId = String(req.body?.paymentId || '').trim();
  const checkoutId = String(req.body?.checkoutId || '').trim();
  const confirmation = String(req.body?.confirmation || '').trim();

  if (
    championshipId !== ALLOWED_CHAMPIONSHIP_ID
    || editionId !== ALLOWED_EDITION_ID
    || paymentId !== ALLOWED_PAYMENT_ID
    || checkoutId !== ALLOWED_CHECKOUT_ID
    || confirmation !== CONFIRMATION
  ) {
    return res.status(400).json({ error: 'Reconciliação sandbox não autorizada para estes identificadores.' });
  }

  const registrationId = paidChampionshipRegistrationId(req.userId!, editionId);
  const registrationRef = db.collection('championship_registrations').doc(registrationId);
  const registrationSnap = await registrationRef.get();
  if (!registrationSnap.exists) {
    return res.status(404).json({ error: 'Inscrição sandbox não encontrada para a conta administrativa atual.' });
  }

  const registration = registrationSnap.data() || {};
  if (
    String(registration.championshipId || '') !== championshipId
    || String(registration.editionId || '') !== editionId
  ) {
    return res.status(409).json({ error: 'A inscrição localizada pertence a outro campeonato ou edição.' });
  }

  if (registration.status === 'paga' && registration.paymentStatus === 'PAID') {
    return res.status(200).json({
      success: true,
      alreadyReconciled: true,
      championshipId,
      editionId,
      registrationId,
    });
  }

  if (String(registration.asaasCheckoutId || '') !== checkoutId) {
    return res.status(409).json({
      error: 'O checkout pago não corresponde ao checkout atualmente vinculado à inscrição. Nenhuma alteração foi feita.',
      expectedCheckoutId: registration.asaasCheckoutId || null,
    });
  }

  const providerPayment = await AsaasClient.obterCobranca(paymentId);
  const providerStatus = String(providerPayment.status || '').toUpperCase();
  const providerCheckoutId = String(providerPayment.raw?.checkoutSession || providerPayment.raw?.checkout?.id || '').trim();
  const providerDeleted = providerPayment.raw?.deleted === true;
  const expectedAmount = Number(registration.valor);
  const amountMatches = Number.isFinite(expectedAmount)
    && Math.abs(Number(providerPayment.value) - expectedAmount) < 0.01;

  if (
    providerDeleted
    || !CONFIRMED_PROVIDER_STATUSES.has(providerStatus)
    || providerCheckoutId !== checkoutId
    || !amountMatches
  ) {
    await logEvent({
      severity: 'HIGH_RISK',
      category: 'system_logs',
      message: 'Reconciliação sandbox recusada por divergência nos dados consultados diretamente no Asaas.',
      userId: req.userId!,
      route: '/api/admin-championship-payment-reconcile',
      details: {
        championshipId,
        editionId,
        paymentId,
        checkoutId,
        providerStatus,
        providerCheckoutId,
        providerDeleted,
        providerValue: providerPayment.value,
        expectedAmount,
      },
    });
    return res.status(409).json({
      error: 'O pagamento consultado no Asaas ainda não atende aos critérios seguros de confirmação.',
      providerStatus,
      checkoutMatches: providerCheckoutId === checkoutId,
      amountMatches,
      deleted: providerDeleted,
    });
  }

  const providerObservedAt = providerPayment.raw?.confirmedDate
    || providerPayment.raw?.paymentDate
    || providerPayment.raw?.clientPaymentDate
    || providerPayment.raw?.dateCreated
    || new Date().toISOString();

  const result = await confirmarInscricaoChampionshipPorPagamento(
    paymentId,
    providerPayment.value,
    checkoutId,
    providerPayment.raw?.externalReference,
    providerObservedAt,
  );
  const requiresReconciliation = 'requerReconciliacao' in result
    && result.requerReconciliacao === true;

  if (!result.encontrada || requiresReconciliation) {
    return res.status(409).json({
      error: 'O pagamento foi localizado no Asaas, mas a inscrição exige conciliação adicional.',
      result,
    });
  }

  await logEvent({
    severity: 'HIGH_RISK',
    category: 'system_logs',
    message: 'Pagamento Sandbox do campeonato reconciliado diretamente com o Asaas após falha de webhook HTTP 308.',
    userId: req.userId!,
    route: '/api/admin-championship-payment-reconcile',
    details: {
      championshipId,
      editionId,
      registrationId,
      paymentId,
      checkoutId,
      providerStatus,
      providerValue: providerPayment.value,
    },
  });

  return res.status(200).json({
    success: true,
    championshipId,
    editionId,
    registrationId,
    paymentId,
    checkoutId,
    providerStatus,
    registration: result,
  });
}
