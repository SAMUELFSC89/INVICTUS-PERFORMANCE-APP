import { BaseRepository } from './base-repository.js';

export interface UserProfile {
  id?: string;
  uid?: string;
  email?: string;
  displayName?: string;
  xp?: number;
  level?: number;
  streakCount?: number;
  [key: string]: any;
}

export class UserRepository extends BaseRepository<UserProfile> {
  constructor() {
    super('users');
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    const snapshot = await this.collection.where('email', '==', email).limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as UserProfile;
  }

  async addXP(userId: string, xpAmount: number): Promise<{ newXP: number; newLevel: number }> {
    const user = await this.findById(userId);
    const currentXP = user?.xp || 0;
    const newXP = currentXP + xpAmount;
    const newLevel = Math.floor(newXP / 1000) + 1;

    await this.update(userId, { xp: newXP, level: newLevel });
    return { newXP, newLevel };
  }
}
