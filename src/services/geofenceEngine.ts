/**
 * GeofenceEngine - Core Location Validation Engine
 * 
 * Rules enforced:
 * 1. Location acquisition must be fresh (maximumAge: 0, enableHighAccuracy: true, timeout: 15000).
 * 2. GPS accuracy must be <= 30 meters. Any accuracy > 30 meters is rejected.
 * 3. Distance calculated strictly using Haversine formula (Earth radius = 6,371,000 m).
 * 4. Maximum geofence radius = 80 meters. No tolerance subtraction or distance discounting allowed.
 * 5. Complete sanitization of coordinates (null, NaN, Infinity, strings, out-of-range lat [-90, 90] and lng [-180, 180], zero-zero).
 * 6. Explicit rejection for mock location (isMock = true) or cached location.
 * 7. Structured mandatory audit log trace generation.
 */

export interface GymLocationData {
  id?: string;
  name: string;
  latitude: number | string | null | undefined;
  longitude: number | string | null | undefined;
}

export interface UserLocationReading {
  latitude: number | string | null | undefined;
  longitude: number | string | null | undefined;
  accuracy: number | string | null | undefined;
  timestamp?: number | string | null;
  isMock?: boolean | null;
  isCached?: boolean | null;
}

export interface GeofenceAuditLog {
  timestamp: string;
  gym: {
    name: string;
    latitude: number | null;
    longitude: number | null;
  };
  user: {
    latitude: number | null;
    longitude: number | null;
  };
  gps: {
    accuracy: number | null;
    timestamp: string;
    source: string;
    isMock: boolean;
    isCached: boolean;
  };
  calculation: {
    distanceMeters: number | null;
    maxAllowedRadiusMeters: number;
    maxAllowedAccuracyMeters: number;
  };
  result: 'APROVADO' | 'REPROVADO';
  status: 'eligible' | 'confirmed' | 'blocked_out_of_range' | 'blocked_low_accuracy' | 'blocked_invalid_coords' | 'blocked_mock_location' | 'blocked_cached_location' | 'blocked_no_permission';
  reason: string;
}

export interface GeofenceValidationOutput {
  approved: boolean;
  status: 'eligible' | 'confirmed' | 'blocked_out_of_range' | 'blocked_low_accuracy' | 'blocked_invalid_coords' | 'blocked_mock_location' | 'blocked_cached_location' | 'blocked_no_permission';
  distanceMeters: number | null;
  gpsAccuracy: number | null;
  reason: string;
  userFacingMessage: string;
  auditLog: GeofenceAuditLog;
}

// Strictly 80 meters as specified in requirement
export const MAX_GEOFENCE_RADIUS_METERS = 80;
// Strictly 30 meters as specified in requirement
export const MAX_GPS_ACCURACY_METERS = 30;

/**
 * Calculates Haversine distance in meters between two lat/lng points
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's mean radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Checks if a value is a valid, finite number
 */
function isFiniteNumber(val: any): val is number {
  if (val === null || val === undefined || val === '') return false;
  const num = Number(val);
  return typeof num === 'number' && !isNaN(num) && isFinite(num);
}

/**
 * Validates coordinate pair
 */
export function isValidCoordinate(lat: any, lng: any): { valid: boolean; latNum: number; lngNum: number; reason?: string } {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    return { valid: false, latNum: NaN, lngNum: NaN, reason: 'Coordenadas com valores nulos, indefinidos, NaN ou não-numéricos.' };
  }

  const latNum = Number(lat);
  const lngNum = Number(lng);

  if (latNum < -90 || latNum > 90) {
    return { valid: false, latNum, lngNum, reason: `Latitude fora do intervalo permitido [-90, 90]: ${latNum}` };
  }

  if (lngNum < -180 || lngNum > 180) {
    return { valid: false, latNum, lngNum, reason: `Longitude fora do intervalo permitido [-180, 180]: ${lngNum}` };
  }

  if (latNum === 0 && lngNum === 0) {
    return { valid: false, latNum, lngNum, reason: 'Coordenadas genéricas nulas (0, 0) rejeitadas.' };
  }

  return { valid: true, latNum, lngNum };
}

