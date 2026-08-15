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

  // Incremento atomico do campo "score" -- este e o campo REAL usado pelo
  // ranking/leaderboard visivel ao usuario (ver api/_handlers/ranking.ts,
  // orderBy(scoreField) onde scoreField='score' para period='all', e tambem
  // usado pelo AdminDashboard). Distinto de "xp" (nivelamento) e de "totalScore"
  // (campo do ScoreEngine/Strava, nao lido pelo ranking visivel). Adicionado
  // para que o fluxo real de cardio/treino (/api/validate-activity) realmente
  // credite pontos de ranking, nao so XP. Ver auditoria 2026-08 (pedido do
  // usuario: "XP nao e o mais importante e sim os pontos ganhos para a
  // competicao").
  async addRankingScore(userId: string, amount: number): Promise<{ newScore: number }> {
    const userRef = this.collection.doc(userId);
    if (amount === 0) {
      const snap = await userRef.get();
      return { newScore: snap.data()?.score || 0 };
    }
    await userRef.set({ score: FieldValue.increment(amount) }, { merge: true });
    const updatedSnap = await userRef.get();
    const newScore = updatedSnap.data()?.score || 0;
    return { newScore };
  }
}
