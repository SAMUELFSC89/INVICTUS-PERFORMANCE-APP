import { db, FieldValue } from '../common.js';
import { ActivitySource } from '../score-config.js';

export const RULE_VERSION = 'v1.0.0';
export const ENGINE_VERSION = 'v2.0.0';

export interface ScoreEvent {
  id: string;
  userId: string;
  source: ActivitySource;
  createdAt: string;
  payload: any;
}

export interface EventLogRecord {
  eventId: string;
  idempotencyKey: string;
  userId: string;
  source: ActivitySource;
  payload: any;
  receivedAt: string;
  processed: boolean;
  processingTimeMs?: number;
  status: 'PENDING' | 'SUCCESS' | 'ALREADY_PROCESSED' | 'FAILED';
  error?: string;
  ruleVersion: string;
  engineVersion: string;
}

export class EventLogService {
  static generateIdempotencyKey(userId: string, activityId: string, source: ActivitySource): string {
    return `${userId}_${source}_${activityId}`;
  }

  static async isAlreadyProcessed(idempotencyKey: string): Promise<boolean> {
    const snap = await db.collection('score_events').doc(idempotencyKey).get();
    if (!snap.exists) return false;
    const data = snap.data();
    return data?.status === 'SUCCESS' || data?.status === 'ALREADY_PROCESSED';
  }

  static async logEventReceived(event: ScoreEvent, idempotencyKey: string): Promise<void> {
    console.log(`[SCORE ENGINE] [EVENT] [${event.userId}] Registrando evento na coleção 'score_events': ${idempotencyKey}`);
    await db.collection('score_events').doc(idempotencyKey).set({
      eventId: event.id,
      idempotencyKey,
      userId: event.userId,
      source: event.source,
      payload: event.payload,
      receivedAt: new Date().toISOString(),
      processed: false,
      status: 'PENDING',
      ruleVersion: RULE_VERSION,
      engineVersion: ENGINE_VERSION,
      createdAtServer: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  static async markEventProcessed(idempotencyKey: string, status: 'SUCCESS' | 'ALREADY_PROCESSED' | 'FAILED', processingTimeMs: number, error?: string): Promise<void> {
    console.log(`[SCORE ENGINE] [EVENT] IdempotencyKey ${idempotencyKey} status final: ${status} (${processingTimeMs}ms)`);
    await db.collection('score_events').doc(idempotencyKey).update({
      processed: status === 'SUCCESS' || status === 'ALREADY_PROCESSED',
      status,
      processingTimeMs,
      error: error || null,
      updatedAtServer: FieldValue.serverTimestamp()
    });
  }
}
