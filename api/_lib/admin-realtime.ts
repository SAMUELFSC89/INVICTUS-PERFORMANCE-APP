import { db, FieldValue } from './common.js';

export type AdminRealtimeEventType =
  | 'CHAMPIONSHIP_REGISTRATION_PENDING'
  | 'CHAMPIONSHIP_REGISTRATION_CONFIRMED'
  | 'CHAMPIONSHIP_PAYMENT_RECONCILIATION_REQUIRED'
  | 'CHAMPIONSHIP_SCORE_CHANGED'
  | 'CHAMPIONSHIP_SETTLEMENT_CHANGED'
  | 'CHAMPIONSHIP_CHANGED'
  | 'WITHDRAWAL_REQUESTED'
  | 'WITHDRAWAL_STATUS_CHANGED'
  | 'WITHDRAWAL_PAID'
  | 'POWERLIFT_SUBMITTED'
  | 'POWERLIFT_REVIEW_REQUIRED'
  | 'POWERLIFT_REVIEWED'
  | 'ACTIVITY_REVIEW_REQUIRED'
  | 'ACTIVITY_REVIEWED'
  | 'STORE_ORDER_CHANGED'
  | 'STORE_PRODUCT_CHANGED'
  | 'DROP_CHANGED'
  | 'SUBSCRIPTION_CHANGED'
  | 'GYM_CHANGED'
  | 'USER_CHANGED'
  | 'ADMIN_CONFIG_CHANGED'
  | 'SYSTEM_CHANGED';

type AdminRealtimeSignal = {
  type: AdminRealtimeEventType;
  source?: string;
  occurredAt?: string;
};

/**
 * Invalidates the web admin cache without exposing operational payloads to
 * clients. The document lives in system_stats because that collection is
 * already readable by authenticated clients, so it intentionally contains
 * only a monotonic revision and non-sensitive event metadata.
 *
 * Business truth remains in the canonical collections/APIs. The web admin
 * listens to this revision and then reloads the currently visible module from
 * the server. Failures here are best-effort and must never break the business
 * transaction that already succeeded.
 */
export async function publishAdminRealtimeSignal(signal: AdminRealtimeSignal): Promise<void> {
  const ref = db.collection('system_stats').doc('admin_realtime');
  const occurredAt = signal.occurredAt || new Date().toISOString();

  await ref.set({
    revision: FieldValue.increment(1),
    lastEventType: signal.type,
    lastEventSource: String(signal.source || 'backend').slice(0, 80),
    lastEventAt: occurredAt,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export function publishAdminRealtimeSignalSafe(signal: AdminRealtimeSignal): void {
  void publishAdminRealtimeSignal(signal).catch((error: any) => {
    console.warn('[Admin realtime] Falha ao publicar sinal de atualização:', error?.message || error);
  });
}