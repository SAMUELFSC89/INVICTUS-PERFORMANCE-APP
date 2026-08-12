import { AthleteDnaProfile } from './types.js';
import { db } from '../common.js';

export class AthleteProfileEngine {
  static async analyzeAndUpdateProfile(userId: string, history: any[]): Promise<AthleteDnaProfile> {
    const workoutsCount = history.length;
    
    // Default / baseline profile if insufficient history
    let timeWindowsCount = { MORNING: 0, AFTERNOON: 0, EVENING: 0, NIGHT: 0 };
    let totalIntensity = 0;
    let totalActiveMins = 0;
    let totalIdleMins = 0;
    let totalEfficiency = 0;

    const dayCounts: Record<string, number> = {
      Segunda: 0, Terça: 0, Quarta: 0, Quinta: 0, Sexta: 0, Sábado: 0, Domingo: 0
    };

    history.forEach(item => {
      const date = item.createdAt ? new Date(item.createdAt) : new Date();
      const hour = date.getHours();
      if (hour >= 5 && hour < 12) timeWindowsCount.MORNING++;
      else if (hour >= 12 && hour < 17) timeWindowsCount.AFTERNOON++;
      else if (hour >= 17 && hour < 22) timeWindowsCount.EVENING++;
      else timeWindowsCount.NIGHT++;

      const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
      const dayName = dayNames[date.getDay()];
      if (dayCounts[dayName] !== undefined) dayCounts[dayName]++;

      const quality = item.qualityMetrics || item.breakdown || {};
      totalIntensity += quality.intensity?.score || item.qualityScore || 80;
      totalActiveMins += quality.efficiency?.activeTimeMins || 45;
      totalIdleMins += quality.efficiency?.idleTimeMins || 10;
      totalEfficiency += quality.efficiency?.score || 82;
    });

    const divisor = Math.max(1, workoutsCount);
    const avgIntensityPct = Math.round(totalIntensity / divisor);
    const avgActiveTimeMins = Math.round(totalActiveMins / divisor);
    const avgIdleTimeMins = Math.round(totalIdleMins / divisor);
    const avgEfficiencyPct = Math.round(totalEfficiency / divisor);

    // Find best time window
    let bestWindow: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT' = 'MORNING';
    let maxWins = -1;
    (Object.keys(timeWindowsCount) as Array<keyof typeof timeWindowsCount>).forEach(w => {
      if (timeWindowsCount[w] > maxWins) {
        maxWins = timeWindowsCount[w];
        bestWindow = w;
      }
    });

    const labelsMap = {
      MORNING: 'Manhã (06h - 11h)',
      AFTERNOON: 'Tarde (12h - 16h)',
      EVENING: 'Noite (17h - 21h)',
      NIGHT: 'Madrugada / Horário Alternativo'
    };

    // Find top 2 best days
    const sortedDays = Object.entries(dayCounts).sort((a, b) => b[1] - a[1]);
    const bestDaysOfWeek = sortedDays.slice(0, 2).map(d => d[0]);

    const profile: AthleteDnaProfile = {
      userId,
      totalWorkoutsAnalyzed: workoutsCount,
      bestWorkoutTimeWindow: bestWindow,
      bestWorkoutTimeLabel: labelsMap[bestWindow],
      avgIntensityPct,
      avgActiveTimeMins,
      avgIdleTimeMins,
      avgRecoveryHours: 24,
      bestDaysOfWeek,
      hrZoneEvolutionTrend: avgIntensityPct >= 80 ? 'IMPROVING' : 'STABLE',
      avgEfficiencyPct,
      lastUpdated: new Date().toISOString()
    };

    // Persist profile asynchronously in Firestore
    try {
      if (userId && userId !== 'ANONYMOUS') {
        await db.collection('athlete_profiles').doc(userId).set(profile, { merge: true });
      }
    } catch (err) {
      console.warn(`[ATHLETE PROFILE] Failed to save profile for ${userId}`, err);
    }

    return profile;
  }
}
