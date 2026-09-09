import { db, FieldValue } from './common.js';
import { getOrInitCurrentSeasonWindow, calcularProximaJanela } from './season-prize-engine.js';
import { entitlementDateToMillis, isProUser, type ProEntitlementStatus } from './entitlement.js';

export interface CalculatedSeason {
  seasonId: string;
  seasonStart: string;
  seasonEnd: string;
  status: 'ACTIVE' | 'WAITING';
}

/**
 * Calculates season details based on payment date as requested by the strict season policy.
 */
/**
 * Em qual temporada a assinatura entra.
 *
 * REGRA: quem assina com a temporada JA EM ANDAMENTO entra na seguinte. Quem
 * assina antes de ela abrir (janela de campanha) entra nela mesma.
 *
 * Este calculo usa a MESMA janela de temporada do motor de premiacao
 * (season-prize-engine) e da tela do app -- 30 dias comecando numa segunda.
 * Antes havia aqui um calendario quinzenal proprio, com IDs em outro formato,
 * que nunca casava com o que o motor procurava na hora de pagar.
 */
export async function calculateSeasonDetails(purchaseDate: Date): Promise<CalculatedSeason> {
  const atual = await getOrInitCurrentSeasonWindow();
  const jaComecou = atual.startDate.getTime() <= purchaseDate.getTime();
  const janela = jaComecou ? calcularProximaJanela(atual) : atual;

  return {
    seasonId: janela.seasonId,
    seasonStart: janela.startDate.toISOString(),
    seasonEnd: janela.endDate.toISOString(),
    status: jaComecou ? 'WAITING' : 'ACTIVE',
  };
}

/**
 * Registers audit history inside payment_audit_logs.
 */
export async function logPaymentAudit(log: {
  userId: string;
  orderId: string;
  paymentId: string;
  previousStatus: string;
  newStatus: string;
  eventSource: string;
  action: 'checkout_created' | 'webhook_received' | 'payment_approved' | 'payment_pending' | 'payment_rejected' | 'pro_granted' | 'pro_revoked' | 'suspicious_frontend_attempt';
  reason: string;
}) {
  try {
    const logId = db.collection('payment_audit_logs').doc().id;
    await db.collection('payment_audit_logs').doc(logId).set({
      ...log,
      createdAt: new Date().toISOString()
    });
    console.log(`[Audit Log] Saved log event '${log.action}' for orderId: ${log.orderId}`);
  } catch (err) {
    console.error('[Audit Log Error] Failed to write payment audit log:', err);
  }
}

const REVENUECAT_API_URL = 'https://api.revenuecat.com/v1';
export const PERFORMANCE_ENTITLEMENT_ID = 'invictus_performance_pro';

interface RevenueCatEntitlementRecord {
  expires_date?: string | null;
  product_identifier?: string;
  purchase_date?: string | null;
}

interface RevenueCatSubscriptionRecord {
  expires_date?: string | null;
  purchase_date?: string | null;
  original_purchase_date?: string | null;
  store?: string | null;
  unsubscribe_detected_at?: string | null;
  billing_issues_detected_at?: string | null;
  grace_period_expires_date?: string | null;
  refunded_at?: string | null;
  store_transaction_id?: string | null;
  original_transaction_id?: string | null;
  is_sandbox?: boolean;
  period_type?: string | null;
}

interface RevenueCatSubscriberResponse {
  request_date?: string;
  request_date_ms?: number;
  subscriber?: {
    entitlements?: Record<string, RevenueCatEntitlementRecord>;
    subscriptions?: Record<string, RevenueCatSubscriptionRecord>;
  };
}

export interface VerifiedPerformanceEntitlement {
  active: boolean;
  status: ProEntitlementStatus;
  productId: string | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  gracePeriodExpiresAt: string | null;
  providerObservedAt: string;
  transactionId: string | null;
  store: string | null;
  environment: 'SANDBOX' | 'PRODUCTION' | null;
  periodType: string | null;
  willRenew: boolean | null;
}

export interface RevenueCatProvisioningContext {
  entitlement: VerifiedPerformanceEntitlement;
  /** Identificador imutável fornecido pela RevenueCat. */
  eventId?: string;
  /** Chave interna de deduplicação; em TRANSFER é event.id + Firebase UID. */
  eventDocumentId?: string;
  eventType?: string;
  transferDirection?: 'source' | 'destination';
  /** Instante autoritativo do evento TRANSFER usado no cutoff de origem/destino. */
  transferOccurredAt?: string;
  /** Instante do webhook de lifecycle; ausente em consultas REST manuais. */
  eventOccurredAt?: string;
  eventTransactionId?: string;
  /** Valor bruto informado no evento; nunca substitui a cobrança do pedido. */
  eventAmount?: number | null;
  /** Preço negativo informado em um evento de reembolso. */
  refundAmount?: number | null;
  amount?: number | null;
  currency?: string | null;
}

export class BillingUserUnavailableError extends Error {
  readonly code = 'BILLING_USER_UNAVAILABLE';

  constructor(readonly userId: string) {
    super(`O perfil ${userId} não existe ou está marcado como excluído.`);
    this.name = 'BillingUserUnavailableError';
  }
}

