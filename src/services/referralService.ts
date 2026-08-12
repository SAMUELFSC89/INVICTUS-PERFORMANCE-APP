import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, getCountFromServer } from 'firebase/firestore';
import { UserProfile, Referral } from '../types';

export const referralService = {
  generateReferralCode(uid: string): string {
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${uid.substring(0, 4).toUpperCase()}-${random}`;
  },

  async getReferrerByCode(code: string): Promise<UserProfile | null> {
    const q = query(collection(db, 'users'), where('referralCode', '==', code.toUpperCase()));
    try {
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) return null;
      const data = querySnapshot.docs[0].data() as UserProfile;
      return data;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'users');
      return null;
    }
  },

  async createReferral(referrerUid: string, refereeUid: string, refereeName: string) {
    const referralId = `${referrerUid}_${refereeUid}`;
    const referral = {
      id: referralId,
      referrerUid,
      refereeUid,
      refereeName,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'referrals', referralId), referral);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `referrals/${referralId}`);
      throw error;
    }
    
    // Update referrer's total referrals count
    const referrerRef = doc(db, 'users', referrerUid);
    let referrerSnap;
    try {
      referrerSnap = await getDoc(referrerRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `users/${referrerUid}`);
      throw error;
    }
    
    if (!referrerSnap.exists()) return;

    const referrerData = referrerSnap.data() as UserProfile;
    const stats = referrerData.referralStats || { totalReferrals: 0, validReferrals: 0, bonusBalance: 0, referralPoints: 0 };
    stats.totalReferrals = (stats.totalReferrals || 0) + 1;

    try {
      await updateDoc(referrerRef, { referralStats: stats });
    } catch (error) {
      console.warn('[Referral] Non-blocking permission warning updating referrer stats:', error);
      // Catch and log safely instead of throwing to prevent breaking the registering user's signup flow
    }
  },

  async validateReferral(referralId: string) {
    const referralRef = doc(db, 'referrals', referralId);
    let referralSnap;
    try {
      referralSnap = await getDoc(referralRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `referrals/${referralId}`);
      throw error;
    }
    
    if (!referralSnap.exists()) throw new Error('Referral not found');
    const referral = referralSnap.data() as Referral;
    
    if (referral.status !== 'pending') return;

    const referrerRef = doc(db, 'users', referral.referrerUid);
    let referrerSnap;
    try {
      referrerSnap = await getDoc(referrerRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `users/${referral.referrerUid}`);
      throw error;
    }
    if (!referrerSnap.exists()) return;
    const referrer = referrerSnap.data() as UserProfile;

    const refereeRef = doc(db, 'users', referral.refereeUid);
    let refereeSnap;
    try {
      refereeSnap = await getDoc(refereeRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `users/${referral.refereeUid}`);
      throw error;
    }
    if (!refereeSnap.exists()) return;
    const referee = refereeSnap.data() as UserProfile;

    // Criteria: Subscribed AND (2 workouts OR 3 active days)
    const hasMinWorkouts = await this.checkMinWorkouts(referral.refereeUid, 2);
    const hasMinActiveDays = (referee.totalActiveDays || 0) >= 3;
    const isSubscribed = referee.isSubscribed;

    if (isSubscribed && (hasMinWorkouts || hasMinActiveDays)) {
      // 1. Mark referral as valid
      try {
        await updateDoc(referralRef, {
          status: 'valid',
          validatedAt: new Date().toISOString()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `referrals/${referralId}`);
        throw error;
      }

      // 2. Award Referrer
      const stats = referrer.referralStats || { totalReferrals: 0, validReferrals: 0, bonusBalance: 0, referralPoints: 0 };
      const currentValid = (stats.validReferrals || 0) + 1;
      
      let bonusPoints = 10;
      let milestonePoints = 0;

      if (currentValid === 3) milestonePoints = 30;
      else if (currentValid === 5) milestonePoints = 70;
      else if (currentValid === 10) milestonePoints = 200;

      stats.validReferrals = currentValid;
      stats.bonusBalance = (stats.bonusBalance || 0) + 5;
      stats.referralPoints = (stats.referralPoints || 0) + (bonusPoints + milestonePoints);

      try {
        await updateDoc(referrerRef, {
          score: (referrer.score || 0) + (bonusPoints + milestonePoints),
          referralStats: stats
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${referral.referrerUid}`);
        throw error;
      }

      // 3. Award Referee
      try {
        await updateDoc(refereeRef, {
          score: (referee.score || 0) + 5
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${referral.refereeUid}`);
        throw error;
      }
    }
  },

  async checkMinWorkouts(userId: string, min: number): Promise<boolean> {
    const q = query(
      collection(db, 'workouts'), 
      where('userId', '==', userId),
      where('status', '==', 'valid')
    );
    try {
      const snapshot = await getCountFromServer(q);
      return snapshot.data().count >= min;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'workouts');
      return false;
    }
  },

  async getMyReferrals(): Promise<Referral[]> {
    const user = auth.currentUser;
    if (!user) return [];

    const q = query(collection(db, 'referrals'), where('referrerUid', '==', user.uid));
    try {
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => doc.data() as Referral);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'referrals');
      return [];
    }
  }
};
