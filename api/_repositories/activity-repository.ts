import { BaseRepository } from './base-repository.js';
import {
  ActivityIdentityInput,
  ActivityIdentityReservation,
  commitActivityIdentityReservation,
} from '../_lib/activity-identity.js';

export interface Activity {
  id?: string;
  userId: string;
  type: string;
  duration?: number;
  intensity?: string;
  startTime?: Date | string;
  endTime?: Date | string;
  pointsEarned?: number;
  scoreAwarded?: number;
  xpEarned?: number;
  status?: string;
  validationStatus?: string;
  evidence?: Record<string, any>;
  traceId?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

export class ActivityRepository extends BaseRepository<Activity> {
  constructor() {
    super('workouts');
  }

  async findByUser(userId: string, limitCount = 20): Promise<Activity[]> {
    const snapshot = await this.collection
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(limitCount)
      .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Activity));
  }

  async findRecentByUser(userId: string, hours = 24): Promise<Activity[]> {
    const sinceDate = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const snapshot = await this.collection
      .where('userId', '==', userId)
      .where('createdAt', '>=', sinceDate)
      .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Activity));
  }

  /**
   * Cria a atividade somente se o ID determinístico da sessão ainda não
   * existir. Isso fecha a corrida entre dois envios simultâneos sem sobrescrever
   * a decisão já persistida pelo primeiro pedido.
   */
  async createIfAbsent(
    data: Omit<Activity, 'id'>,
    customId: string,
    identity?: {
      input: ActivityIdentityInput;
      reservation: Extract<ActivityIdentityReservation, { status: 'claimed' }>;
    },
  ): Promise<{ activity: Activity; created: boolean }> {
    const now = new Date().toISOString();
    const payload = {
      ...data,
      createdAt: (data as any).createdAt || now,
      updatedAt: now,
    };
    const ref = this.collection.doc(customId);
    if (identity) {
      const committed = await commitActivityIdentityReservation({
        ...identity,
        payload,
        mode: 'create',
      });
      if (committed.status === 'lost') {
        throw new Error('A reserva econômica da atividade expirou antes da gravação.');
      }
      if (committed.status === 'existing') {
        return {
          activity: { id: customId, ...committed.activity } as Activity,
          created: false,
        };
      }
      return { activity: { id: customId, ...payload } as Activity, created: true };
    }
    try {
      await ref.create(payload);
      return { activity: { id: customId, ...payload } as Activity, created: true };
    } catch (error: any) {
      const code = String(error?.code || '').toLowerCase();
      const alreadyExists = code === '6'
        || code === 'already-exists'
        || code === 'already_exists'
        || String(error?.message || '').toUpperCase().includes('ALREADY_EXISTS');
      if (!alreadyExists) throw error;
      const existing = await this.findById(customId);
      if (!existing) throw error;
      return { activity: existing, created: false };
    }
  }

  async updateWithIdentity(
    activityId: string,
    patch: Partial<Activity>,
    identity: {
      input: ActivityIdentityInput;
      reservation: Extract<ActivityIdentityReservation, { status: 'claimed' }>;
    },
  ): Promise<boolean> {
    if (identity.input.activityId !== activityId) {
      throw new Error('Reserva de identidade não corresponde ao documento da atividade.');
    }
    const committed = await commitActivityIdentityReservation({
      ...identity,
      payload: patch,
      mode: 'merge',
    });
    return committed.status !== 'lost';
  }
}
