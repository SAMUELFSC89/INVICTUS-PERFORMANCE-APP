import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { readWorkoutHealthRecord, type WorkoutHealthRecord } from '../core/health/workoutHealthTypes';
export { readWorkoutHealthRecord } from '../core/health/workoutHealthTypes';

export interface WorkoutFeedbackHistory {
  records: WorkoutHealthRecord[];
  status: 'available' | 'unavailable';
  reviewedCount: number;
  limitReached: boolean;
}

/** A bounded private comparison window; never part of ranking or shared cards. */
export async function loadWorkoutFeedbackHistory(uid: string): Promise<WorkoutFeedbackHistory> {
  const unavailable: WorkoutFeedbackHistory = { records: [], status: 'unavailable', reviewedCount: 0, limitReached: false };
  if (!uid || auth.currentUser?.uid !== uid) return unavailable;
  try {
    const snapshot = await getDocs(query(collection(db, 'workouts'), where('userId', '==', uid), orderBy('timestamp', 'desc'), limit(31)));
    if (auth.currentUser?.uid !== uid) return unavailable;
    const documents = snapshot.docs.slice(0, 30);
    const records = documents.flatMap(document => {
      const data = document.data();
      // The query and security rules scope access; this extra check also protects
      // against malformed imported records and stale mocks/caches.
      if (data.userId !== uid) return [];
      const record = readWorkoutHealthRecord(data.healthSession ?? data.details?.healthSession);
      return record ? [record] : [];
    });
    return { records, status: 'available', reviewedCount: documents.length, limitReached: snapshot.docs.length > 30 };
  } catch {
    return unavailable;
  }
}
