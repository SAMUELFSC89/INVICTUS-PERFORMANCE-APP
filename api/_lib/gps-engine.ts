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
  /** #98: maior velocidade entre os checkpoints (distancia/tempo) sozinha, antes de considerar a amostra instantanea do cliente -- para auditoria/depuracao. */
  maxSpeedFromCheckpointsKmH: number;
  /** #98: maior leitura instantanea (Doppler do GPS) reportada pelo cliente durante toda a sessao, se disponivel. */
  maxReportedInstantSpeedKmH: number | null;
  /** Distancia reconstruida no servidor a partir da trilha GPS aceita. */
  verifiedDistanceKm: number;
  /** Tempo efetivamente em movimento segundo os segmentos GPS aceitos. */
  movingTimeSec: number;
  averageMovingSpeedKmH: number;
  validPointCount: number;
  /** Sinal conservador de deslocamento motorizado em modalidade humana. */
  suspectedMotorizedTransport: boolean;
  hasDataGap: boolean;
  gymGeofenceVerified: boolean;
  threats: string[];
}

export class GpsEngine {
  /**
   * GPS Engine: Anti-spoofing and spatial validity analysis.
   */
  static evaluate(activity: any): GpsEngineReport {
    const threats: string[] = [];
    // #98: NORMALIZACAO DE FORMATO -- ACHADO CRITICO.
    //
    // O payload real enviado pelo cliente (activityService.ts::endSession, e
    // repassado sem transformacao por validate-activity-service.ts ate aqui)
    // grava cada checkpoint como `{ timestamp, location: { lat, lng, accuracy } }`.
    // Todo este motor, porem, sempre leu `checkpoint.latitude`/`.longitude`
    // (campos PLANOS, nomes diferentes) -- ou seja, para toda atividade real
    // processada pelo fluxo em producao, `p1.latitude` era sempre `undefined`,
    // a condicao de entrada do calculo de velocidade/teleporte e da checagem
    // de GPS congelado nunca era verdadeira, e os dois runs de checkpoints
    // efetivamente nunca eram analisados -- maxSpeedKmH (a partir de
    // checkpoints) ficava sempre 0 e isFrozenGps sempre false, silenciosamente.
    // Corrigido normalizando para o formato piano que o resto do arquivo
    // espera, aceitando os dois formatos (achatado ou aninhado em `location`)
    // para nao quebrar chamadores que ja passem o formato piano (ex: testes).
    const rawCheckpoints = activity.checkpoints || activity.gpsTrack || [];
    const checkpoints = rawCheckpoints.map((c: any) => ({
      latitude: c.latitude ?? c.location?.lat ?? c.lat,
      longitude: c.longitude ?? c.location?.lng ?? c.lng,
      timestamp: c.timestamp,
      accuracy: c.accuracy ?? c.location?.accuracy,
      isMocked: c.isMocked ?? c.location?.isMocked,
      isMockLocation: c.isMockLocation ?? c.location?.isMockLocation
    })).filter((c: any) => {
      const accuracyValue = Number(c.accuracy);
      return Number.isFinite(c.latitude) && Number.isFinite(c.longitude)
        && Math.abs(c.latitude) <= 90 && Math.abs(c.longitude) <= 180
        && Boolean(c.timestamp) && Number.isFinite(new Date(c.timestamp).getTime())
        // O Strava recomenda sinal abaixo de 30m no Android. Pontos piores
        // continuam no registro bruto, mas nao entram na distancia oficial.
        && (!Number.isFinite(accuracyValue) || accuracyValue <= 30);
    }).sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
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
    let hasDataGap = false;
    let verifiedDistanceMeters = 0;
    let movingTimeSec = 0;
    let fastBikeTimeSec = 0;
    let sustainedUrbanBikeSpeedSec = 0;
    // #237/#98: intervalo real entre checkpoints ACEITOS costuma ser maior do
    // que o passo de amostragem nominal (o cliente so grava um a cada ~10s, e
    // um ponto pode ser descartado por baixa precisao) -- 45s da folga
    // suficiente pra nao marcar sessoes normais, mas ainda pega buracos reais
    // de sinal (tunel, garagem) onde um pico de velocidade pode ter passado
    // despercebido.
    const MAX_PLAUSIBLE_GAP_SEC = 45;

    if (checkpoints.length > 1) {
      for (let i = 1; i < checkpoints.length; i++) {
        const p1 = checkpoints[i - 1];
        const p2 = checkpoints[i];
        if ([p1.latitude, p1.longitude, p2.latitude, p2.longitude].every(Number.isFinite) && p1.timestamp && p2.timestamp) {
          const distMeters = GpsEngine.haversineMeters(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
          const timeSec = Math.abs((new Date(p2.timestamp).getTime() - new Date(p1.timestamp).getTime()) / 1000);

          if (timeSec > MAX_PLAUSIBLE_GAP_SEC) {
            hasDataGap = true;
          }

          if (timeSec > 0) {
            const speedKmH = (distMeters / timeSec) * 3.6;
            if (speedKmH > maxSpeedKmH) maxSpeedKmH = speedKmH;

            // Reconstrucao pos-gravacao: o servidor, e nao o valor total
            // informado pelo aparelho, passa a ser a fonte da distancia.
            // Saltos >250 km/h sao outliers/teleporte e nao somam distancia.
            if (timeSec <= MAX_PLAUSIBLE_GAP_SEC && speedKmH <= 250) {
              const noiseFloor = Math.max(2.5, Math.min(8, ((Number(p1.accuracy) || 10) + (Number(p2.accuracy) || 10)) * 0.12));
              if (distMeters >= noiseFloor) {
                verifiedDistanceMeters += distMeters;
                const movingThresholdKmH = cardioType.includes('BIKE') ? 1.5 : 0.8;
                if (speedKmH >= movingThresholdKmH) movingTimeSec += timeSec;
                if (cardioType.includes('BIKE') && speedKmH >= 42) fastBikeTimeSec += timeSec;
                if (cardioType.includes('BIKE') && speedKmH >= 18) sustainedUrbanBikeSpeedSec += timeSec;
              }
            }

            // Teleportation: > 120 km/h for running/walking, or > 250 km/h overall
            if (speedKmH > 250 || (['RUNNING', 'WALKING'].includes(activityType) && speedKmH > 100)) {
              hasTeleportation = true;
            }
          }
        }
      }
    }

    const maxSpeedFromCheckpointsKmH = maxSpeedKmH;

    // #98: velocidade instantanea (Doppler) reportada pelo cliente durante
    // TODA a sessao -- ver activityService.recordGpsSpeedSample() e o
    // watchPosition em Challenges.tsx. Complementa o calculo por
    // distancia/tempo acima em vez de substitui-lo: aquele calculo suaviza
    // picos curtos quando os checkpoints gravados sao esparsos (throttle de
    // ~10s + descarte de pontos com baixa precisao), exatamente o cenario que
    // mascarava a velocidade real de um onibus em varios testes. So aceitamos
    // a amostra do cliente se vier com um numero minimo de leituras (evita
    // que um unico glitch pontual do chip de GPS, por multipath urbano, vire
    // sozinho o numero final) e dentro de um teto de sanidade.
    const reportedMaxSpeed = Number(activity.maxObservedSpeedKmH);
    const reportedSampleCount = Number(activity.gpsSpeedSampleCount) || 0;
    const maxReportedInstantSpeedKmH = (Number.isFinite(reportedMaxSpeed) && reportedSampleCount >= 2 && reportedMaxSpeed >= 0 && reportedMaxSpeed <= 300)
      ? reportedMaxSpeed
      : null;

    if (maxReportedInstantSpeedKmH !== null && maxReportedInstantSpeedKmH > maxSpeedKmH) {
      maxSpeedKmH = maxReportedInstantSpeedKmH;
      if (maxSpeedKmH > 250 || (['RUNNING', 'WALKING'].includes(activityType) && maxSpeedKmH > 100)) {
        hasTeleportation = true;
      }
    }

    if (hasTeleportation) {
      threats.push('IMPOSSIBLE_LOCATION_TELEPORT');
    }
    if (hasDataGap) {
      threats.push('GPS_DATA_GAP');
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

    const verifiedDistanceKm = verifiedDistanceMeters / 1000;
    const averageMovingSpeedKmH = movingTimeSec > 0
      ? verifiedDistanceKm / (movingTimeSec / 3600)
      : 0;
    // GPS sozinho nao consegue provar se uma velocidade plausivel para bike
    // veio de bicicleta ou de onibus. Em vez de aprovar no escuro, sinais de
    // velocidade motorizada levam a revisao e exigem corroboracao adicional.
    const avgHeartRate = Number(
      activity.avgHeartRate
      ?? activity.healthTelemetry?.avgHeartRate
      ?? activity.smartwatchData?.avgHeartRate
      ?? activity.smartwatchData?.heartRate
    );
    const cadence = Number(activity.cadence ?? activity.smartwatchData?.cadence);
    const powerWatts = Number(activity.powerWatts ?? activity.smartwatchData?.powerWatts);
    const hasEffortCorroboration = (
      (Number.isFinite(avgHeartRate) && avgHeartRate >= 90)
      || (Number.isFinite(cadence) && cadence >= 20)
      || (Number.isFinite(powerWatts) && powerWatts >= 50)
    );
    const moderateSpeedWithoutEffortEvidence = sustainedUrbanBikeSpeedSec >= 60
      && averageMovingSpeedKmH >= 18
      && !hasEffortCorroboration;
    const lowHeartRateAtVehicleLikeSpeed = sustainedUrbanBikeSpeedSec >= 60
      && averageMovingSpeedKmH >= 22
      && Number.isFinite(avgHeartRate)
      && avgHeartRate > 0
      && avgHeartRate < 85;
    const suspectedMotorizedTransport = modality?.antiFraudProfile === 'CYCLING' && (
      fastBikeTimeSec >= 12
      || maxSpeedKmH >= 58
      || averageMovingSpeedKmH >= 36
      || moderateSpeedWithoutEffortEvidence
      || lowHeartRateAtVehicleLikeSpeed
    );
    if (suspectedMotorizedTransport) {
      threats.push('SUSPECTED_MOTORIZED_TRANSPORT');
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
      avgAccuracyMeters: checkpoints.length
        ? checkpoints.reduce((sum: number, point: any) => sum + (Number.isFinite(Number(point.accuracy)) ? Number(point.accuracy) : accuracy), 0) / checkpoints.length
        : accuracy,
      maxSpeedKmH,
      maxSpeedFromCheckpointsKmH,
      maxReportedInstantSpeedKmH,
      verifiedDistanceKm,
      movingTimeSec,
      averageMovingSpeedKmH,
      validPointCount: checkpoints.length,
      suspectedMotorizedTransport,
      hasDataGap,
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