export function isBillingUserUnavailableError(error: unknown): error is BillingUserUnavailableError {
  return error instanceof BillingUserUnavailableError
    || (Boolean(error) && typeof error === 'object' && (error as any).code === 'BILLING_USER_UNAVAILABLE');
}

/** Perfis apagados/tombstonados nunca podem ser recriados por callbacks tardios. */
export function isBillingUserProfileAvailable(userData: unknown): boolean {
  if (!userData || typeof userData !== 'object') return false;
  const data = userData as Record<string, unknown>;
  const statusValues = [data.status, data.accountStatus, data.lifecycleStatus]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase());
  const deletedStatus = statusValues.some((value) => [
    'deleted', 'deletado', 'excluido', 'excluído', 'account_deleted', 'deletion_completed',
  ].includes(value)) || (typeof data.deletionStatus === 'string'
    && ['completed', 'deleted', 'deletion_completed'].includes(data.deletionStatus.trim().toLowerCase()));
  return !(
    data.deleted === true
    || data.isDeleted === true
    || data.accountDeleted === true
    || data.tombstone === true
    || Boolean(data.deletedAt)
    || Boolean(data.accountDeletedAt)
    || deletedStatus
  );
}

function configuredPerformanceProducts(): Set<string> {
  const configured = process.env.REVENUECAT_PERFORMANCE_PRODUCT_IDS
    || process.env.REVENUECAT_PERFORMANCE_PRODUCT_ID
    || process.env.VITE_REVENUECAT_PERFORMANCE_PRODUCT_ID
    || '';
  return new Set(
    configured
      .split(',')
      .map((productId) => productId.trim())
      .filter(Boolean)
  );
}

export type RevenueCatEnvironment = 'SANDBOX' | 'PRODUCTION';

function configuredRevenueCatEnvironments(): Set<RevenueCatEnvironment> {
  const configured = process.env.REVENUECAT_ALLOWED_ENVIRONMENTS?.trim();
  if (!configured) return new Set<RevenueCatEnvironment>(['PRODUCTION']);
  return new Set(
    configured
      .split(',')
      .map((environment) => environment.trim().toUpperCase())
      .filter((environment): environment is RevenueCatEnvironment => (
        environment === 'PRODUCTION' || environment === 'SANDBOX'
      ))
  );
}

/** Produção é o único ambiente aceito por padrão; SANDBOX exige opt-in. */
export function isRevenueCatEnvironmentAllowed(environment: unknown): environment is RevenueCatEnvironment {
  if (typeof environment !== 'string') return false;
  const normalized = environment.trim().toUpperCase();
  if (normalized !== 'PRODUCTION' && normalized !== 'SANDBOX') return false;
  return configuredRevenueCatEnvironments().has(normalized);
}

function validIsoOrNull(value: unknown): string | null {
  const millis = entitlementDateToMillis(value);
  if (millis === null) return null;
  try {
    return new Date(millis).toISOString();
  } catch {
    return null;
  }
}

function emptyRevenueCatEntitlement(observedAt: string): VerifiedPerformanceEntitlement {
  return {
    active: false,
    status: 'inactive',
    productId: null,
    purchasedAt: null,
    expiresAt: null,
    gracePeriodExpiresAt: null,
    providerObservedAt: observedAt,
    transactionId: null,
    store: null,
    environment: null,
    periodType: null,
    willRenew: null,
  };
}

/**
 * Reads the current subscriber from RevenueCat. Webhook event types are merely
 * notifications: this snapshot is the authority used to grant or revoke access.
 */
