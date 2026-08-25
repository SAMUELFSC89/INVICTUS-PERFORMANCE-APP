import { getDistance } from 'geolib';
import { fraudLogger, FraudLogger } from '../logger.js';

interface GPSPoint {
  lat?: number;
  latitude?: number;
  lng?: number;
  longitude?: number;
  timestamp: number | string;
}

interface NormalizedGPSPoint {
  lat: number;
  lng: number;
  timestamp: number;
}

interface GPSValidationResult {
  isValid: boolean;
  fraudScore: number;
  flags: string[];
  details: {
    speedViolation?: boolean;
    impossibleTeleport?: boolean;
    stationaryFrequency?: boolean;
    precisionAnomaly?: boolean;
  };
}

export class GPSValidator {
  private static normalizeCoordinates(coordinates: GPSPoint[]): NormalizedGPSPoint[] {
    return coordinates.map(c => {
      const lat = typeof c.lat === 'number' ? c.lat : (typeof c.latitude === 'number' ? c.latitude : 0);
      const lng = typeof c.lng === 'number' ? c.lng : (typeof c.longitude === 'number' ? c.longitude : 0);
      let ts = typeof c.timestamp === 'number' ? c.timestamp : new Date(c.timestamp).getTime();
      if (typeof ts !== 'number' || isNaN(ts)) ts = Date.now();
      return { lat, lng, timestamp: ts };
    });
  }

  /**
   * Valida uma atividade GPS completa
   */
  static validateActivity(
    userId: string,
    coordinates: GPSPoint[],
    distance: number,
    duration: number
  ): GPSValidationResult {
    if (!coordinates || coordinates.length < 2) {
      return { isValid: true, fraudScore: 0, flags: [], details: {} };
    }

    const normCoords = this.normalizeCoordinates(coordinates);

    const result: GPSValidationResult = {
      isValid: true,
      fraudScore: 0,
      flags: [],
      details: {}
    };

    // 1. Checar velocidade impossível
    const speedCheck = this.checkImpossibleSpeed(normCoords);
    if (speedCheck.fraud) {
      result.fraudScore += 40;
      result.flags.push('IMPOSSIBLE_SPEED');
      result.details.speedViolation = true;
      FraudLogger.logSuspiciousActivity(userId, 'Impossible speed detected', 0.4, speedCheck);
    }

    // 2. Checar teleporte (saltos geográficos)
    const teleportCheck = this.checkTeleportation(normCoords);
    if (teleportCheck.fraud) {
      result.fraudScore += 35;
      result.flags.push('TELEPORTATION');
      result.details.impossibleTeleport = true;
      FraudLogger.logSuspiciousActivity(userId, 'Geographic teleportation detected', 0.35, teleportCheck);
    }

    // 3. Checar frequência estacionária (sempre no mesmo lugar)
    const stationaryCheck = this.checkStationaryFrequency(normCoords);
    if (stationaryCheck.fraud) {
      result.fraudScore += 15;
      result.flags.push('STATIONARY_FREQUENCY');
      result.details.stationaryFrequency = true;
      FraudLogger.logSuspiciousActivity(userId, 'Stationary frequency anomaly', 0.15, stationaryCheck);
    }

    // 4. Checar precisão anômala (exatidão impossível)
    const precisionCheck = this.checkPrecisionAnomaly(normCoords);
    if (precisionCheck.fraud) {
      result.fraudScore += 20;
      result.flags.push('PRECISION_ANOMALY');
      result.details.precisionAnomaly = true;
      FraudLogger.logSuspiciousActivity(userId, 'Precision anomaly detected', 0.2, precisionCheck);
    }

    // 5. Validar distância vs coordenadas
    const calculatedDistance = this.calculateDistanceFromCoordinates(normCoords);
    if (distance > 0) {
      const absDiff = Math.abs(calculatedDistance - distance);
      const distanceDifference = absDiff / distance;
      if (distanceDifference > 0.4 && absDiff > 0.3) {
        result.fraudScore += 25;
        result.flags.push('DISTANCE_MISMATCH');
        fraudLogger.warn({
          userId,
          reportedDistance: distance,
          calculatedDistance: Math.round(calculatedDistance * 100) / 100,
          difference: (distanceDifference * 100).toFixed(1)
        }, 'Distance mismatch detected');
      }
    }

    result.isValid = result.fraudScore < 50;

    return result;
  }

