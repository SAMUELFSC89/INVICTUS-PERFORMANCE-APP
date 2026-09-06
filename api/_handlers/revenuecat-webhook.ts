import { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'crypto';
import { db, cors } from '../_lib/common.js';
import {
  BillingUserUnavailableError,
  fetchRevenueCatPerformanceEntitlement,
  grantProAccessAfterApprovedPayment,
  isBillingUserProfileAvailable,
  isBillingUserUnavailableError,
  isRevenueCatEnvironmentAllowed,
  revokeProAccess,
  type RevenueCatProvisioningContext,
  type VerifiedPerformanceEntitlement,
} from '../_lib/payments-service.js';

type TransferDirection = 'source' | 'destination';

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function candidateUserIds(values: unknown[]): string[] {
  return Array.from(new Set(
    values
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map(safeString)
      .filter((value) => value
        && !value.startsWith('$RCAnonymousID:')
        && !value.includes('/')
        && Buffer.byteLength(value, 'utf8') <= 512)
  ));
}

function webhookEventDocumentId(providerEventId: string, eventType: string, userId: string): string {
  // IDs da RevenueCat são globais. Somente TRANSFER precisa de uma chave por
  // UID, pois uma mesma entrega reconcilia origem e destino separadamente.
  return eventType === 'TRANSFER'
    ? `${providerEventId}__${Buffer.from(userId).toString('base64url')}`
    : providerEventId;
}

function millisOrNull(value: unknown): number | null {
  const millis = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(millis) && millis > 0 ? millis : null;
}

function isoFromMillis(value: unknown, fallback: string): string {
  const millis = millisOrNull(value);
  if (millis === null) return fallback;
  try {
    return new Date(millis).toISOString();
  } catch {
    return fallback;
  }
}

async function resolveExistingUsers(candidates: string[]): Promise<string[]> {
  const users = await Promise.all(candidates.map(async (userId) => {
    const snapshot = await db.collection('users').doc(userId).get();
    const userData = snapshot.exists ? snapshot.data() : null;
    return snapshot.exists && isBillingUserProfileAvailable(userData) ? userId : null;
  }));
  return users.filter((userId): userId is string => Boolean(userId));
}

async function webhookAlreadyProcessed(
  providerEventId: string,
  eventType: string,
  userId: string,
): Promise<boolean> {
  const event = await db.collection('webhook_events')
    .doc(webhookEventDocumentId(providerEventId, eventType, userId))
    .get();
  return event.exists && event.data()?.status === 'processed';
}

interface RecordedWebhookOutcome {
  alreadyProcessed: boolean;
  attempts: number;
  firstSeenAt: string;
  boundUserId: string | null;
}

async function recordWebhookOutcome(options: {
  providerEventId: string;
  eventType: string;
  userId: string;
  status: 'processed' | 'pending_reconciliation';
  outcome: string;
  transferDirection?: TransferDirection;
  environment?: string | null;
  reason?: string;
  eventAmount?: number | null;
  refundAmount?: number | null;
  currency?: string | null;
}): Promise<RecordedWebhookOutcome> {
  const eventDocumentId = webhookEventDocumentId(
    options.providerEventId,
    options.eventType,
    options.userId,
  );
  const nowIso = new Date().toISOString();
  const eventRef = db.collection('webhook_events').doc(eventDocumentId);
  return db.runTransaction(async (transaction: any) => {
    const current = await transaction.get(eventRef);
    // Uma consulta contraditória lenta nunca pode rebaixar o evento que outra
    // entrega já conciliou atomicamente como processed.
    const currentData = current.exists ? current.data() : null;
    const currentAttempts = Number.isInteger(currentData?.attempts) && currentData.attempts > 0
      ? currentData.attempts
      : 0;
    const persistedFirstSeenAt = safeString(currentData?.firstSeenAt);
    const firstSeenAt = Number.isFinite(Date.parse(persistedFirstSeenAt))
      ? persistedFirstSeenAt
      : nowIso;
    if (currentData?.status === 'processed') {
      return {
        alreadyProcessed: true,
        attempts: currentAttempts,
        firstSeenAt,
        boundUserId: safeString(currentData?.userId) || null,
      };
    }
    const currentUserId = safeString(currentData?.userId);
    if (options.eventType !== 'TRANSFER'
      && currentData?.status === 'pending_reconciliation'
      && currentUserId
      && currentUserId !== options.userId) {
      return {
        alreadyProcessed: false,
        attempts: currentAttempts,
        firstSeenAt,
        boundUserId: currentUserId,
      };
    }
    const attempts = options.status === 'pending_reconciliation'
      ? currentAttempts + 1
      : currentAttempts;
    transaction.set(eventRef, {
      provider: 'revenuecat',
      eventId: options.providerEventId,
      providerEventId: options.providerEventId,
      eventDocumentId,
      eventType: options.eventType,
      userId: options.userId,
      status: options.status,
      outcome: options.outcome,
      transferDirection: options.transferDirection || null,
      environment: options.environment || null,
      reason: options.reason || null,
      eventAmount: typeof options.eventAmount === 'number' && Number.isFinite(options.eventAmount)
        ? options.eventAmount
        : null,
      refundAmount: typeof options.refundAmount === 'number' && Number.isFinite(options.refundAmount)
        ? options.refundAmount
        : null,
      currency: options.currency || null,
      firstSeenAt,
      attempts,
      updatedAt: nowIso,
      ...(options.status === 'processed' ? { processedAt: nowIso } : {}),
    }, { merge: true });
    return { alreadyProcessed: false, attempts, firstSeenAt, boundUserId: options.userId };
  });
}

/** Create-if-absent transacional: nunca rebaixa um pedido concorrente. */
async function ensureRevenueCatOrderShell(options: {
  userId: string;
  entitlement: VerifiedPerformanceEntitlement;
  event: Record<string, any>;
  amount: number | null;
  refundAmount: number | null;
  currency: string | null;
  transactionId: string;
}) {
  const orderId = `order_performance_${options.userId}`;
  const orderRef = db.collection('payment_orders').doc(orderId);
  const userRef = db.collection('users').doc(options.userId);
  const nowIso = new Date().toISOString();

  await db.runTransaction(async (transaction: any) => {
    const [userSnap, orderSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(orderRef),
    ]);
    const userData = userSnap.exists ? userSnap.data() : null;
    if (!userSnap.exists || !isBillingUserProfileAvailable(userData)) {
      throw new BillingUserUnavailableError(options.userId);
    }
    if (orderSnap.exists) {
      const orderData = orderSnap.data();
      if (orderData?.userId !== options.userId || orderData?.planId !== 'invictus_performance') {
        throw new Error(`Pedido ${orderId} pertence a outro usuário ou plano.`);
      }
      return;
    }

    const store = options.entitlement.store || safeString(options.event.store) || null;
    const platform = store === 'APP_STORE' ? 'ios' : store === 'PLAY_STORE' ? 'android' : 'unknown';
    transaction.set(orderRef, {
      orderId,
      userId: options.userId,
      planId: 'invictus_performance',
      provider: 'revenuecat',
      platform,
      productId: options.entitlement.productId || safeString(options.event.product_id) || null,
      transactionId: options.transactionId,
      store,
      environment: options.entitlement.environment || safeString(options.event.environment).toUpperCase() || null,
      amount: options.amount,
      amountSource: options.amount === null ? null : 'revenuecat_webhook',
      refundAmount: options.refundAmount,
      currency: options.currency,
      status: 'pending',
      paymentStatus: 'pending',
      provisionStatus: 'pending',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  });

  return orderId;
}

function numericEventPrice(event: Record<string, any>): number | null {
  const rawPrice = event.price_in_purchased_currency ?? event.price;
  if (rawPrice === null || rawPrice === undefined) return null;
  if (typeof rawPrice === 'string' && rawPrice.trim() === '') return null;
  const eventPrice = Number(rawPrice);
  return Number.isFinite(eventPrice) ? eventPrice : null;
}

function webhookFinancialFields(eventType: string, event: Record<string, any>) {
  const eventAmount = numericEventPrice(event);
  const chargeEvent = [
    'INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE', 'REFUND_REVERSED',
  ].includes(eventType);
  // payment_orders.amount representa a cobrança original. Valores informativos
  // 0 de cancelamento/expiração e preços negativos nunca podem sobrescrevê-la.
  const amount = chargeEvent && eventAmount !== null && eventAmount >= 0 ? eventAmount : null;
  const refundAmount = eventAmount !== null && eventAmount < 0 ? eventAmount : null;
  const rawCurrency = safeString(event.currency);
  const currency = /^[A-Za-z]{3}$/.test(rawCurrency) ? rawCurrency.toUpperCase() : null;
  return { amount, eventAmount, refundAmount, currency };
}

type Contradiction = 'none' | 'pending' | 'old_event';

function isRefundLifecycleEvent(eventType: string, event: Record<string, any>): boolean {
  const eventAmount = numericEventPrice(event);
  return eventType === 'REFUND'
    || (eventType === 'CANCELLATION' && (
      safeString(event.cancel_reason).toUpperCase() === 'CUSTOMER_SUPPORT'
      || (eventAmount !== null && eventAmount < 0)
    ));
}

const DEFAULT_RECONCILIATION_MAX_ATTEMPTS = 5;
const DEFAULT_RECONCILIATION_MAX_AGE_MS = 10 * 60 * 1000;

function boundedPositiveInteger(
  rawValue: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const value = Number(rawValue);
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

function shouldRetryContradiction(recorded: RecordedWebhookOutcome): boolean {
  const maxAttempts = boundedPositiveInteger(
    process.env.REVENUECAT_RECONCILIATION_MAX_ATTEMPTS,
    DEFAULT_RECONCILIATION_MAX_ATTEMPTS,
    100,
  );
  const maxAgeMs = boundedPositiveInteger(
    process.env.REVENUECAT_RECONCILIATION_MAX_AGE_MS,
    DEFAULT_RECONCILIATION_MAX_AGE_MS,
    24 * 60 * 60 * 1000,
  );
  const firstSeenMillis = Date.parse(recorded.firstSeenAt);
  const ageMs = Number.isFinite(firstSeenMillis)
    ? Math.max(0, Date.now() - firstSeenMillis)
    : maxAgeMs;
  // O primeiro limite atingido encerra o retry. Assim uma divergência
  // permanente não mantém o evento pendente indefinidamente.
  return recorded.attempts < maxAttempts && ageMs < maxAgeMs;
}

function eventTransactionId(event: Record<string, any>): string {
  return safeString(event.transaction_id) || safeString(event.original_transaction_id);
}

/**
 * Detecta uma compra/período posterior sem usar event_timestamp_ms. No App
 * Store, EXPIRATION e REFUND podem ser emitidos antecipadamente; a hora de
 * emissão, isoladamente, não prova que o snapshot ativo é outra compra.
 */
function inactiveEventBelongsToOlderPeriod(
  event: Record<string, any>,
  entitlement: VerifiedPerformanceEntitlement,
): boolean {
  const snapshotTransactionId = safeString(entitlement.transactionId);
  const providerTransactionId = eventTransactionId(event);
  if (snapshotTransactionId && providerTransactionId && snapshotTransactionId === providerTransactionId) {
    return false;
  }

  const eventPurchaseMillis = millisOrNull(event.purchased_at_ms);
  const eventExpirationMillis = millisOrNull(event.expiration_at_ms);
  const snapshotPurchaseMillis = entitlement.purchasedAt ? Date.parse(entitlement.purchasedAt) : NaN;
  const snapshotExpirationMillis = entitlement.expiresAt ? Date.parse(entitlement.expiresAt) : NaN;
  if (!Number.isFinite(snapshotPurchaseMillis)) return false;

  // O snapshot começou depois do fim do período afetado: é inequivocamente uma
  // compra posterior, mesmo quando algum dos IDs não está disponível.
  if (eventExpirationMillis !== null && snapshotPurchaseMillis >= eventExpirationMillis) {
    return true;
  }

  const laterPurchase = eventPurchaseMillis !== null && snapshotPurchaseMillis > eventPurchaseMillis;
  const differentTransaction = Boolean(
    snapshotTransactionId && providerTransactionId && snapshotTransactionId !== providerTransactionId,
  );
  const laterExpiration = eventExpirationMillis !== null
    && Number.isFinite(snapshotExpirationMillis)
    && snapshotExpirationMillis > eventExpirationMillis;
  return laterPurchase && (differentTransaction || laterExpiration);
}

/**
 * Um snapshot contraditório pode ser apenas atraso entre webhook e REST. Eventos
 * antigos são reconhecidos por uma compra atual posterior ou validade já
 * encerrada; eventos atuais ficam pendentes para a reentrega do provedor.
 */
function classifyLifecycleContradiction(
  eventType: string,
  event: Record<string, any>,
  entitlement: VerifiedPerformanceEntitlement,
): Contradiction {
  const expectsInactive = isRefundLifecycleEvent(eventType, event) || eventType === 'EXPIRATION';
  const expectsActive = [
    'INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'REFUND_REVERSED', 'SUBSCRIPTION_EXTENDED',
  ].includes(eventType);
  if (expectsInactive && entitlement.active) {
    if (inactiveEventBelongsToOlderPeriod(event, entitlement)) {
      return 'old_event';
    }
    return 'pending';
  }
  if (['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE', 'REFUND_REVERSED'].includes(eventType)
    && entitlement.active) {
    const providerTransactionId = safeString(event.transaction_id);
    const snapshotTransactionId = safeString(entitlement.transactionId);
    if (providerTransactionId
      && (!snapshotTransactionId || providerTransactionId !== snapshotTransactionId)) {
      return 'pending';
    }
  }
  if ((eventType === 'RENEWAL' || eventType === 'SUBSCRIPTION_EXTENDED') && entitlement.active) {
    const eventExpirationMillis = millisOrNull(event.expiration_at_ms);
    const snapshotExpirationMillis = entitlement.expiresAt ? Date.parse(entitlement.expiresAt) : NaN;
    if (eventExpirationMillis !== null
      && (!Number.isFinite(snapshotExpirationMillis) || snapshotExpirationMillis < eventExpirationMillis)) {
      return 'pending';
    }
  }
  if (expectsActive && !entitlement.active) {
    const eventExpirationMillis = millisOrNull(event.expiration_at_ms);
    if (eventExpirationMillis !== null && eventExpirationMillis <= Date.now()) return 'old_event';
    return 'pending';
  }
  return 'none';
}

async function reconcileUser(options: {
  event: Record<string, any>;
  providerEventId: string;
  eventType: string;
  userId: string;
  transferDirection?: TransferDirection;
}) {
  const eventDocumentId = webhookEventDocumentId(
    options.providerEventId,
    options.eventType,
    options.userId,
  );
  if (await webhookAlreadyProcessed(options.providerEventId, options.eventType, options.userId)) {
    return { userId: options.userId, duplicate: true, stale: false };
  }

  const { amount, eventAmount, refundAmount, currency } = webhookFinancialFields(
    options.eventType,
    options.event,
  );
  let entitlement = await fetchRevenueCatPerformanceEntitlement(options.userId);
  if (entitlement.productId && !isRevenueCatEnvironmentAllowed(entitlement.environment)) {
    await recordWebhookOutcome({
      providerEventId: options.providerEventId,
      eventType: options.eventType,
      userId: options.userId,
      status: 'processed',
      outcome: 'ignored_environment_not_allowed',
      transferDirection: options.transferDirection,
      environment: entitlement.environment,
      reason: 'O snapshot pertence a um ambiente RevenueCat não permitido.',
      eventAmount,
      refundAmount,
      currency,
    });
    return { userId: options.userId, ignored: true, duplicate: false, stale: false };
  }
  let contradiction = options.transferDirection
    ? 'none'
    : classifyLifecycleContradiction(options.eventType, options.event, entitlement);
  if (contradiction === 'pending') {
    const recorded = await recordWebhookOutcome({
      providerEventId: options.providerEventId,
      eventType: options.eventType,
      userId: options.userId,
      status: 'pending_reconciliation',
      outcome: 'provider_snapshot_not_yet_consistent',
      environment: entitlement.environment,
      reason: `O evento ${options.eventType} ainda contradiz o snapshot REST atual.`,
      eventAmount,
      refundAmount,
      currency,
    });
    if (recorded.boundUserId && recorded.boundUserId !== options.userId) {
      return { userId: options.userId, ignored: true, duplicate: true, stale: false };
    }
    if (recorded.alreadyProcessed) {
      return { userId: options.userId, duplicate: true, stale: false };
    }
    if (shouldRetryContradiction(recorded)) {
      throw new Error(`Snapshot RevenueCat ainda não refletiu ${options.eventType} para ${options.userId}.`);
    }
    // Esgotada a janela, o snapshot REST passa a ser autoritativo e o evento
    // converge para o estado observado em vez de permanecer pendente.
    contradiction = 'none';
  }

  const providerTransactionId = safeString(options.event.transaction_id);
  const transactionId = providerTransactionId
    || entitlement.transactionId
    || options.providerEventId;
  const eventOccurredMillis = millisOrNull(options.event.event_timestamp_ms);

  // TRANSFER sempre fecha a origem nesta entrega. purchasedAt > event_timestamp
  // não prova recompra (especialmente no App Store); payments-service grava o
  // cutoff e só uma compra posterior comprovada pode reabrir a conta.
  if (options.transferDirection === 'source') {
    entitlement = {
      ...entitlement,
      active: false,
      status: 'revoked',
      willRenew: false,
    };
  }

  if (options.transferDirection === 'destination' && !entitlement.active) {
    const recorded = await recordWebhookOutcome({
      providerEventId: options.providerEventId,
      eventType: options.eventType,
      userId: options.userId,
      status: 'pending_reconciliation',
      outcome: 'transfer_destination_not_yet_active',
      transferDirection: 'destination',
      environment: entitlement.environment,
      reason: 'A RevenueCat ainda não retornou entitlement Performance ativo para o destino.',
      eventAmount,
      refundAmount,
      currency,
    });
    if (recorded.alreadyProcessed) {
      return { userId: options.userId, duplicate: true, stale: false };
    }
    if (shouldRetryContradiction(recorded)) {
      throw new Error(`TRANSFER ainda não refletido no destino ${options.userId}.`);
    }
    await recordWebhookOutcome({
      providerEventId: options.providerEventId,
      eventType: options.eventType,
      userId: options.userId,
      status: 'processed',
      outcome: 'ignored_transfer_destination_inactive',
      transferDirection: 'destination',
      environment: entitlement.environment,
      reason: 'Limite de reconciliação esgotado; o snapshot REST inativo foi aceito como autoritativo.',
      eventAmount,
      refundAmount,
      currency,
    });
    return { userId: options.userId, ignored: true, duplicate: false, stale: false };
  }

  const orderId = await ensureRevenueCatOrderShell({
    userId: options.userId,
    entitlement,
    event: options.event,
    amount,
    refundAmount,
    currency,
    transactionId,
  });
  const context: RevenueCatProvisioningContext = {
    entitlement,
    eventId: options.providerEventId,
    eventDocumentId,
    eventType: options.eventType,
    transferDirection: options.transferDirection,
    transferOccurredAt: options.transferDirection
      ? isoFromMillis(options.event.event_timestamp_ms, new Date().toISOString())
      : undefined,
    eventOccurredAt: eventOccurredMillis === null
      ? undefined
      : new Date(eventOccurredMillis).toISOString(),
    eventTransactionId: providerTransactionId || undefined,
    amount,
    eventAmount,
    refundAmount,
    currency,
  };

  if (entitlement.active) {
    const result = await grantProAccessAfterApprovedPayment(orderId, transactionId, 'revenuecat_webhook', context);
    return {
      userId: options.userId,
      ...result,
      oldEvent: contradiction === 'old_event',
    };
  }

  const revokedStatus = options.transferDirection === 'source'
    ? 'revoked'
    : entitlement.status === 'refunded' || isRefundLifecycleEvent(options.eventType, options.event)
      ? 'refunded'
      : entitlement.status === 'expired' || options.eventType === 'EXPIRATION' ? 'expired' : 'revoked';
  const result = await revokeProAccess(
    orderId,
    transactionId,
    revokedStatus,
    'revenuecat_webhook',
    `Estado atual da RevenueCat após evento ${options.eventType}: ${entitlement.status}.`
      + (refundAmount !== null ? ` Valor de reembolso reportado: ${refundAmount} ${currency || ''}.` : ''),
    context,
  );
  return { userId: options.userId, ...result, oldEvent: contradiction === 'old_event' };
}

async function reconcileExistingUser(options: Parameters<typeof reconcileUser>[0]) {
  try {
    return await reconcileUser(options);
  } catch (error) {
    if (!isBillingUserUnavailableError(error)) throw error;
    const financial = webhookFinancialFields(options.eventType, options.event);
    await recordWebhookOutcome({
      providerEventId: options.providerEventId,
      eventType: options.eventType,
      userId: options.userId,
      status: 'processed',
      outcome: 'ignored_user_unavailable',
      transferDirection: options.transferDirection,
      environment: safeString(options.event.environment).toUpperCase() || null,
      reason: 'O perfil foi removido ou tombstonado antes da reconciliação.',
      eventAmount: financial.eventAmount,
      refundAmount: financial.refundAmount,
      currency: financial.currency,
    });
    return { userId: options.userId, ignored: true, duplicate: false, stale: false };
  }
}

/** Lifecycle comum usa snapshot REST; TRANSFER reconcilia cada UID separado. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const expectedToken = process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN?.trim();
  const authorization = req.headers.authorization;
  const authHeader = Array.isArray(authorization) ? authorization[0] : authorization;
  const receivedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const expectedTokenBuffer = Buffer.from(expectedToken || '');
  const receivedTokenBuffer = Buffer.from(receivedToken);
  const tokenMatches = Boolean(expectedToken)
    && receivedTokenBuffer.length === expectedTokenBuffer.length
    && timingSafeEqual(receivedTokenBuffer, expectedTokenBuffer);
  if (!tokenMatches) return res.status(401).json({ error: 'Não autorizado.' });

  try {
    const event = req.body?.event as Record<string, any> | undefined;
    if (!event) return res.status(400).json({ error: 'Payload de evento ausente.' });

    const eventType = safeString(event.type).toUpperCase();
    const providerEventId = safeString(event.id);
    if (!eventType || !providerEventId) {
      return res.status(400).json({ error: 'Evento inválido: id e type são obrigatórios.' });
    }
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(providerEventId)) {
      return res.status(400).json({ error: 'Identificador de evento inválido.' });
    }

    const eventEnvironment = safeString(event.environment).toUpperCase();
    const eventFinancial = webhookFinancialFields(eventType, event);
    if (eventEnvironment && !isRevenueCatEnvironmentAllowed(eventEnvironment)) {
      return res.status(200).json({
        received: true,
        ignored: true,
        reason: `Ambiente RevenueCat ${eventEnvironment} não permitido.`,
      });
    }

    if (eventType === 'TRANSFER') {
      const sourceCandidates = candidateUserIds([event.transferred_from]);
      const destinationCandidates = candidateUserIds([event.transferred_to]);
      if (sourceCandidates.length === 0 && destinationCandidates.length === 0) {
        return res.status(400).json({ error: 'TRANSFER inválido: transferred_from/to ausentes.' });
      }

      const [resolvedSources, resolvedDestinations] = await Promise.all([
        resolveExistingUsers(sourceCandidates),
        resolveExistingUsers(destinationCandidates),
      ]);
      const destinationSet = new Set(resolvedDestinations);
      const targets = [
        ...resolvedSources
          .filter((userId) => !destinationSet.has(userId))
          .map((userId) => ({ userId, transferDirection: 'source' as const })),
        ...resolvedDestinations
          .map((userId) => ({ userId, transferDirection: 'destination' as const })),
      ];
      if (targets.length === 0) {
        const subject = sourceCandidates[0] || destinationCandidates[0] || 'unresolved-transfer';
        await recordWebhookOutcome({
          providerEventId,
          eventType,
          userId: subject,
          status: 'processed',
          outcome: 'ignored_no_existing_user',
          environment: eventEnvironment || null,
          reason: 'Nenhum App User ID do TRANSFER corresponde a um perfil existente.',
          eventAmount: eventFinancial.eventAmount,
          refundAmount: eventFinancial.refundAmount,
          currency: eventFinancial.currency,
        });
        return res.status(200).json({ received: true, ignored: true, reason: 'Nenhum usuário existente no TRANSFER.' });
      }

      const results = [];
      // A origem fica deduplicada mesmo se o destino ainda exigir retry.
      for (const target of targets) {
        results.push(await reconcileExistingUser({
          event,
          providerEventId,
          eventType,
          userId: target.userId,
          transferDirection: target.transferDirection,
        }));
      }
      return res.status(200).json({ received: true, transfer: true, results });
    }

    const entitlementIds = Array.isArray(event.entitlement_ids)
      ? event.entitlement_ids.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    if (!entitlementIds.includes('performance')) {
      return res.status(200).json({ received: true, ignored: true, reason: 'Evento não relacionado à entitlement performance.' });
    }

    const identityCandidates = candidateUserIds([
      event.app_user_id,
      event.original_app_user_id,
      event.aliases,
    ]);
    if (identityCandidates.length === 0) {
      return res.status(400).json({ error: 'Evento inválido: app_user_id/original_app_user_id/aliases ausentes.' });
    }

    // Um lifecycle normal fica globalmente vinculado ao primeiro UID enquanto
    // está pendente. A troca de ordem/estado dos aliases em uma redelivery não
    // pode mover o mesmo evento para outra conta.
    const existingEvent = await db.collection('webhook_events').doc(providerEventId).get();
    const existingEventData = existingEvent.exists ? existingEvent.data() : null;
    if (existingEventData?.status === 'processed') {
      return res.status(200).json({
        received: true,
        duplicate: true,
        stale: false,
        ignored: false,
      });
    }
    const boundUserId = existingEventData?.status === 'pending_reconciliation'
      ? safeString(existingEventData.userId)
      : '';
    if (boundUserId) {
      const [availableBoundUser] = await resolveExistingUsers([boundUserId]);
      if (!availableBoundUser) {
        await recordWebhookOutcome({
          providerEventId,
          eventType,
          userId: boundUserId,
          status: 'processed',
          outcome: 'ignored_user_unavailable',
          environment: eventEnvironment || null,
          reason: 'O UID vinculado ao evento pendente foi removido ou tombstonado.',
          eventAmount: eventFinancial.eventAmount,
          refundAmount: eventFinancial.refundAmount,
          currency: eventFinancial.currency,
        });
        return res.status(200).json({
          received: true,
          duplicate: false,
          stale: false,
          ignored: true,
        });
      }
      const result = await reconcileExistingUser({
        event,
        providerEventId,
        eventType,
        userId: availableBoundUser,
      });
      return res.status(200).json({
        received: true,
        duplicate: Boolean((result as any).duplicate),
        stale: Boolean((result as any).stale),
        ignored: Boolean((result as any).ignored),
      });
    }
    const existingUsers = await resolveExistingUsers(identityCandidates);
    if (existingUsers.length === 0) {
      await recordWebhookOutcome({
        providerEventId,
        eventType,
        userId: identityCandidates[0],
        status: 'processed',
        outcome: 'ignored_no_existing_user',
        environment: eventEnvironment || null,
        reason: 'Nenhuma identidade RevenueCat corresponde a um perfil existente.',
        eventAmount: eventFinancial.eventAmount,
        refundAmount: eventFinancial.refundAmount,
        currency: eventFinancial.currency,
      });
      return res.status(200).json({ received: true, ignored: true, reason: 'Usuário inexistente ou excluído.' });
    }

    const result = await reconcileExistingUser({
      event,
      providerEventId,
      eventType,
      userId: existingUsers[0],
    });
    return res.status(200).json({
      received: true,
      duplicate: Boolean((result as any).duplicate),
      stale: Boolean((result as any).stale),
      ignored: Boolean((result as any).ignored),
    });
  } catch (error: any) {
    console.error('[RevenueCat Webhook Error]', error);
    return res.status(500).json({
      error: 'Erro interno ao processar webhook da RevenueCat.',
      retryable: true,
    });
  }
}
