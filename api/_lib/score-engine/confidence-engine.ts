import { EvaluationConfidence } from './types.js';

export class ConfidenceEngine {
  static evaluate(activityData: any, userData: any): EvaluationConfidence {
    let scorePct = 0;
    const availableSources: string[] = [];
    const missingSources: string[] = [];

    // 1. Smartwatch / Heart Rate Stream (+35%)
    const smartwatchData = activityData.smartwatchData || userData.smartwatchData || {};
    const hasHeartRate = !!(smartwatchData.avgHR || activityData.avgHR || activityData.hasHeartRate);
    if (hasHeartRate) {
      scorePct += 35;
      availableSources.push('Frequência Cardíaca (Smartwatch)');
    } else {
      missingSources.push('Dados Biométricos / Frequência Cardíaca');
    }

    // 2. GPS Coherence & Telemetry (+25%)
    const hasGps = activityData.hasGps !== false && activityData.source !== 'CHECKIN';
    const isMock = !!activityData.isMockLocation;
    if (hasGps && !isMock) {
      scorePct += 25;
      availableSources.push('GPS de Alta Precisão');
    } else if (isMock) {
      missingSources.push('GPS Válido (Mock GPS Detectado)');
    } else {
      missingSources.push('Rastreamento de GPS');
    }

    // 3. Photo & AI Verification (+15%)
    const hasPhoto = !!(activityData.hasPhoto || activityData.photoBase64 || activityData.imageUrl);
    const iaConfidence = activityData.iaConfidence ?? 90;
    if (hasPhoto && iaConfidence >= 80) {
      scorePct += 15;
      availableSources.push('Foto & IA de Validação');
    } else {
      missingSources.push('Foto do Treino Validada');
    }

    // 4. Exercise Log Completeness (+10%)
    const hasExercises = !!(activityData.hasExercises || (activityData.exercises && activityData.exercises.length > 0));
    if (hasExercises) {
      scorePct += 10;
      availableSources.push('Registro Detalhado de Exercícios');
    } else {
      missingSources.push('Lista de Exercícios');
    }

    // 5. External Health SDK / Platform Auth (+15%)
    const isHealthConnected = !!(
      activityData.source === 'STRAVA' ||
      activityData.source === 'HEALTH_CONNECT' ||
      activityData.source === 'APPLE_HEALTH' ||
      userData.smartwatchConnected
    );
    if (isHealthConnected) {
      scorePct += 15;
      availableSources.push('Conexão Nativa (Strava/Health SDK)');
    } else {
      missingSources.push('Sincronização Automática com Wearables');
    }

    scorePct = Math.min(100, Math.max(0, scorePct));

    let level: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    if (scorePct >= 85) level = 'HIGH';
    else if (scorePct >= 60) level = 'MEDIUM';

    let explanationText = '';
    if (level === 'HIGH') {
      explanationText = `${scorePct}% - Todos os principais sensores e comprovações de telemetria foram verificados com sucesso.`;
    } else if (level === 'MEDIUM') {
      explanationText = `${scorePct}% - Faltaram alguns dados biométricos ou sensores para atingir a confiança máxima.`;
    } else {
      explanationText = `${scorePct}% - Treino registrado com pouca comprovação sensorial. Conecte seu smartwatch ou anexe fotos para elevar a precisão.`;
    }

    return {
      scorePct,
      level,
      availableSources,
      missingSources,
      explanationText
    };
  }
}