  /**
   * Detectar velocidade impossível (> 200 km/h)
   */
  private static checkImpossibleSpeed(coordinates: NormalizedGPSPoint[]): { fraud: boolean; maxSpeed: number; reason?: string } {
    const MAX_SPEED_KMH = 200; // Max reasonable speed
    let maxSpeed = 0;

    for (let i = 1; i < coordinates.length; i++) {
      const prev = coordinates[i - 1];
      const curr = coordinates[i];

      const distMeters = getDistance(
        { latitude: prev.lat, longitude: prev.lng },
        { latitude: curr.lat, longitude: curr.lng }
      );

      const timeSeconds = Math.max(Math.abs(curr.timestamp - prev.timestamp) / 1000, 0.001);
      const speedKmH = (distMeters / 1000) / (timeSeconds / 3600);

      if (speedKmH > maxSpeed) maxSpeed = speedKmH;

      if (speedKmH > MAX_SPEED_KMH) {
        return {
          fraud: true,
          maxSpeed: Math.round(speedKmH),
          reason: `Speed of ${Math.round(speedKmH)} km/h is impossible for running/cycling`
        };
      }
    }

    return { fraud: false, maxSpeed: Math.round(maxSpeed) };
  }

  /**
   * Detectar teleportação geográfica
   */
  private static checkTeleportation(coordinates: NormalizedGPSPoint[]): { fraud: boolean; maxDistance?: number; timeGap?: number } {
    const MAX_DISTANCE_M = 5000; // Max 5km jump
    const MIN_TIME_S = 300; // Min 5 minutes between jumps

    for (let i = 1; i < coordinates.length; i++) {
      const prev = coordinates[i - 1];
      const curr = coordinates[i];

      const distMeters = getDistance(
        { latitude: prev.lat, longitude: prev.lng },
        { latitude: curr.lat, longitude: curr.lng }
      );

      const timeSeconds = Math.abs(curr.timestamp - prev.timestamp) / 1000;

      if (distMeters > MAX_DISTANCE_M && timeSeconds < MIN_TIME_S) {
        return {
          fraud: true,
          maxDistance: Math.round(distMeters),
          timeGap: Math.round(timeSeconds)
        };
      }
    }

    return { fraud: false };
  }

  /**
   * Detectar frequência estacionária (muitos pontos no mesmo local)
   */
  private static checkStationaryFrequency(coordinates: NormalizedGPSPoint[]): { fraud: boolean; stationaryPercentage?: number } {
    const STATIONARY_RADIUS_M = 50; // 50 metros
    let stationaryCount = 0;

    if (coordinates.length < 3) return { fraud: false };

    const centerpoint = coordinates[Math.floor(coordinates.length / 2)];

    for (const coord of coordinates) {
      const distMeters = getDistance(
        { latitude: centerpoint.lat, longitude: centerpoint.lng },
        { latitude: coord.lat, longitude: coord.lng }
      );

      if (distMeters < STATIONARY_RADIUS_M) {
        stationaryCount++;
      }
    }

    const stationaryPercentage = (stationaryCount / coordinates.length) * 100;

    if (stationaryPercentage > 70) { // 70% no mesmo lugar = suspeito
      return { fraud: true, stationaryPercentage: Math.round(stationaryPercentage) };
    }

    return { fraud: false };
  }

  /**
   * Detectar precisão anômala (decimal places impossíveis)
   */
  private static checkPrecisionAnomaly(coordinates: NormalizedGPSPoint[]): { fraud: boolean; reason?: string } {
    for (const coord of coordinates) {
      const latStr = coord.lat.toString();
      const lngStr = coord.lng.toString();

      const latDecimals = (latStr.split('.')[1] || '').length;
      const lngDecimals = (lngStr.split('.')[1] || '').length;

      if (latDecimals > 8 || lngDecimals > 8) {
        return { fraud: true, reason: 'Coordinates have impossible precision' };
      }
    }

    return { fraud: false };
  }

  /**
   * Calcular distância a partir de coordenadas em km
   */
  private static calculateDistanceFromCoordinates(coordinates: NormalizedGPSPoint[]): number {
    let totalDistanceMeters = 0;

    for (let i = 1; i < coordinates.length; i++) {
      const prev = coordinates[i - 1];
      const curr = coordinates[i];

      const distMeters = getDistance(
        { latitude: prev.lat, longitude: prev.lng },
        { latitude: curr.lat, longitude: curr.lng }
      );

      totalDistanceMeters += distMeters;
    }

    return totalDistanceMeters / 1000; // Retornar em km
  }
}
