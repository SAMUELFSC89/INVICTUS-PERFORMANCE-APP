import { DeviceSecurityEngine, DeviceSecurityReport } from './device-security.js';
import { GpsEngine, GpsEngineReport } from './gps-engine.js';
import { SensorEngine, SensorEngineReport } from './sensor-engine.js';
import { HealthEngine, HealthEngineReport } from './health-engine.js';
import { PhotoEngine, PhotoEngineReport } from './photo-engine.js';
import { SECURITY_CONFIG } from './security-config.js';

export interface FraudEvidence {
  code: string;
  category: 'DEVICE' | 'GPS' | 'SENSOR' | 'HEALTH' | 'PHOTO' | 'PHYSICAL_IMPOSSIBILITY' | 'REPLAY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  weightPenalty: number;
}

export interface FraudAnalysis {
  fraudDetected: boolean;
  evidences: FraudEvidence[];
  deviceReport: DeviceSecurityReport;
  gpsReport: GpsEngineReport;
  sensorReport: SensorEngineReport;
  healthReport: HealthEngineReport;
  photoReport: PhotoEngineReport;
  summary: string;
}

export class FraudEngine {
  /**
   * Fraud Engine: Searches for fraud signals across security domains.
   * Aggregates concrete evidence without blocking directly.
   */
  static analyze(activity: any, userData?: any, userHistory: any[] = []): FraudAnalysis {
    const evidences: FraudEvidence[] = [];

    // 1. Device Security Analysis
    const deviceReport = DeviceSecurityEngine.evaluate(activity.deviceInfo, activity);
    if (deviceReport.isEmulator) {
      evidences.push({
        code: 'EMULATOR_DETECTED',
        category: 'DEVICE',
        severity: 'CRITICAL',
        description: 'Atividade executada em ambiente simulado ou emulador.',
        weightPenalty: 100
      });
    }
    if (deviceReport.isHookedOrInjected) {
      evidences.push({
        code: 'HOOKING_INJECTION',
        category: 'DEVICE',
        severity: 'CRITICAL',
        description: 'Ferramenta de hooking (Frida/Xposed/Magisk) detectada.',
        weightPenalty: 100
      });
    }
    if (deviceReport.isVirtualSpace) {
      evidences.push({
        code: 'VIRTUAL_SPACE_CLONE',
        category: 'DEVICE',
        severity: 'HIGH',
        description: 'Aplicativo clonado em espaço virtual ou Lucky Patcher.',
        weightPenalty: 80
      });
    }
    if (deviceReport.isTamperedApk) {
      evidences.push({
        code: 'MODDED_APK_SIGNATURE',
        category: 'DEVICE',
        severity: 'CRITICAL',
        description: 'Assinatura digital do aplicativo inválida ou APK modificada.',
        weightPenalty: 90
      });
    }
    if (deviceReport.isRootedOrJailbroken) {
      evidences.push({
        code: 'ROOT_JAILBREAK',
        category: 'DEVICE',
        severity: 'MEDIUM',
        description: 'Acesso root ou jailbreak presente no dispositivo.',
        weightPenalty: 30
      });
    }
    if (deviceReport.attestationStatus === 'FAILED') {
      evidences.push({
        code: 'ATTESTATION_FAILED',
        category: 'DEVICE',
        severity: 'HIGH',
        description: 'Falha na validação do Play Integrity API / DeviceCheck.',
        weightPenalty: 50
      });
    }

    // 2. GPS Location Analysis
    const gpsReport = GpsEngine.evaluate(activity);
    if (gpsReport.isMockLocation) {
      evidences.push({
        code: 'MOCK_LOCATION',
        category: 'GPS',
        severity: 'HIGH',
        description: 'Sinal de localização simulada (Mock Location) ativo.',
        weightPenalty: 50
      });
    }
    if (gpsReport.hasTeleportation) {
      evidences.push({
        code: 'TELEPORTATION',
        category: 'GPS',
        severity: 'HIGH',
        description: 'Deslocamento espacial impossível entre coordenadas de GPS.',
        weightPenalty: 45
      });
    }
    if (gpsReport.isFrozenGps) {
      evidences.push({
        code: 'FROZEN_GPS',
        category: 'GPS',
        severity: 'MEDIUM',
        description: 'Coordenadas de GPS travadas ao longo de toda a atividade.',
        weightPenalty: 35
      });
    }
    if (gpsReport.hasExcessiveSpeed) {
      evidences.push({
        code: 'EXCESSIVE_SPEED',
        category: 'GPS',
        severity: 'HIGH',
        description: `Velocidade máxima de ${Math.round(gpsReport.maxSpeedKmH)} km/h incompatível com o tipo de treino.`,
        weightPenalty: 40
      });
    }
    if (gpsReport.hasInsufficientSamples) {
      evidences.push({
        code: 'INSUFFICIENT_GPS_CHECKPOINTS',
        category: 'GPS',
        severity: 'MEDIUM',
        description: 'Atividade de cardio ao ar livre sem amostras de GPS suficientes para validar o trajeto percorrido (rota real não pôde ser confirmada).',
        weightPenalty: 30
      });
    }
    // #98: gap real de sinal (>45s entre checkpoints aceitos) e sozinho um
    // sinal fraco -- perda de sinal em tunel/garagem e comum em atividades
    // legitimas -- entao entra com peso baixo, so contribuindo pro escore
    // agregado de risco em conjunto com outras evidencias, sem empurrar
    // sozinho uma atividade normal para UNDER_REVIEW/BLOCKED.
    if (gpsReport.hasDataGap) {
      evidences.push({
        code: 'GPS_DATA_GAP',
        category: 'GPS',
        severity: 'LOW',
        description: 'Intervalo maior que o esperado entre checkpoints de GPS aceitos durante a atividade (possível perda de sinal).',
        weightPenalty: 10
      });
    }

    // 3. Sensor Analysis
    const sensorReport = SensorEngine.evaluate(activity);
    sensorReport.threats.forEach(threat => {
      const isMissingTelemetry = threat === 'MISSING_SENSOR_TELEMETRY';
      evidences.push({
        code: threat,
        category: 'SENSOR',
        severity: isMissingTelemetry ? 'MEDIUM' : 'HIGH', // #200: variancia de sensor incoerente com corrida/caminhada agora forca UNDER_REVIEW
        description: isMissingTelemetry
          ? 'Nenhum dado de acelerômetro/giroscópio foi coletado durante uma atividade que depende de movimento real.'
          : `Anomalia de sensores: ${threat}`,
        weightPenalty: isMissingTelemetry ? 25 : 20
      });
    });

    // 4. Health Ecosystem Analysis
    const healthReport = HealthEngine.evaluate(activity);
    if (healthReport.isPayloadTampered) {
      evidences.push({
        code: 'HEALTH_PAYLOAD_TAMPERED',
        category: 'HEALTH',
        severity: 'HIGH',
        description: 'Sincronização adulterada do Apple Health / Health Connect.',
        weightPenalty: 40
      });
    }

    // 5. Photo Forensics Analysis
    const photoReport = PhotoEngine.evaluate(activity, userHistory);
    if (photoReport.isDuplicatePhoto) {
      evidences.push({
        code: 'DUPLICATE_PHOTO',
        category: 'PHOTO',
        severity: 'MEDIUM',
        description: 'Foto enviada já foi utilizada em treino anterior.',
        weightPenalty: 20
      });
    }
    if (photoReport.isAiGenerated) {
      evidences.push({
        code: 'AI_GENERATED_PHOTO',
        category: 'PHOTO',
        severity: 'HIGH',
        description: 'Imagem gerada por Inteligência Artificial identificada.',
        weightPenalty: 40
      });
    }
    if (photoReport.isInternetStockPhoto) {
      evidences.push({
        code: 'STOCK_PHOTO',
        category: 'PHOTO',
        severity: 'MEDIUM',
        description: 'Imagem obtida da internet / banco de imagens.',
        weightPenalty: 35
      });
    }
    if (photoReport.isOldPhoto) {
      evidences.push({
        code: 'OLD_PHOTO',
        category: 'PHOTO',
        severity: 'MEDIUM',
        description: 'Metadata EXIF indica foto capturada em data divergente.',
        weightPenalty: 25
      });
    }

    // 6. Physical Impossibilities
    const calories = Number(activity.calories || activity.caloriesKcal || 0);
    const durationMins = Number(activity.durationMins || activity.duration || 30);
    if (durationMins > 0 && calories / (durationMins / 60) > 3000) {
      evidences.push({
        code: 'IMPOSSIBLE_CALORIES',
        category: 'PHYSICAL_IMPOSSIBILITY',
        severity: 'HIGH',
        description: `Gasto calórico de ${calories} kcal em ${durationMins} min é fisicamente impossível.`,
        weightPenalty: 35
      });
    }

    const avgHr = Number(activity.avgHeartRate || activity.heartRate || 0);
    if (avgHr > 230) {
      evidences.push({
        code: 'IMPOSSIBLE_HEART_RATE',
        category: 'PHYSICAL_IMPOSSIBILITY',
        severity: 'HIGH',
        description: `Frequência cardíaca média de ${avgHr} BPM excede o limite fisiológico humano.`,
        weightPenalty: 30
      });
    }

    // #231: MOVIMENTO REAL EM ATIVIDADE COM GPS.
    //
    // Ate 2026-08 nenhum motor exigia deslocamento. O ValidationEngine aceitava
    // distanceKm >= 0 (zero passava) e a formula de pontos (ranking-points.ts)
    // recebe apenas duracao -- distancia nunca foi parametro. Resultado: ficar
    // parado com o GPS ligado por N minutos pontuava igual a uma corrida real.
    //
    // A regra vale SOMENTE para os tipos de movementCheckTypes (os mesmos que
    // exigem GPS). Cardio indoor (esteira, ergometrica), quando existir, fica
    // de fora de proposito e precisara de um caminho de validacao proprio.
    //
    // A penalidade (75) ultrapassa underReviewMaxRiskScore (70), entao a decisao
    // vira BLOCKED e shouldScore fica false: a atividade e reprovada e nao pontua.
    const tipoAtividade = (activity.activityType || activity.type || activity.sportType || '')
      .toString()
      .toUpperCase();
    const exigeMovimento = SECURITY_CONFIG.validation.movementCheckTypes.includes(tipoAtividade);
    if (exigeMovimento && durationMins > 0) {
      const distanciaKm = Number(
        activity.distanceKm || (activity.distanceMeters ? activity.distanceMeters / 1000 : 0)
      ) || 0;
      const minimoKm = (durationMins / 10) * SECURITY_CONFIG.validation.minDistanceKmPer10Min;
      if (distanciaKm < minimoKm) {
        evidences.push({
          code: 'INSUFFICIENT_MOVEMENT',
          category: 'PHYSICAL_IMPOSSIBILITY',
          severity: 'CRITICAL',
          description: `Deslocamento de ${distanciaKm.toFixed(2)} km em ${durationMins} min esta abaixo do minimo exigido (${minimoKm.toFixed(2)} km) para atividades do tipo ${tipoAtividade}.`,
          weightPenalty: SECURITY_CONFIG.riskPenalties.insufficientMovement
        });
      }
    }

    // 7. Duplicate Activity Replay
    if (activity.isDuplicateActivity || activity.idempotencyDuplicate) {
      evidences.push({
        code: 'REPLAY_DUPLICATE_ACTIVITY',
        category: 'REPLAY',
        severity: 'HIGH',
        description: 'Tentativa de re-envio / duplicação de atividade idêntica.',
        weightPenalty: 40
      });
    }

    const fraudDetected = evidences.length > 0;
    const criticalCount = evidences.filter(e => e.severity === 'CRITICAL').length;
    const highCount = evidences.filter(e => e.severity === 'HIGH').length;

    const summary = fraudDetected
      ? `Foram identificadas ${evidences.length} evidências de fraude (${criticalCount} críticas, ${highCount} de alto risco).`
      : 'Nenhuma evidência de fraude ou anomalia grave foi detectada.';

    return {
      fraudDetected,
      evidences,
      deviceReport,
      gpsReport,
      sensorReport,
      healthReport,
      photoReport,
      summary
    };
  }
}
