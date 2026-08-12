import { db } from './common.js';
import { SponsorChallenge } from '../../src/types.js';

export const DEFAULT_SPONSOR_CHALLENGES: SponsorChallenge[] = [
  {
    id: 'sponsor_smartfit_30',
    sponsorName: 'Smart Fit',
    sponsorLogoUrl: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=120&auto=format&fit=crop&q=80',
    title: 'Desafio Smart Fit High-Volume',
    description: 'Complete 15 treinos presenciais em academias parceiras e garanta sua parte do fundo de 100.000 IV Coins.',
    bannerUrl: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=800&auto=format&fit=crop&q=80',
    startDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    endDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
    totalPrizeCoins: 100000,
    winnersCount: 50,
    criteria: 'Maior constância e volume de check-ins verificados por GPS',
    active: true,
    participantsCount: 1420
  },
  {
    id: 'sponsor_growth_supps',
    sponsorName: 'Growth Supplements',
    sponsorLogoUrl: 'https://images.unsplash.com/photo-1579722821273-0f6c7d44362f?w=120&auto=format&fit=crop&q=80',
    title: 'Desafio Growth Muscle Burn',
    description: 'Bata 100km de corrida/cardio acumulados e concorra a 150.000 IV Coins + Kit de Suplementação.',
    bannerUrl: 'https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=800&auto=format&fit=crop&q=80',
    startDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    totalPrizeCoins: 150000,
    winnersCount: 100,
    criteria: 'Distância total percorrida e ritmo médio em treinos de cardio',
    active: true,
    participantsCount: 2890
  },
  {
    id: 'sponsor_integralmedica_streak',
    sponsorName: 'Integralmedica',
    sponsorLogoUrl: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=120&auto=format&fit=crop&q=80',
    title: 'Desafio Integralmedica Inquebrável',
    description: 'Mantenha 21 dias seguidos de treino ativo e participe da divisão de 200.000 IV Coins Resgatáveis.',
    bannerUrl: 'https://images.unsplash.com/photo-1540497077202-7c8a3999166f?w=800&auto=format&fit=crop&q=80',
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    totalPrizeCoins: 200000,
    winnersCount: 200,
    criteria: 'Streak de treinos sem falha no período do desafio',
    active: true,
    participantsCount: 3100
  }
];

export class SponsorEngine {
  /**
   * Fetches active sponsored challenges.
   */
  static async getActiveChallenges(): Promise<SponsorChallenge[]> {
    if (!db) return DEFAULT_SPONSOR_CHALLENGES;
    try {
      const snap = await db.collection('sponsors').where('active', '==', true).get();
      if (snap.empty) {
        for (const sc of DEFAULT_SPONSOR_CHALLENGES) {
          await db.collection('sponsors').doc(sc.id).set(sc);
        }
        return DEFAULT_SPONSOR_CHALLENGES;
      }
      return snap.docs.map(doc => doc.data() as SponsorChallenge);
    } catch (err) {
      console.warn('[SponsorEngine] Error fetching sponsor challenges from DB:', err);
      return DEFAULT_SPONSOR_CHALLENGES;
    }
  }

  /**
   * Joins a user into a sponsored challenge.
   */
  static async joinChallenge(userId: string, challengeId: string): Promise<{ success: boolean; message: string }> {
    if (!db) throw new Error('Database not initialized');
    const docRef = db.collection('sponsors').doc(challengeId);
    const snap = await docRef.get();

    if (!snap.exists) throw new Error('Desafio patrocinado não encontrado.');

    const partRef = db.collection('sponsor_participants').doc(`${userId}_${challengeId}`);
    await partRef.set({
      userId,
      challengeId,
      joinedAt: new Date().toISOString()
    }, { merge: true });

    // Increment participants count
    await docRef.set({
      participantsCount: (snap.data()?.participantsCount || 0) + 1
    }, { merge: true });

    return {
      success: true,
      message: 'Você entrou no desafio patrocinado com sucesso!'
    };
  }

  /**
   * Upserts a sponsored challenge definition (for Admin).
   */
  static async upsertSponsorChallenge(challenge: SponsorChallenge): Promise<SponsorChallenge> {
    if (!db) throw new Error('Database not initialized');
    await db.collection('sponsors').doc(challenge.id).set(challenge, { merge: true });
    return challenge;
  }
}
