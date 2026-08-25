import { resolveModality } from './modality-config.js';

export interface GpsEngineReport {
  isValid: boolean;
  isMockLocation: boolean;
  isFrozenGps: boolean;
  hasTeleportation: boolean;
  hasExcessiveSpeed: boolean;
  hasInsufficientSamples: boolean;
  avgAccuracyMeters: number;
  maxSpeedKmH: number;
  gymGeofenceVerified: boolean;
  threats: string[];
}

export class GpsEngine {
  /**
   * GPS Engine: Anti-spoofing and spatial validity analysis.
   */
  static evaluate(activity: any): GpsEngineReport {
    const threats: string[] = [];
    const checkpoints = activity.checkpoints || activity.gpsTrack || [];
    const accuracy = Number(activity.gpsAccuracy || activity.accuracy || 10);
    const activityType = (activity.activityType || activity.type || 'GYM').toString().toUpperCase();
    const cardioType = (activity.cardioType || '').toString().toUpperCase();

    // 1. Mock Location Check
    const isMockLocation = Boolean(
      activity.isMockLocation ||
      activity.locationMocked ||
      (checkpoints.length > 0 && checkpoints.some((c: any) => c.isMocked || c.isMockLocation))
    );
    if (isMockLocation) {
      threats.push('MOCK_LOCATION_FLAGGED');
    }

    // 2. Frozen GPS Check
    let isFrozenGps = false;
    if (checkpoints.length >= 5) {
      const firstLat = checkpoints[0].latitude;
      const firstLng = checkpoints[0].longitude;
      const allIdentical = checkpoints.every((c: any) =>
        Math.abs(c.latitude - firstLat) < 0.000001 && Math.abs(c.longitude - firstLng) < 0.000001
      );
      if (allIdentical) {
        isFrozenGps = true;
        threats.push('FROZEN_GPS_COORDINATES');
      }
    }

    // 3. Teleportation & Speed Calculation
    let hasTeleportation = false;
    let hasExcessiveSpeed = false;
    let maxSpeedKmH = 0;

    if (checkpoints.length > 1) {
      for (let i = 1; i < checkpoints.length; i++) {
        const p1 = checkpoints[i - 1];
        const p2 = checkpoints[i];
        if (p1.latitude && p1.longitude && p2.latitude && p2.longitude && p1.timestamp && p2.timestamp) {
          const distMeters = GpsEngine.haversineMeters(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
          const timeSec = Math.abs((new Date(p2.timestamp).getTime() - new Date(p1.timestamp).getTime()) / 1000);

          if (timeSec > 0) {
            const speedKmH = (distMeters / timeSec) * 3.6;
            if (speedKmH > maxSpeedKmH) maxSpeedKmH = speedKmH;

            // Teleportation: > 120 km/h for running/walking, or > 250 km/h overall
            if (speedKmH > 250 || (['RUNNING', 'WALKING'].includes(activityType) && speedKmH > 100)) {
              hasTeleportation = true;
            }
          }
        }
      }
    }

    if (hasTeleportation) {
      threats.push('IMPOSSIBLE_LOCATION_TELEPORT');
    }

    // 3. Teleportation & Speed Calculation
    const modality = resolveModality(activity);
    let maxAllowedSpeed = 15; // default walking
    if (modality?.maxSpeedKmH) {
      maxAllowedSpeed = modality.maxSpeedKmH;
    } else if (activityType === 'CYCLING' || cardioType.includes('BIKE')) {
      maxAllowedSpeed = 80;
    } else if (activityType === 'RUNNING') {
      maxAllowedSpeed = 30;
    }

    if (maxSpeedKmH > maxAllowedSpeed && maxSpeedKmH < 250) {
      hasExcessiveSpeed = true;
      threats.push(`EXCESSIVE_SPEED_FOR_ACTIVITY (${Math.round(maxSpeedKmH)} km/h vs max ${maxAllowedSpeed} km/h)`);
    }

    // 4. Gym Geofence / Location Persistence
    let gymGeofenceVerified = false;
    if (activity.gymLocation && activity.latitude && activity.longitude) {
      const distToGym = GpsEngine.haversineMeters(
        activity.latitude, activity.longitude,
        activity.gymLocation.latitude, activity.gymLocation.longitude
      );
      gymGeofenceVerified = distToGym <= 200; // Within 200 meters of registered gym
      if (!gymGeofenceVerified) {
        threats.push(`GYM_GEOFENCE_MISMATCH (${Math.round(distToGym)}m from gym)`);
      }
    }

    // 5. Insufficient GPS Samples (fail-closed)
    const requiresGpsDistance = modality ? modality.requiresGps : (
      activity.requiresGpsDistance === true ||
      ['RUNNING', 'WALKING', 'CYCLING'].includes(activityType) ||
      ['RUNNING', 'WALKING', 'BIKE'].includes(cardioType)
    );
    let hasInsufficientSamples = false;
    if (requiresGpsDistance && checkpoints.length < 3) {
      hasInsufficientSamples = true;
      threats.push('INSUFFICIENT_GPS_CHECKPOINTS');
    }

    const isValid = !isMockLocation && !isFrozenGps && !hasTeleportation && !hasInsufficientSamples;

    return {
      isValid,
      isMockLocation,
      isFrozenGps,
      hasTeleportation,
      hasExcessiveSpeed,
      hasInsufficientSamples,
      avgAccuracyMeters: accuracy,
      maxSpeedKmH,
      gymGeofenceVerified,
      threats
    };
  }

  private static haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }
}