/**
 * Core Geofence Validation Function
 */
export function validateGeofenceCheckin(
  gym: GymLocationData | null | undefined,
  userReading: UserLocationReading | null | undefined,
  customRadiusMeters: number = MAX_GEOFENCE_RADIUS_METERS,
  customMaxAccuracyMeters: number = MAX_GPS_ACCURACY_METERS
): GeofenceValidationOutput {
  const timestamp = new Date().toISOString();

  // Helper to build standardized audit output
  const buildResult = (
    approved: boolean,
    status: GeofenceValidationOutput['status'],
    reason: string,
    userFacingMessage: string,
    distanceMeters: number | null,
    accuracy: number | null,
    gymLat: number | null,
    gymLng: number | null,
    userLat: number | null,
    userLng: number | null,
    isMock = false,
    isCached = false
  ): GeofenceValidationOutput => {
    const auditLog: GeofenceAuditLog = {
      timestamp,
      gym: {
        name: gym?.name || 'Academia Não Identificada',
        latitude: gymLat,
        longitude: gymLng
      },
      user: {
        latitude: userLat,
        longitude: userLng
      },
      gps: {
        accuracy,
        timestamp: userReading?.timestamp ? String(userReading.timestamp) : timestamp,
        source: 'device_gps',
        isMock,
        isCached
      },
      calculation: {
        distanceMeters: distanceMeters !== null ? Number(distanceMeters.toFixed(2)) : null,
        maxAllowedRadiusMeters: customRadiusMeters,
        maxAllowedAccuracyMeters: customMaxAccuracyMeters
      },
      result: approved ? 'APROVADO' : 'REPROVADO',
      status,
      reason
    };

    // Mandatory Audit Console Log
    console.log(`
================ CHECK-IN GEOFENCE AUDIT LOG ================
Timestamp: ${timestamp}
Academia: ${auditLog.gym.name} (Lat: ${auditLog.gym.latitude}, Lng: ${auditLog.gym.longitude})
Usuário: (Lat: ${auditLog.user.latitude}, Lng: ${auditLog.user.longitude})
GPS: Precisão: ${auditLog.gps.accuracy}m | Mock: ${auditLog.gps.isMock} | Cache: ${auditLog.gps.isCached}
Cálculo: Distância: ${auditLog.calculation.distanceMeters}m | Raio Max: ${auditLog.calculation.maxAllowedRadiusMeters}m | Precisão Max: ${auditLog.calculation.maxAllowedAccuracyMeters}m
Resultado: [ ${auditLog.result} ]
Status: ${status}
Motivo: ${reason}
==============================================================
    `.trim());

    return {
      approved,
      status,
      distanceMeters: distanceMeters !== null ? Number(distanceMeters.toFixed(1)) : null,
      gpsAccuracy: accuracy,
      reason,
      userFacingMessage,
      auditLog
    };
  };

  // 1. Check user reading presence
  if (!userReading) {
    return buildResult(
      false,
      'blocked_no_permission',
      'Leitura de GPS ausente ou permissão de localização negada.',
      '📍 Ative a localização com alta precisão no seu dispositivo para realizar o check-in.',
      null, null, null, null, null, null
    );
  }

  // 2. Check for mock / simulated location
  if (userReading.isMock === true) {
    return buildResult(
      false,
      'blocked_mock_location',
      'Uso de localização simulada (Mock Location/GPS Falso) detectado.',
      '📍 Para validar seu treino presencial, utilize a localização real do seu aparelho celular.',
      null, null, null, null, null, null, true, false
    );
  }

  // 3. Check for cached location
  if (userReading.isCached === true) {
    return buildResult(
      false,
      'blocked_cached_location',
      'Localização em cache rejeitada. O check-in requer leitura de GPS em tempo real.',
      '📍 Seu sinal de localização precisa ser atualizado. Por favor, aguarde alguns segundos com o GPS ligado e tente novamente.',
      null, null, null, null, null, null, false, true
    );
  }

  // 4. Validate GPS accuracy (Requirement: accuracy <= 30m)
  if (!isFiniteNumber(userReading.accuracy)) {
    return buildResult(
      false,
      'blocked_low_accuracy',
      'Valor de precisão do GPS inválido ou não informado.',
      '📍 Não conseguimos confirmar sua localização exata no momento. Verifique se o GPS está ligado e tente novamente.',
      null, null, null, null, null, null
    );
  }

  const accuracy = Number(userReading.accuracy);
  if (accuracy > customMaxAccuracyMeters) {
    return buildResult(
      false,
      'blocked_low_accuracy',
      `Precisão do GPS insuficiente (${accuracy.toFixed(1)} m). Máximo permitido: ${customMaxAccuracyMeters} m.`,
      `📍 Seu sinal de localização está instável. Vá para um local mais aberto e aguarde alguns instantes para confirmar sua presença.`,
      null, accuracy, null, null, null, null
    );
  }

  // 5. Validate User Coordinates
  const userCoordVal = isValidCoordinate(userReading.latitude, userReading.longitude);
  if (!userCoordVal.valid) {
    return buildResult(
      false,
      'blocked_invalid_coords',
      `Coordenadas do usuário inválidas: ${userCoordVal.reason}`,
      '📍 Não conseguimos identificar sua localização. Por favor, certifique-se de que o serviço de localização está ativo.',
      null, accuracy, null, null, null, null
    );
  }

  // 6. Validate Gym Data & Coordinates
  if (!gym) {
    return buildResult(
      false,
      'blocked_invalid_coords',
      'Dados da academia não cadastrados ou ausentes.',
      '📍 Nenhuma academia selecionada. Selecione sua academia no menu "Academia" para validar seus treinos.',
      null, accuracy, null, null, userCoordVal.latNum, userCoordVal.lngNum
    );
  }

  const gymCoordVal = isValidCoordinate(gym.latitude, gym.longitude);
  if (!gymCoordVal.valid) {
    return buildResult(
      false,
      'blocked_invalid_coords',
      `Coordenadas da academia inválidas: ${gymCoordVal.reason}`,
      '📍 A academia selecionada precisa ter o endereço confirmado no mapa. Acesse o menu "Academia" para atualizar.',
      null, accuracy, null, null, userCoordVal.latNum, userCoordVal.lngNum
    );
  }

  // 7. Calculate Haversine Distance (Strictly without accuracy subtraction or simple approximations)
  const distanceMeters = calculateHaversineDistanceMeters(
    userCoordVal.latNum,
    userCoordVal.lngNum,
    gymCoordVal.latNum,
    gymCoordVal.lngNum
  );

  // 8. Validate Radius (Requirement: distance <= 80m)
  if (distanceMeters > customRadiusMeters) {
    const formattedDist = distanceMeters >= 1000 
      ? `${(distanceMeters / 1000).toFixed(1)} km` 
      : `${Math.round(distanceMeters)} metros`;

    return buildResult(
      false,
      'blocked_out_of_range',
      `Distância calculada (${distanceMeters.toFixed(1)} m) excede o raio máximo da geofence (${customRadiusMeters} m).`,
      `📍 Você está a ${formattedDist} da sua academia ("${gym.name}"). Aproxime-se do local para iniciar e validar seu treino.`,
      distanceMeters,
      accuracy,
      gymCoordVal.latNum,
      gymCoordVal.lngNum,
      userCoordVal.latNum,
      userCoordVal.lngNum
    );
  }

  // 9. All conditions passed! APPROVED!
  return buildResult(
    true,
    'eligible',
    `Check-in aprovado: Usuário a ${distanceMeters.toFixed(1)}m da academia (raio <= ${customRadiusMeters}m) com GPS de alta precisão (${accuracy.toFixed(1)}m).`,
    `📍 Você está na academia! Toque no botão abaixo para confirmar seu check-in.`,
    distanceMeters,
    accuracy,
    gymCoordVal.latNum,
    gymCoordVal.lngNum,
    userCoordVal.latNum,
    userCoordVal.lngNum
  );
}
