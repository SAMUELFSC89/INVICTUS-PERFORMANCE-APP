export type SecurityEventType =
  | 'SECURITY_APPROVED'
  | 'SECURITY_PARTIAL'
  | 'SECURITY_REVIEW'
  | 'SECURITY_BLOCKED'
  | 'GPS_FAKE'
  | 'DEVICE_ROOT'
  | 'PHOTO_AI'
  | 'NETWORK_RISK'
  | 'TRUST_CHANGED'
  | 'REPUTATION_CHANGED'
  | 'BEHAVIOR_ANOMALY';

export interface SecurityEventPayload {
  eventId: string;
  eventType: SecurityEventType;
  timestamp: string;
  userId: string;
  activityId?: string;
  data: Record<string, any>;
}

export type SecurityEventHandler = (event: SecurityEventPayload) => void | Promise<void>;

export class SecurityEventBus {
  private static instance: SecurityEventBus;
  private subscribers: Map<SecurityEventType, Set<SecurityEventHandler>> = new Map();

  private constructor() {}

  public static getInstance(): SecurityEventBus {
    if (!SecurityEventBus.instance) {
      SecurityEventBus.instance = new SecurityEventBus();
    }
    return SecurityEventBus.instance;
  }

  /**
   * Subscribe to a specific security event.
   */
  public subscribe(eventType: SecurityEventType, handler: SecurityEventHandler): () => void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.subscribers.get(eventType)?.delete(handler);
    };
  }

  /**
   * Publish an event to all registered subscribers asynchronously without blocking.
   */
  public publish(eventType: SecurityEventType, userId: string, data: Record<string, any> = {}, activityId?: string): void {
    const payload: SecurityEventPayload = {
      eventId: `sec_evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      eventType,
      timestamp: new Date().toISOString(),
      userId,
      activityId,
      data
    };

    const handlers = this.subscribers.get(eventType);
    if (handlers && handlers.size > 0) {
      handlers.forEach(handler => {
        try {
          Promise.resolve(handler(payload)).catch(err => {
            console.error(`[SecurityEventBus] Error executing subscriber for ${eventType}:`, err);
          });
        } catch (err) {
          console.error(`[SecurityEventBus] Synchronous error in subscriber for ${eventType}:`, err);
        }
      });
    }
  }

  /**
   * Clear subscribers (useful for test suites).
   */
  public clearAllSubscribers(): void {
    this.subscribers.clear();
  }
}

export const securityEventBus = SecurityEventBus.getInstance();
