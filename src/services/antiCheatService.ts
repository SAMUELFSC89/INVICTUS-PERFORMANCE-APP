/**
 * Advanced Behavior Anti-Cheat Engine (KM Fatal Enterprise Grade)
 * Implements physiological speed checks, GPS teletransportation filters, 
 * upload fingerprinting, image duplicate checkers, and dynamic participant Trust Scores.
 */

import { ActivitySession, Workout } from '../types';
import { auth, db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface TrustMetrics {
  trustScore: number; // 0 to 100
  lastAssessment: string;
  flagsCount: number;
  unusualSpeedChecks: number;
  duplicateImageChecks: number;
}

// No in-memory cache is used anymore, replaced by global persistent Firestore storage ('photo_fingerprints' collection)
export const antiCheatService = {
  /**
   * Generates a rapid lightweight fingerprint of an image to prevent reuse
   */
  generateFingerprint(base64Image: string): string {
    if (!base64Image) return '';
    // Extract head, tail, and central pixels to create a robust structural fingerprint (pHash style)
    const length = base64Image.length;
    const sampleSize = 100;
    if (length < sampleSize * 3) return base64Image;

    const prefix = base64Image.slice(50, 50 + sampleSize);
    const middle = base64Image.slice(Math.floor(length / 2), Math.floor(length / 2) + sampleSize);
    const suffix = base64Image.slice(length - 50 - sampleSize, length - 50);

    // Dynamic numeric hashing of chunks
    let score = 0;
    const combined = prefix + middle + suffix;
    for (let i = 0; i < combined.length; i++) {
      score = (score << 5) - score + combined.charCodeAt(i);
      score |= 0;
    }
    return `fp_${score.toString(16)}_${length}`;
  },

  /**
   * Registers and checks image fingerprint uniqueness
   * Returns true if image is unique, false if it's a clone (fraud alert)
   */
  async checkAndRegisterPhotoUniqueness(base64Image: string): Promise<boolean> {
    if (!base64Image) return true;
    const fingerprint = this.generateFingerprint(base64Image);
    const user = auth.currentUser;
    const userId = user ? user.uid : 'anonymous';

    try {
      const fpRef = doc(db, 'photo_fingerprints', fingerprint);
      const fpSnap = await getDoc(fpRef);
      if (fpSnap.exists()) {
        console.warn(`[Anti-Cheat Photo Guard] DUPLICATE upload detected! Fingerprint: ${fingerprint}`);
        return false;
      }
      
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days TTL

      await setDoc(fpRef, {
        fingerprint,
        userId,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        ttl: Math.floor(expiresAt.getTime() / 1000) // Firestore TTL index compatible
      });
      return true;
    } catch (err) {
      console.error('[Anti-Cheat Photo Guard] Failed to check photo uniqueness, default to trust:', err);
      return true;
    }
  },

  /**
   * Estimates humanoid physiological correctness of GPS activities
   */
  analyzeGPSMotion(session: ActivitySession): { 
    isValid: boolean; 
    suspicionScore: number; 
    reason?: string;
    details?: any;
  } {
    const checkpoints = session.checkpoints || [];
    if (checkpoints.length < 2) {
      return { isValid: true, suspicionScore: 0 };
    }

    let totalCalculatedDistance = 0;
    let impossibleTransitions = 0;
    let maxInstantanousSpeed = 0;
    let stationaryCount = 0;

    for (let i = 1; i < checkpoints.length; i++) {
      const p1 = checkpoints[i - 1];
      const p2 = checkpoints[i];

      const t1 = new Date(p1.timestamp).getTime();
      const t2 = new Date(p2.timestamp).getTime();
      let dtSeconds = (t2 - t1) / 1000;

      if (dtSeconds <= 0) continue;

      // Ensure a minimum 2-second interval to avoid near-zero division, infinite speeds, 
      // and false positives when GPS coordinates log rapidly.
      if (dtSeconds < 2) {
        dtSeconds = 2;
      }

      // Distance in km
      const dist = this.haversineDistance(p1.location.lat, p1.location.lng, p2.location.lat, p2.location.lng);
      totalCalculatedDistance += dist;

      // Current velocity (m/s)
      const velocityMs = (dist * 1000) / dtSeconds;
      const velocityKmh = velocityMs * 3.6;

      if (velocityKmh > maxInstantanousSpeed) {
        maxInstantanousSpeed = velocityKmh;
      }

      // Humans running cannot exceed ~35 km/h (Physiologically impossible long term)
      if (velocityKmh > 35) {
        impossibleTransitions++;
      }

      // Check if speed is 0 for abnormally long active periods
      if (velocityKmh < 0.2) {
        stationaryCount++;
      }
    }

    // Suspect Scoring logic
    let score = 0;
    const reasons: string[] = [];

    if (maxInstantanousSpeed > 45) {
      score += 60;
      reasons.push(`Velocidade instantânea impossível (${Math.round(maxInstantanousSpeed)} km/h).`);
    }

    if (impossibleTransitions > 0) {
      score += 40 * impossibleTransitions;
      reasons.push(`Detecção de teletransporte ou aceleração veicular.`);
    }

    // High fidelity analysis
    const isMockAltitudeOrGPSRatio = checkpoints.some(c => c.location.accuracy && c.location.accuracy < 1);
    if (isMockAltitudeOrGPSRatio) {
      score += 30;
      reasons.push(`Precisão de GPS perfeitamente simétrica (possível Mock Location).`);
    }

    return {
      isValid: score < 70,
      suspicionScore: Math.min(100, score),
      reason: reasons.join(' | '),
      details: {
        totalCalculatedDistance,
        maxSpeed: maxInstantanousSpeed,
        teleportPoints: impossibleTransitions,
        stationaryRatio: stationaryCount / checkpoints.length
      }
    };
  },

  /**
   * Helper Haversine calculation
   */
  haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  /**
   * Calculates a User Trust Score dynamically based on validation histories
   */
  calculateUserTrustScore(history: Workout[]): TrustMetrics {
    let trustScore = 100;
    let flagsCount = 0;
    let unusualSpeedChecks = 0;
    let duplicateImageChecks = 0;

    for (const workout of history) {
      // Analyze current status
      if (workout.status === 'invalid') {
        trustScore -= 20;
        flagsCount++;
      } else if (workout.status === 'suspicious') {
        trustScore -= 10;
        flagsCount += 0.5;
      }

      // Check speed checks
      if (workout.validation?.details?.movementPattern === 'vehicle') {
        unusualSpeedChecks++;
      }

      // If validation indicates suspicious AI output
      if (workout.validation?.reason?.includes('IA:')) {
        trustScore -= 15;
      }
    }

    return {
      trustScore: Math.max(0, Math.min(100, Math.round(trustScore))),
      lastAssessment: new Date().toISOString(),
      flagsCount: Math.ceil(flagsCount),
      unusualSpeedChecks,
      duplicateImageChecks
    };
  }
};
