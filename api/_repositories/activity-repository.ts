import { BaseRepository } from './base-repository.js';

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
}
