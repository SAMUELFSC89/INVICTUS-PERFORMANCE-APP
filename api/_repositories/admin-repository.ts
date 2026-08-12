import { BaseRepository } from './base-repository.js';
import { db } from '../_lib/common.js';
import { FieldValue } from 'firebase-admin/firestore';

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

      const ptsDifference = adjustedPoints - previousPoints;
      const updates: any = {};

      if (ptsDifference !== 0) {
        updates.score = Math.max(0, (athleteData.score || 0) + ptsDifference);
        updates.weeklyScore = Math.max(0, (athleteData.weeklyScore || 0) + ptsDifference);
      }

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
