import { BaseRepository } from './base-repository.js';
import { FieldValue } from '../_lib/common.js';

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
    // Incremento atomico via FieldValue.increment em vez de findById + update
    // (read-then-write). O padrao anterior causava lost updates em chamadas
    // concorrentes (duas requisicoes lendo o mesmo xp antes de qualquer uma
    // escrever), permitindo XP duplicado/perdido. Ver auditoria de integridade.
    const userRef = this.collection.doc(userId);
    await userRef.set({ xp: FieldValue.increment(xpAmount) }, { merge: true });
    const updatedSnap = await userRef.get();
    const newXP = updatedSnap.data()?.xp || 0;
    const newLevel = Math.floor(newXP / 1000) + 1;
    await this.update(userId, { level: newLevel });
    return { newXP, newLevel };
  }
}
