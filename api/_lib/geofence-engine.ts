/**
 * GeofenceEngine - Core Location Validation Engine (Backend Server Version)
 * 
 * Enforces:
 * 1. High-accuracy GPS requirement (accuracy <= 30m).
 * 2. Strict Haversine distance calculation (Earth radius = 6,371,000 m).
 * 3. Maximum geofence radius = 80 meters. No tolerance subtraction.
 * 4. Sanitization of all coordinate inputs (null, NaN, Infinity, strings, out-of-range, (0,0)).
 * 5. Mock location / cached location rejections.
 * 6. Mandatory audit trail logs.
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

export const MAX_GEOFENCE_RADIUS_METERS = 80;
export const MAX_GPS_ACCURACY_METERS = 30;

export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
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

function isFiniteNumber(val: any): val is number {
  if (val === null || val === undefined || val === '') return false;
  const num = Number(val);
  return typeof num === 'number' && !isNaN(num) && isFinite(num);
}

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

export function validateGeofenceCheckin(
  gym: GymLocationData | null | undefined,
  userReading: UserLocationReading | null | undefined,
  customRadiusMeters: number = MAX_GEOFENCE_RADIUS_METERS,
  customMaxAccuracyMeters: number = MAX_GPS_ACCURACY_METERS
): GeofenceValidationOutput {
  const timestamp = new Date().toISOString();

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

  if (!userReading) {
    return buildResult(
      false,
      'blocked_no_permission',
      'Leitura de GPS ausente ou permissão de localização negada.',
      '📍 Ative a localização com alta precisão no seu dispositivo para realizar o check-in.',
      null, null, null, null, null, null
    );
  }

  if (userReading.isMock === true) {
    return buildResult(
      false,
      'blocked_mock_location',
      'Uso de localização simulada (Mock Location/GPS Falso) detectado.',
      '🚫 Acesso bloqueado: Localização simulada detectada pelo sistema antifraude.',
      null, null, null, null, null, null, true, false
    );
  }

  if (userReading.isCached === true) {
    return buildResult(
      false,
      'blocked_cached_location',
      'Localização em cache rejeitada. O check-in requer leitura de GPS em tempo real.',
      '📍 Sinal de GPS desatualizado. Aguarde alguns segundos para atualizar sua posição em tempo real.',
      null, null, null, null, null, null, false, true
    );
  }

  if (!isFiniteNumber(userReading.accuracy)) {
    return buildResult(
      false,
      'blocked_low_accuracy',
      'Valor de precisão do GPS inválido ou não informado.',
      '📍 Não foi possível validar a precisão do seu GPS. Aguarde um sinal estável e tente novamente.',
      null, null, null, null, null, null
    );
  }

  const accuracy = Number(userReading.accuracy);
  if (accuracy > customMaxAccuracyMeters) {
    return buildResult(
      false,
      'blocked_low_accuracy',
      `Precisão do GPS insuficiente (${accuracy.toFixed(1)} m). Máximo permitido: ${customMaxAccuracyMeters} m.`,
      `📍 Seu sinal de GPS está com precisão de ${Math.round(accuracy)}m (o limite de segurança é 30m). Vá para uma área aberta e aguarde alguns segundos.`,
      null, accuracy, null, null, null, null
    );
  }

  const userCoordVal = isValidCoordinate(userReading.latitude, userReading.longitude);
  if (!userCoordVal.valid) {
    return buildResult(
      false,
      'blocked_invalid_coords',
      `Coordenadas do usuário inválidas: ${userCoordVal.reason}`,
      '📍 Posição do usuário inválida ou não identificada.',
      null, accuracy, null, null, null, null
    );
  }

  if (!gym) {
    return buildResult(
      false,
      'blocked_invalid_coords',
      'Dados da academia não cadastrados ou ausentes.',
      '⚠ Nenhuma academia selecionada. Vincule uma academia no menu Academia.',
      null, accuracy, null, null, userCoordVal.latNum, userCoordVal.lngNum
    );
  }

  const gymCoordVal = isValidCoordinate(gym.latitude, gym.longitude);
  if (!gymCoordVal.valid) {
    return buildResult(
      false,
      'blocked_invalid_coords',
      `Coordenadas da academia inválidas: ${gymCoordVal.reason}`,
      '⚠ A academia selecionada não possui localização válida no mapa. Selecione-a novamente no menu Academia.',
      null, accuracy, null, null, userCoordVal.latNum, userCoordVal.lngNum
    );
  }

  const distanceMeters = calculateHaversineDistanceMeters(
    userCoordVal.latNum,
    userCoordVal.lngNum,
    gymCoordVal.latNum,
    gymCoordVal.lngNum
  );

  if (distanceMeters > customRadiusMeters) {
    const formattedDist = distanceMeters >= 1000 
      ? `${(distanceMeters / 1000).toFixed(1)} km` 
      : `${Math.round(distanceMeters)} metros`;

    return buildResult(
      false,
      'blocked_out_of_range',
      `Distância calculada (${distanceMeters.toFixed(1)} m) excede o raio máximo da geofence (${customRadiusMeters} m).`,
      `📍 Você está a ${formattedDist} da sua academia ("${gym.name}"). Aproxime-se para confirmar o check-in (máximo ${customRadiusMeters} metros).`,
      distanceMeters,
      accuracy,
      gymCoordVal.latNum,
      gymCoordVal.lngNum,
      userCoordVal.latNum,
      userCoordVal.lngNum
    );
  }

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