export async function fetchRevenueCatPerformanceEntitlement(
  firebaseUid: string,
  at: Date | number = Date.now()
): Promise<VerifiedPerformanceEntitlement> {
  const uid = firebaseUid.trim();
  if (!uid) throw new Error('Firebase UID ausente na consulta à RevenueCat.');
  const secretKey = process.env.REVENUECAT_SECRET_API_KEY?.trim();
  if (!secretKey) throw new Error('REVENUECAT_SECRET_API_KEY não configurada no servidor.');
  const allowedProducts = configuredPerformanceProducts();
  if (allowedProducts.size === 0) {
    throw new Error('Nenhum produto Performance da RevenueCat está configurado no servidor.');
  }

  const response = await fetch(`${REVENUECAT_API_URL}/subscribers/${encodeURIComponent(uid)}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
  });

  const fallbackObservedAt = new Date().toISOString();
  if (response.status === 404) return emptyRevenueCatEntitlement(fallbackObservedAt);
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`RevenueCat respondeu ${response.status}${details ? `: ${details}` : ''}`);
  }

  const data = (await response.json()) as RevenueCatSubscriberResponse;
  const requestDate = validIsoOrNull(data.request_date)
    || validIsoOrNull(data.request_date_ms)
    || fallbackObservedAt;
  const entitlement = data.subscriber?.entitlements?.[PERFORMANCE_ENTITLEMENT_ID];
  if (!entitlement?.product_identifier) return emptyRevenueCatEntitlement(requestDate);

  const productId = entitlement.product_identifier;
  const productAllowed = allowedProducts.has(productId);
  const subscription = data.subscriber?.subscriptions?.[productId] || {};
  const environment: RevenueCatEnvironment | null = typeof subscription.is_sandbox === 'boolean'
    ? (subscription.is_sandbox ? 'SANDBOX' : 'PRODUCTION')
    : null;
  const environmentAllowed = isRevenueCatEnvironmentAllowed(environment);
  const expiresAt = validIsoOrNull(subscription.expires_date || entitlement.expires_date);
  const gracePeriodExpiresAt = validIsoOrNull(subscription.grace_period_expires_date);
  const normalizedStore = typeof subscription.store === 'string' && subscription.store.trim()
    ? subscription.store.trim().toUpperCase()
    : null;
  const checkAt = at instanceof Date ? at.getTime() : at;
  const expiresMillis = entitlementDateToMillis(expiresAt);
  const graceExpiresMillis = entitlementDateToMillis(gracePeriodExpiresAt);
  const refunded = entitlementDateToMillis(subscription.refunded_at) !== null;
  const inGracePeriod = !refunded
    && Boolean(subscription.billing_issues_detected_at)
    && graceExpiresMillis !== null
    && graceExpiresMillis > checkAt;
  const inPaidPeriod = !refunded && expiresMillis !== null && expiresMillis > checkAt;

  let status: ProEntitlementStatus = 'expired';
  if (!productAllowed || !environmentAllowed) status = 'inactive';
  else if (refunded) status = 'refunded';
  else if (inGracePeriod) status = 'grace_period';
  else if (inPaidPeriod) status = 'active';

  return {
    active: productAllowed && environmentAllowed && (status === 'active' || status === 'grace_period'),
    status,
    productId,
    purchasedAt: validIsoOrNull(subscription.purchase_date || entitlement.purchase_date),
    expiresAt,
    gracePeriodExpiresAt,
    providerObservedAt: requestDate,
    transactionId: subscription.store_transaction_id || subscription.original_transaction_id || null,
    store: normalizedStore,
    environment,
    periodType: subscription.period_type || null,
    willRenew: status === 'active' || status === 'grace_period'
      ? !subscription.unsubscribe_detected_at
      : false,
  };
}

function canonicalEntitlement(snapshot: VerifiedPerformanceEntitlement, sourceEventId?: string) {
  return {
    version: 1,
    entitlementId: PERFORMANCE_ENTITLEMENT_ID,
    tier: 'performance',
    provider: 'revenuecat',
    status: snapshot.status,
    productId: snapshot.productId,
    purchasedAt: snapshot.purchasedAt,
    expiresAt: snapshot.expiresAt,
    gracePeriodExpiresAt: snapshot.gracePeriodExpiresAt,
    providerObservedAt: snapshot.providerObservedAt,
    transactionId: snapshot.transactionId,
    store: snapshot.store,
    environment: snapshot.environment,
    periodType: snapshot.periodType,
    willRenew: snapshot.willRenew,
    sourceEventId: sourceEventId || null,
  };
}

function isOlderProviderSnapshot(current: any, incomingObservedAt: string, currentOrder?: any): boolean {
  const profileMillis = entitlementDateToMillis(current?.proEntitlement?.providerObservedAt);
  const orderMillis = entitlementDateToMillis(currentOrder?.providerObservedAt);
  const currentMillis = profileMillis === null
    ? orderMillis
    : orderMillis === null ? profileMillis : Math.max(profileMillis, orderMillis);
  const incomingMillis = entitlementDateToMillis(incomingObservedAt);
  return currentMillis !== null && incomingMillis !== null && currentMillis > incomingMillis;
}

function transferOutCutoffMillis(userData: any, orderData: any): number | null {
  const userMillis = entitlementDateToMillis(userData?.lastTransferOutAt);
  const orderMillis = entitlementDateToMillis(orderData?.lastTransferOutAt);
  if (userMillis === null) return orderMillis;
  if (orderMillis === null) return userMillis;
  return Math.max(userMillis, orderMillis);
}

function transferOutTransactionIds(userData: any, orderData: any): Set<string> {
  return new Set(
    [
      userData?.lastTransferOutTransactionId,
      orderData?.lastTransferOutTransactionId,
      ...(Array.isArray(userData?.lastTransferOutTransactionIds) ? userData.lastTransferOutTransactionIds : []),
      ...(Array.isArray(orderData?.lastTransferOutTransactionIds) ? orderData.lastTransferOutTransactionIds : []),
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim()),
  );
}

function latestTransferInMillis(userData: any, orderData: any): number | null {
  const userMillis = entitlementDateToMillis(userData?.lastTransferInAt);
  const orderMillis = entitlementDateToMillis(orderData?.lastTransferInAt);
  if (userMillis === null) return orderMillis;
  if (orderMillis === null) return userMillis;
  return Math.max(userMillis, orderMillis);
}

function latestPurchaseEventMillis(userData: any, orderData: any): number | null {
  const userMillis = entitlementDateToMillis(userData?.lastRevenueCatPurchaseEventAt);
  const orderMillis = entitlementDateToMillis(orderData?.lastRevenueCatPurchaseEventAt);
  if (userMillis === null) return orderMillis;
  if (orderMillis === null) return userMillis;
  return Math.max(userMillis, orderMillis);
}

async function markProvisioningRetryable(orderId: string): Promise<void> {
  try {
    const orderRef = db.collection('payment_orders').doc(orderId);
    await db.runTransaction(async (transaction: any) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists
        || orderSnap.data()?.planId !== 'invictus_performance'
        || orderSnap.data()?.provisionStatus === 'applied') return;
      transaction.set(orderRef, {
        paymentStatus: 'approved',
        status: 'processing',
        provisionStatus: 'retryable_error',
        provisionError: 'Não foi possível aplicar o benefício. Uma nova tentativa é segura.',
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    });
  } catch (error) {
    console.error('[Provision Error] Não foi possível registrar estado recuperável:', error);
  }
}

function writeProcessedWebhook(
  transaction: any,
  context: RevenueCatProvisioningContext | undefined,
  userId: string,
  outcome: string,
  nowIso: string
) {
  if (!context?.eventId) return;
  const eventRef = db.collection('webhook_events').doc(context.eventDocumentId || context.eventId);
  transaction.set(eventRef, {
    provider: 'revenuecat',
    eventId: context.eventId,
    providerEventId: context.eventId,
    eventDocumentId: context.eventDocumentId || context.eventId,
    eventType: context.eventType || 'UNKNOWN',
    transferDirection: context.transferDirection || null,
    userId,
    status: 'processed',
    outcome,
    productId: context.entitlement.productId,
    transactionId: context.eventTransactionId || context.entitlement.transactionId,
    purchasedAt: context.entitlement.purchasedAt,
    expiresAt: context.entitlement.expiresAt,
    store: context.entitlement.store,
    environment: context.entitlement.environment,
    amount: typeof context.amount === 'number' && Number.isFinite(context.amount) ? context.amount : null,
    eventAmount: typeof context.eventAmount === 'number' && Number.isFinite(context.eventAmount)
      ? context.eventAmount
      : null,
    refundAmount: typeof context.refundAmount === 'number' && Number.isFinite(context.refundAmount)
      ? context.refundAmount
      : null,
    currency: context.currency || null,
    providerObservedAt: context.entitlement.providerObservedAt,
    processedAt: nowIso,
  }, { merge: true });
}

/**
 * Unique authorative backend function to grant Pro access to a user.
 * Enforces all integrity rules and avoids duplications.
 */
export async function grantProAccessAfterApprovedPayment(
  orderId: string,
  paymentId: string,
  eventSource: string,
  context: RevenueCatProvisioningContext
) {
  const snapshot = context?.entitlement;
  const accessEndsAt = snapshot?.status === 'grace_period'
    ? snapshot.gracePeriodExpiresAt || snapshot.expiresAt
    : snapshot?.expiresAt;
  if (!snapshot?.active
    || !snapshot.productId
    || !isRevenueCatEnvironmentAllowed(snapshot.environment)
    || entitlementDateToMillis(accessEndsAt) === null
    || entitlementDateToMillis(accessEndsAt)! <= Date.now()) {
    throw new Error('Acesso PRO não pode ser concedido sem entitlement RevenueCat ativo e com validade futura.');
  }

  const nowIso = new Date().toISOString();
  const orderRef = db.collection('payment_orders').doc(orderId);
  let transactionResult: { success: true; alreadyGranted: boolean; stale?: boolean; duplicate?: boolean; userId: string };

  try {
    transactionResult = await db.runTransaction(async (transaction: any) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) throw new Error(`Pedido ${orderId} não foi encontrado no banco de dados.`);

      const orderData = orderSnap.data()!;
      if (orderData.planId !== 'invictus_performance') {
        throw new Error(`Pedido ${orderId} não corresponde ao Plano Performance.`);
      }

      const userId = orderData.userId;
      const userRef = db.collection('users').doc(userId);
      const entitlementRef = db.collection('user_entitlements').doc(`${userId}_invictus_performance`);
      const eventRef = context.eventId
        ? db.collection('webhook_events').doc(context.eventDocumentId || context.eventId)
        : null;
      const [userSnap, eventSnap] = await Promise.all([
        transaction.get(userRef),
        eventRef ? transaction.get(eventRef) : Promise.resolve(null),
      ]);

      if (eventSnap?.exists && eventSnap.data()?.status === 'processed') {
        return { success: true as const, alreadyGranted: true, duplicate: true, userId };
      }

      const userData = userSnap.exists ? userSnap.data() : null;
      if (!userSnap.exists || !isBillingUserProfileAvailable(userData)) {
        throw new BillingUserUnavailableError(userId);
      }
      const transferCutoff = transferOutCutoffMillis(userData, orderData);
      const incomingTransactionId = typeof snapshot.transactionId === 'string'
        ? snapshot.transactionId.trim()
        : '';
      const transferOutTransactions = transferOutTransactionIds(userData, orderData);
      const transferInMillis = context.transferDirection === 'destination'
        ? entitlementDateToMillis(context.transferOccurredAt)
        : null;
      const destinationAfterCutoff = context.transferDirection === 'destination'
        && transferInMillis !== null
        && (transferCutoff === null || transferInMillis > transferCutoff);
      const eventOccurredMillis = entitlementDateToMillis(context.eventOccurredAt);
      const providerEventTransactionId = typeof context.eventTransactionId === 'string'
        ? context.eventTransactionId.trim()
        : '';
      const purchaseLifecycleEvent = [
        'INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE', 'REFUND_REVERSED',
      ].includes(context.eventType || '');
      const provenPurchaseEvent = purchaseLifecycleEvent
        && eventOccurredMillis !== null
        && Boolean(incomingTransactionId)
        && providerEventTransactionId === incomingTransactionId;
      const authoritativePurchaseEvent = transferCutoff !== null
        && provenPurchaseEvent
        && eventOccurredMillis > transferCutoff
        && !transferOutTransactions.has(incomingTransactionId);
      const clearsTransferCutoff = transferCutoff !== null
        && (destinationAfterCutoff || authoritativePurchaseEvent);
      const currentPurchaseEventMillis = latestPurchaseEventMillis(userData, orderData);
      const advancesPurchaseProvenance = provenPurchaseEvent
        && (currentPurchaseEventMillis === null || eventOccurredMillis! > currentPurchaseEventMillis);
      const purchaseProvenanceUpdate = advancesPurchaseProvenance ? {
        lastRevenueCatPurchaseEventAt: context.eventOccurredAt,
        lastRevenueCatPurchaseEventType: context.eventType,
        lastRevenueCatPurchaseEventTransactionId: incomingTransactionId,
      } : {};
      const purchaseMatchesCurrentState = provenPurchaseEvent && [
        orderData.transactionId,
        userData?.proEntitlement?.transactionId,
      ].some((value) => typeof value === 'string' && value.trim() === incomingTransactionId);
      // `providerObservedAt` é apenas a hora da consulta e pode avançar mesmo
      // enquanto o REST ainda devolve um recibo lido antes do TRANSFER. Depois
      // do cutoff, somente TRANSFER in posterior ou webhook de compra posterior
      // com transactionId correspondente pode reabrir a conta. Uma consulta
      // REST/verify isolada nunca é prova suficiente.
      if (transferCutoff !== null && !clearsTransferCutoff) {
        writeProcessedWebhook(transaction, context, userId, 'ignored_transfer_out_cutoff', nowIso);
        return { success: true as const, alreadyGranted: true, stale: true, userId };
      }
      if (!clearsTransferCutoff && isOlderProviderSnapshot(userData, snapshot.providerObservedAt, orderData)) {
        // Uma consulta concorrente pode ter observado o mesmo receipt depois.
        // Nesse caso não rebaixamos o entitlement, mas preservamos a
        // proveniência monotônica do webhook de compra para ordenar TRANSFERs.
        if (advancesPurchaseProvenance && purchaseMatchesCurrentState) {
          transaction.set(orderRef, purchaseProvenanceUpdate, { merge: true });
          transaction.set(userRef, purchaseProvenanceUpdate, { merge: true });
        }
        writeProcessedWebhook(transaction, context, userId, 'ignored_stale_snapshot', nowIso);
        return { success: true as const, alreadyGranted: true, stale: true, userId };
      }

      const alreadyGranted = orderData.provisionStatus === 'applied'
        && userData?.proEntitlement?.status === snapshot.status
        && userData?.proEntitlement?.productId === snapshot.productId
        && userData?.proEntitlement?.expiresAt === snapshot.expiresAt;
      const entitlementProjection = canonicalEntitlement(snapshot, context.eventId);
      const orderUpdate: Record<string, unknown> = {
        status: 'approved',
        paymentStatus: 'approved',
        provisionStatus: 'applied',
        provisionError: null,
        paymentId,
        rawStatus: 'approved',
        paidAt: orderData.paidAt || snapshot.purchasedAt || nowIso,
        benefitAppliedAt: nowIso,
        provider: 'revenuecat',
        platform: snapshot.store === 'APP_STORE' ? 'ios' : snapshot.store === 'PLAY_STORE' ? 'android' : orderData.platform || 'unknown',
        productId: snapshot.productId,
        transactionId: snapshot.transactionId || paymentId,
        store: snapshot.store,
        environment: snapshot.environment,
        purchasedAt: snapshot.purchasedAt,
        expiresAt: snapshot.expiresAt,
        gracePeriodExpiresAt: snapshot.gracePeriodExpiresAt,
        providerObservedAt: snapshot.providerObservedAt,
        lastWebhookEventId: context.eventId || orderData.lastWebhookEventId || null,
        lastWebhookEventType: context.eventType || orderData.lastWebhookEventType || null,
        lastWebhookAt: context.eventId ? nowIso : orderData.lastWebhookAt || null,
        ...(context.transferDirection === 'destination' && context.transferOccurredAt ? {
          lastTransferInAt: context.transferOccurredAt,
        } : {}),
        ...(clearsTransferCutoff ? {
          lastTransferOutAt: null,
          lastTransferOutTransactionId: null,
          lastTransferOutTransactionIds: [],
        } : {}),
        ...purchaseProvenanceUpdate,
        updatedAt: nowIso,
      };
      if (typeof context.amount === 'number' && Number.isFinite(context.amount) && context.amount >= 0) {
        orderUpdate.amount = context.amount;
        orderUpdate.amountSource = 'revenuecat_webhook';
      }
      if (context.currency) orderUpdate.currency = context.currency;

      transaction.set(orderRef, orderUpdate, { merge: true });
      transaction.set(entitlementRef, {
        ...entitlementProjection,
        userId,
        planId: 'invictus_performance',
        sourceOrderId: orderId,
        startsAt: snapshot.purchasedAt,
        endsAt: snapshot.expiresAt,
        createdAt: orderData.createdAt || nowIso,
        updatedAt: nowIso,
      }, { merge: true });
      transaction.set(userRef, {
        proEntitlement: entitlementProjection,
        isSubscribed: true,
        status: 'PRO_ATIVO',
        subscriptionTier: 'performance',
        currentPlan: 'performance',
        subscriptionStatus: 'active_premium',
        paymentStatus: 'approved',
        customerId: orderData.customerId || userId,
        subscriptionId: snapshot.transactionId || orderData.subscriptionId || '',
        orderId,
        chargeId: snapshot.transactionId || paymentId,
        activatedAt: snapshot.purchasedAt || nowIso,
        nextBillingDate: snapshot.expiresAt,
        expiresAt: snapshot.expiresAt,
        subscriptionExpiresAt: snapshot.expiresAt,
        plano: 'performance',
        assinatura: 'ativa',
        statusPagamento: 'aprovado',
        premium: true,
        performance: true,
        isPro: true,
        plan: 'pro',
        proStatus: snapshot.status,
        proActivatedAt: FieldValue.serverTimestamp(),
        proPaymentId: paymentId,
        ...(context.transferDirection === 'destination' && context.transferOccurredAt ? {
          lastTransferInAt: context.transferOccurredAt,
        } : {}),
        ...(clearsTransferCutoff ? {
          lastTransferOutAt: null,
          lastTransferOutTransactionId: null,
          lastTransferOutTransactionIds: [],
        } : {}),
        ...purchaseProvenanceUpdate,
        updatedAt: nowIso,
      }, { merge: true });
      writeProcessedWebhook(transaction, context, userId, 'provisioned', nowIso);

      return { success: true as const, alreadyGranted, userId };
    });
  } catch (error) {
    if (!isBillingUserUnavailableError(error)) await markProvisioningRetryable(orderId);
    throw error;
  }

  if (!transactionResult.duplicate && !transactionResult.stale && !transactionResult.alreadyGranted) {
    await logPaymentAudit({
      userId: transactionResult.userId,
      orderId,
      paymentId,
      previousStatus: 'pending',
      newStatus: 'approved',
      eventSource,
      action: 'pro_granted',
      reason: `Entitlement RevenueCat ${snapshot.productId} aplicado até ${accessEndsAt}.`,
    });
  }

  return transactionResult;
}

/** Ativa o plano gratuito sem produzir nenhum dos sinais legados de PRO. */
export async function activateOpenPlan(orderId: string, paymentId: string, eventSource: string) {
  const nowIso = new Date().toISOString();
  const orderRef = db.collection('payment_orders').doc(orderId);
  const result = await db.runTransaction(async (transaction: any) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) throw new Error(`Pedido ${orderId} não foi encontrado no banco de dados.`);
    const orderData = orderSnap.data()!;
    if (orderData.planId !== 'invictus_open') throw new Error(`Pedido ${orderId} não corresponde ao Plano Open.`);

    const userId = orderData.userId;
    const userRef = db.collection('users').doc(userId);
    const openEntitlementRef = db.collection('user_entitlements').doc(`${userId}_invictus_open`);
    const userSnap = await transaction.get(userRef);
    const userData = userSnap.exists ? userSnap.data() : null;
    if (!userSnap.exists || !isBillingUserProfileAvailable(userData)) {
      throw new BillingUserUnavailableError(userId);
    }
    const keepExistingPro = isProUser(userData, Date.now());

    transaction.set(orderRef, {
      status: 'approved',
      paymentStatus: 'approved',
      provisionStatus: 'applied',
      paymentId,
      rawStatus: 'approved',
      paidAt: orderData.paidAt || nowIso,
      benefitAppliedAt: nowIso,
      updatedAt: nowIso,
    }, { merge: true });
    transaction.set(openEntitlementRef, {
      userId,
      planId: 'invictus_open',
      status: 'active',
      sourceOrderId: orderId,
      purchasedAt: nowIso,
      startsAt: nowIso,
      createdAt: orderData.createdAt || nowIso,
      updatedAt: nowIso,
    }, { merge: true });

    if (keepExistingPro) {
      transaction.set(userRef, { isSubscribed: true, openPlanActivatedAt: nowIso, updatedAt: nowIso }, { merge: true });
    } else {
      transaction.set(userRef, {
        proEntitlement: {
          version: 1,
          entitlementId: PERFORMANCE_ENTITLEMENT_ID,
          tier: 'open',
          provider: 'none',
          status: 'inactive',
          expiresAt: null,
          providerObservedAt: nowIso,
        },
        isSubscribed: false,
        status: 'OPEN_ATIVO',
        subscriptionTier: 'open',
        currentPlan: 'open',
        subscriptionStatus: 'active_basic',
        paymentStatus: 'approved',
        orderId,
        activatedAt: nowIso,
        nextBillingDate: null,
        expiresAt: null,
        subscriptionExpiresAt: null,
        plano: 'basico',
        assinatura: 'ativa',
        statusPagamento: 'aprovado',
        premium: false,
        performance: false,
        isPro: false,
        plan: 'open',
        proStatus: 'inactive',
        proActivatedAt: null,
        proPaymentId: null,
        updatedAt: nowIso,
      }, { merge: true });
    }

    return { success: true as const, alreadyGranted: orderData.provisionStatus === 'applied', userId };
  });

  await logPaymentAudit({
    userId: result.userId,
    orderId,
    paymentId,
    previousStatus: 'pending',
    newStatus: 'approved',
    eventSource,
    action: 'payment_approved',
    reason: 'Plano Open gratuito ativado sem entitlement PRO.',
  });
  return result;
}

/**
 * Universal backend function to revoke Pro access of a user.
 */
export async function revokeProAccess(
  orderId: string,
  paymentId: string,
  newStatus: string,
  eventSource: string,
  reasonDetails: string,
  context?: RevenueCatProvisioningContext
) {
  const nowIso = new Date().toISOString();
  const orderRef = db.collection('payment_orders').doc(orderId);
  const result = await db.runTransaction(async (transaction: any) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) throw new Error(`Pedido ${orderId} não foi encontrado no banco de dados para revogação.`);

    const orderData = orderSnap.data()!;
    if (orderData.planId !== 'invictus_performance') {
      throw new Error(`Pedido ${orderId} não corresponde ao Plano Performance.`);
    }
    const userId = orderData.userId;
    const userRef = db.collection('users').doc(userId);
    const entitlementRef = db.collection('user_entitlements').doc(`${userId}_invictus_performance`);
    const eventRef = context?.eventId
      ? db.collection('webhook_events').doc(context.eventDocumentId || context.eventId)
      : null;
    const [userSnap, eventSnap] = await Promise.all([
      transaction.get(userRef),
      eventRef ? transaction.get(eventRef) : Promise.resolve(null),
    ]);
    if (eventSnap?.exists && eventSnap.data()?.status === 'processed') {
      return { success: true as const, duplicate: true, stale: false, userId, previousStatus: orderData.status || 'pending' };
    }

    const userData = userSnap.exists ? userSnap.data() : null;
    if (!userSnap.exists || !isBillingUserProfileAvailable(userData)) {
      throw new BillingUserUnavailableError(userId);
    }
    const sourceTransferMillis = context?.transferDirection === 'source'
      ? entitlementDateToMillis(context.transferOccurredAt)
      : null;
    const latestTransferIn = latestTransferInMillis(userData, orderData);
    const latestTransferOut = transferOutCutoffMillis(userData, orderData);
    const latestPurchaseEvent = latestPurchaseEventMillis(userData, orderData);
    const sourceTransferWasSuperseded = context?.transferDirection === 'source'
      && sourceTransferMillis !== null
      && ((latestTransferIn !== null && latestTransferIn > sourceTransferMillis)
        || (latestTransferOut !== null && latestTransferOut > sourceTransferMillis)
        || (latestPurchaseEvent !== null && latestPurchaseEvent > sourceTransferMillis));
    if (sourceTransferWasSuperseded) {
      writeProcessedWebhook(transaction, context, userId, 'ignored_superseded_transfer_out', nowIso);
      return { success: true as const, duplicate: false, stale: true, userId, previousStatus: orderData.status || 'pending' };
    }
    // TRANSFER source é autoritativo mesmo se a consulta REST usada no evento
    // tiver providerObservedAt anterior a uma consulta concorrente. Apenas um
    // TRANSFER in ou compra por lifecycle comprovadamente posterior podem
    // superar esse evento.
    const authoritativeSourceTransfer = context?.transferDirection === 'source';
    if (context
      && !authoritativeSourceTransfer
      && isOlderProviderSnapshot(userData, context.entitlement.providerObservedAt, orderData)) {
      writeProcessedWebhook(transaction, context, userId, 'ignored_stale_snapshot', nowIso);
      return { success: true as const, duplicate: false, stale: true, userId, previousStatus: orderData.status || 'pending' };
    }

    const providerStatus: ProEntitlementStatus = context?.entitlement.status
      || (newStatus === 'refunded' ? 'refunded' : newStatus === 'expired' ? 'expired' : 'revoked');
    const providerObservedAt = context?.entitlement.providerObservedAt || nowIso;
    const expiresAt = context?.entitlement.expiresAt || nowIso;
    const transferOutAt = context?.transferDirection === 'source'
      ? context.transferOccurredAt || providerObservedAt
      : null;
    const transferOutReceiptIds = transferOutAt
      ? Array.from(new Set([
          context?.entitlement.transactionId,
          orderData.transactionId,
          userData?.proEntitlement?.transactionId,
          context?.eventTransactionId,
          paymentId,
          ...(Array.isArray(orderData.lastTransferOutTransactionIds) ? orderData.lastTransferOutTransactionIds : []),
          ...(Array.isArray(userData?.lastTransferOutTransactionIds) ? userData.lastTransferOutTransactionIds : []),
        ]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .map((value) => value.trim())))
      : [];
    const primaryTransferOutReceiptId = transferOutReceiptIds[0] || paymentId;
    const existingRiskFlags = Array.isArray(orderData.riskFlags) ? orderData.riskFlags : [];
    const riskFlags = newStatus === 'charged_back'
      ? Array.from(new Set([...existingRiskFlags, 'chargeback_detected', 'account_review_triggered']))
      : existingRiskFlags;
    const inactiveProjection = context
      ? canonicalEntitlement({ ...context.entitlement, active: false, status: providerStatus }, context.eventId)
      : {
          version: 1,
          entitlementId: PERFORMANCE_ENTITLEMENT_ID,
          tier: 'performance',
          provider: 'revenuecat',
          status: providerStatus,
          expiresAt,
          providerObservedAt,
          transactionId: paymentId,
        };

    const orderUpdate: Record<string, unknown> = {
      status: newStatus,
      paymentStatus: newStatus,
      provisionStatus: 'revoked',
      paymentId,
      rawStatus: newStatus,
      riskFlags,
      provider: 'revenuecat',
      platform: context?.entitlement.store === 'APP_STORE'
        ? 'ios'
        : context?.entitlement.store === 'PLAY_STORE' ? 'android' : orderData.platform || 'unknown',
      productId: context?.entitlement.productId || orderData.productId || null,
      transactionId: transferOutAt
        ? primaryTransferOutReceiptId
        : context?.entitlement.transactionId || paymentId,
      expiresAt,
      providerObservedAt,
      lastWebhookEventId: context?.eventId || orderData.lastWebhookEventId || null,
      lastWebhookEventType: context?.eventType || orderData.lastWebhookEventType || null,
      lastWebhookAt: context?.eventId ? nowIso : orderData.lastWebhookAt || null,
      updatedAt: nowIso,
      ...(transferOutAt ? {
        lastTransferOutAt: transferOutAt,
        lastTransferOutTransactionId: primaryTransferOutReceiptId,
        lastTransferOutTransactionIds: transferOutReceiptIds,
      } : {}),
    };
    if (typeof context?.amount === 'number' && Number.isFinite(context.amount) && context.amount >= 0) {
      orderUpdate.amount = context.amount;
      orderUpdate.amountSource = 'revenuecat_webhook';
    }
    if (typeof context?.refundAmount === 'number'
      && Number.isFinite(context.refundAmount)
      && context.refundAmount < 0) {
      orderUpdate.refundAmount = context.refundAmount;
    }
    if (context?.currency) orderUpdate.currency = context.currency;
    transaction.set(orderRef, orderUpdate, { merge: true });
    transaction.set(entitlementRef, {
      ...inactiveProjection,
      userId,
      planId: 'invictus_performance',
      sourceOrderId: orderId,
      updatedAt: nowIso,
    }, { merge: true });
    transaction.set(userRef, {
      proEntitlement: inactiveProjection,
      // O usuário continua podendo usar o Plano Open; estes campos não podem
      // continuar sinalizando Performance após expiração/reembolso.
      isSubscribed: false,
      status: 'OPEN_ATIVO',
      subscriptionTier: 'open',
      currentPlan: 'open',
      subscriptionStatus: 'active_basic',
      paymentStatus: newStatus,
      nextBillingDate: null,
      expiresAt,
      subscriptionExpiresAt: expiresAt,
      plano: 'basico',
      assinatura: 'Inativa',
      statusPagamento: newStatus,
      premium: false,
      performance: false,
      isPro: false,
      plan: 'open',
      proStatus: providerStatus,
      proActivatedAt: null,
      proPaymentId: null,
      isUnderReview: newStatus === 'charged_back' ? true : userData?.isUnderReview || false,
      ...(transferOutAt ? {
        lastTransferOutAt: transferOutAt,
        lastTransferOutTransactionId: primaryTransferOutReceiptId,
        lastTransferOutTransactionIds: transferOutReceiptIds,
      } : {}),
      updatedAt: nowIso,
    }, { merge: true });
    if (context) writeProcessedWebhook(transaction, context, userId, 'revoked', nowIso);

    return { success: true as const, duplicate: false, stale: false, userId, previousStatus: orderData.status || 'pending' };
  });

  if (!result.duplicate && !result.stale) {
    await logPaymentAudit({
      userId: result.userId,
      orderId,
      paymentId,
      previousStatus: result.previousStatus,
      newStatus,
      eventSource,
      action: 'pro_revoked',
      reason: `Acesso PRO revogado devido ao status ${newStatus}. Motivo: ${reasonDetails}.`,
    });
  }

  return result;
}
