import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, addDoc, serverTimestamp, limit, orderBy, increment } from 'firebase/firestore';
import { Workout, UserProfile } from '../types';
import { calculatePoints } from '../lib/seasonUtils';
import { applyWorkoutProgress } from './habitService';

export function simpleHash(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString();
}

export const workoutService = {
  async submitWorkout(data: { photoUrl?: string; type: 'workout' | 'cardio' | 'diet'; duration?: number; distance?: number; location?: { lat: number; lng: number }; isMockLocation?: boolean }) {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    const userRef = doc(db, 'users', user.uid);
    let userSnap;
    try {
      userSnap = await getDoc(userRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
      throw error;
    }
    
    if (!userSnap.exists()) throw new Error('Perfil do usuário não encontrado.');
    const userData = userSnap.data() as UserProfile;

    if (userData.isBanned) throw new Error('Sua conta foi banida desta temporada.');

    const now = new Date();
    const todayStr = now.toLocaleDateString('sv-SE'); // YYYY-MM-DD in local time

    // Proximity Validation (Removed)
    let status: Workout['status'] = 'pending';
    if (data.type === 'workout') {
      if (data.photoUrl && data.location) {
        status = 'valid'; // Validated by photo and location presence
      } else if (data.photoUrl) {
        status = 'pending'; // Needs manual review if no location
      }
    } else {
      // Cardio and Diet are usually valid if submitted correctly
      status = 'valid';
    }

    // Anti-fraud: Mock location
    if (data.isMockLocation) {
      throw new Error('Localização falsa detectada. Ação invalidada.');
    }

    // Anti-fraud: Minimum duration for workout or cardio
    if (data.type === 'workout' && (data.duration || 0) < 30) {
      throw new Error('O treino deve ter no mínimo 30 minutos para ser validado.');
    }
    if (data.type === 'cardio' && (data.duration || 0) < 20) {
      throw new Error('O cardio deve ter no mínimo 20 minutos para ser validado.');
    }

    // Anti-cheat: Check for duplicate images
    let imageHash = '';
    if (data.photoUrl) {
      imageHash = simpleHash(data.photoUrl);
      const q = query(collection(db, 'workouts'), where('userId', '==', user.uid), where('imageHash', '==', imageHash), limit(1));
      let hashSnap;
      try {
        hashSnap = await getDocs(q);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'workouts');
        throw error;
      }
      if (!hashSnap.empty) {
        throw new Error('Esta imagem já foi utilizada em outro registro.');
      }
    }

    // Check if already submitted this TYPE today
    const qType = query(
      collection(db, 'workouts'), 
      where('userId', '==', user.uid), 
      where('type', '==', data.type), 
      where('timestamp', '>=', todayStr),
      limit(1)
    );
    let typeSnap;
    try {
      typeSnap = await getDocs(qType);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'workouts');
      throw error;
    }
    if (!typeSnap.empty) {
      throw new Error(`Você já registrou seu ${data.type === 'workout' ? 'treino' : data.type === 'cardio' ? 'cardio' : 'dieta'} hoje!`);
    }

    // Calculate today's existing points to check 100pt limit
    const qToday = query(
      collection(db, 'workouts'), 
      where('userId', '==', user.uid), 
      where('timestamp', '>=', todayStr),
      limit(20) // Should be enough to sum daily points
    );
    let todaySnap;
    try {
      todaySnap = await getDocs(qToday);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'workouts');
      throw error;
    }
    let todayPoints = 0;
    todaySnap.forEach(d => {
      const w = d.data() as Workout;
      if (w.status !== 'invalid') todayPoints += w.points || 0;
    });

    // Calculate points using centralized logic
    const scoring = calculatePoints(
      data.type,
      userData.streak,
      todaySnap.empty,
      {
        duration: data.duration,
        distance: data.distance,
        hasPhoto: !!data.photoUrl,
        wonLastSeason: userData.wonLastSeason
      },
      userData.seasonBoost
    );
    
    let pointsEarned = scoring.earned;

    // Check daily limit (100 pts)
    if (todayPoints >= 100) {
      throw new Error('Você já atingiu o limite máximo de 100 pontos por dia (Sistema Anti-Trapaça).');
    }
    if (todayPoints + pointsEarned > 100) {
      pointsEarned = 100 - todayPoints;
    }

    let newScore = userData.score + pointsEarned;
    let newStreak = userData.streak;
    let totalActiveDays = userData.totalActiveDays || 0;
    let totalWorkouts = userData.totalWorkouts || 0;
    
    if (data.type === 'workout') totalWorkouts += 1;
    
    const lastCheckInDate = userData.lastCheckIn ? new Date(userData.lastCheckIn).toLocaleDateString('sv-SE') : null;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('sv-SE');

    if (lastCheckInDate !== todayStr) {
      totalActiveDays += 1;
      if (lastCheckInDate === yesterdayStr) {
        newStreak += 1;
        // Sequence bonuses
        let bonus = 0;
        if (newStreak === 3) bonus = 10;
        else if (newStreak === 5) bonus = 20;
        else if (newStreak === 7) bonus = 35;
        
        newScore += bonus;
      } else {
        newStreak = 1;
      }
    }

    const workout: Partial<Workout> = {
      userId: user.uid,
      timestamp: new Date().toISOString(),
      status: status,
      type: data.type,
      points: pointsEarned,
      imageHash: imageHash,
      duration: data.duration,
      distance: data.distance,
      location: data.location,
      photoUrl: data.photoUrl
    };

    let workoutDocRef: { id: string } | undefined;
    try {
      workoutDocRef = await addDoc(collection(db, 'workouts'), workout);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'workouts');
      throw error;
    }

    // Hábito ("Criar Hábito"): aplica progresso ao hábito ativo do usuário, se houver.
    // Idempotente no backend (por workoutDocRef.id) e não-bloqueante — nunca deve
    // impedir o fluxo normal de registro de cardio caso falhe.
    if (data.type === 'cardio' && workoutDocRef) {
      applyWorkoutProgress(workoutDocRef.id).catch(() => {});
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('invictus:cardio-logged', { detail: { workoutId: workoutDocRef.id } }));
      }
    }
    
    const updateData: any = {
      score: newScore,
      streak: newStreak,
      totalActiveDays: totalActiveDays,
      totalWorkouts: totalWorkouts,
      lastCheckIn: new Date().toISOString()
    };

    if (!userData.firstScoreAt && pointsEarned > 0) {
      updateData.firstScoreAt = new Date().toISOString();
    }

    try {
      await updateDoc(userRef, updateData);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      throw error;
    }

    return { score: newScore, streak: newStreak };
  },

  async submitRecovery(data: { focus: 'alongamento' | 'sono' | 'meditacao' | 'caminhada'; description: string; quizAnswers?: any }) {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    const idToken = await user.getIdToken();
    const response = await fetch('/api/validate-activity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        type: 'recovery',
        focus: data.focus,
        description: data.description,
        quizAnswers: data.quizAnswers
      })
    });

    if (!response.ok) {
      const resData = await response.json();
      throw new Error(resData.error || 'Erro ao registrar descanso inteligente.');
    }

    const resJson = await response.json();
    return resJson;
  },

  async getUserWorkouts(limitCount = 10) {
    const user = auth.currentUser;
    if (!user) return [];

    const q = query(
      collection(db, 'workouts'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc'),
      limit(limitCount)
    );
    
    try {
      const snap = await getDocs(q);
      const workouts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Workout));
      return workouts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, limitCount);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'workouts');
      return [];
    }
  }
};
