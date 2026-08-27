import { BaseRepository } from './base-repository.js';
import { db } from '../_lib/common.js';
import { FieldValue } from 'firebase-admin/firestore';
import { recalculateAllUserScores } from '../_lib/igaService.js';

export class AdminRepository extends BaseRepository<any> {
  constructor() {
    super('admin_reviews');
  }

  async getLogs(category: string, limitNum: number): Promise<any[]> {
    const validCollections = [
      'system_logs',
      'fraud_audit_logs',
      'payment_logs',
      'activity_validation_logs',
      'performance_logs',
      'admin_reviews',
      'system_alerts'
    ];

    const collectionName = validCollections.includes(category) ? category : 'system_logs';
    const snapshot = await db.collection(collectionName)
      .orderBy('timestamp', 'desc')
      .limit(limitNum)
      .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async getSystemAlerts(limitNum = 10): Promise<any[]> {
    const snapshot = await db.collection('system_alerts')
      .orderBy('timestamp', 'desc')
      .limit(limitNum)
      .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async findWorkoutById(workoutId: string): Promise<any | null> {
    const doc = await db.collection('workouts').doc(workoutId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  async reviewWorkoutTransaction(
    workoutId: string,
    athleteId: string,
    status: 'valid' | 'invalid' | 'suspicious',
    adjustedPoints: number,
    previousPoints: number,
    reviewerId: string,
    resolution: string
  ): Promise<void> {
    const workoutRef = db.collection('workouts').doc(workoutId);
    const athleteRef = db.collection('users').doc(athleteId);
    const trustProfileRef = db.collection('user_trust_profiles').doc(athleteId);

    await db.runTransaction(async (transaction) => {
      const athleteSnap = await transaction.get(athleteRef);
      const athleteData = athleteSnap.exists ? athleteSnap.data() || {} : {};

      // #228: score/weeklyScore NAO sao mais ajustados aqui por delta manual --
      // era mais uma fonte de escrita direta e paralela ao IGA (o motivo real
      // de um workout mudar de status na revisao do admin e justamente o que
      // controla se ele conta ou nao para o IGA: ver isApprovedStatus em
      // api/_lib/igaService.ts, que aceita status 'valid'). Agora que a
      // transacao abaixo grava o novo status do workout, chamamos
      // recalculateAllUserScores(athleteId) apos o commit para que score/
      // weeklyScore/monthlyScore reflitam o historico real recalculado, em vez
      // de um delta aplicado a mao (que podia divergir do valor real do IGA).
      const updates: any = {};

      if (status === 'invalid' && previousPoints > 0) {
        updates.streak = Math.max(0, (athleteData.streak || 1) - 1);
      }

      transaction.update(workoutRef, {
        status,
        points: adjustedPoints,
        'validation.status': status,
        'validation.reviewerId': reviewerId,
        'validation.reviewedAt': new Date().toISOString(),
        'validation.resolution': resolution
      });

      if (Object.keys(updates).length > 0) {
        transaction.update(athleteRef, updates);
      }

      const reviewId = db.collection('admin_reviews').doc().id;
      transaction.set(db.collection('admin_reviews').doc(reviewId), {
        id: reviewId,
        activityId: workoutId,
        userId: athleteId,
        reviewerId,
        originalStatus: status,
        newStatus: status,
        pointsBefore: previousPoints,
        pointsAfter: adjustedPoints,
        resolution,
        timestamp: new Date().toISOString(),
        createdAt: FieldValue.serverTimestamp()
      });

      let trustScore = 100;
      const tpSnap = await transaction.get(trustProfileRef);
      if (tpSnap.exists) {
        trustScore = tpSnap.data()?.trustScore ?? 100;
      }

      if (status === 'valid') trustScore = Math.min(100, trustScore + 5);
      else if (status === 'invalid') trustScore = Math.max(0, trustScore - 25);

      transaction.set(trustProfileRef, {
        trustScore,
        lastValidationReview: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });

    // Recalcula weeklyScore/monthlyScore/score (temporada) pela FONTE UNICA
    // (IGA) agora que o status do workout revisado ja esta commitado -- fora
    // da transaction acima pelo mesmo motivo dos outros pontos de entrada.
    try {
      await recalculateAllUserScores(athleteId);
    } catch (rankingErr) {
      console.error(`[AdminRepository] Falha ao recalcular pontuacao IGA para athleteId=${athleteId} apos revisao de workout ${workoutId}:`, rankingErr);
    }
  }

  async getWithdrawals(status?: string): Promise<any[]> {
    let query: any = db.collection('withdrawals').orderBy('createdAt', 'desc').limit(50);
    if (status) {
      query = query.where('status', '==', status);
    }
    const snapshot = await query.get();
    return snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  }

  async updateWithdrawalStatus(withdrawalId: string, status: string, reviewerId: string, reason?: string): Promise<void> {
    await db.collection('withdrawals').doc(withdrawalId).update({
      status,
      reviewerId,
      rejectionReason: reason || null,
      updatedAt: FieldValue.serverTimestamp()
    });
  }

  async upsertDocument(collectionName: string, id: string | undefined, data: Record<string, any>): Promise<string> {
    const collectionRef = db.collection(collectionName);
    const docRef = id ? collectionRef.doc(id) : collectionRef.doc();
    const payload = {
      ...data,
      id: docRef.id,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: id ? data.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp()
    };
    await docRef.set(payload, { merge: true });
    return docRef.id;
  }
}
