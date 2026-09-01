import { ValidateActivityRequest, ValidateActivityResponse } from '../../_dto/activity-dto.js';
import { ActivityRepository } from '../../_repositories/activity-repository.js';
import { UserRepository } from '../../_repositories/user-repository.js';
import { AuditRepository } from '../../_repositories/audit-repository.js';
import { NotificationService } from '../notification-service.js';
import { AppError } from '../../_middleware/error.js';
import { SecurityPipeline } from '../../_lib/security-pipeline.js';
import { recalculateAllUserScores } from '../../_lib/igaService.js';
import { buscarHistoricoRecente } from '../../_lib/user-activity-history.js';
import { estimateCalories, formatPace } from '../../_lib/activity-metrics.js';
import { registrarAmostrasDeAtividade, HealthSampleSource } from '../../_lib/health-data-layer.js';
import { submitActivityToActiveChampionships } from '../../_lib/championship-scoring-service.js';
import { validateGeofenceCheckin, MAX_GEOFENCE_RADIUS_METERS, MAX_GPS_ACCURACY_METERS } from '../../_lib/geofence-engine.js';
import { resolverPerfilValidacao, resolveModality } from '../../_lib/modality-config.js';
import { GpsEngine } from '../../_lib/gps-engine.js';
import { db } from '../../_lib/common.js';

async function hasActiveChampionshipEnrollment(userId: string): Promise<boolean> {
  if (!db) return false;
  const [community, paid] = await Promise.all([
    db.collection('community_championship_enrollments').doc(`community_friends_v1_${userId}`).get(),
    db.collection('championship_registrations').where('userId', '==', userId).get(),
  ]);
  return community.data()?.status === 'active' || paid.docs.some((item) => item.data()?.status === 'paga');
}

async function validateCheckInOwnership(userId: string, checkInId: string): Promise<void> {
  if (!db) throw new AppError('Não foi possível validar o check-in agora.', 503);
  const snap = await db.collection('gym_checkins').doc(checkInId).get();
  const data = snap.data();
  const expiresAt = data?.expiresAt ? new Date(data.expiresAt).getTime() : 0;
  if (!snap.exists || data?.userId !== userId || !['confirmed', 'suspicious'].includes(data?.status) || expiresAt < Date.now()) {
    throw new AppError('Este check-in não é válido ou expirou. Faça um novo check-in presencial.', 400);
  }
}

// #71: request.activityData.startTime e tipado como `Date | string` (DTO),
// mas registrarAmostrasDeAtividade exige `timestamp: string`. O padrao
// `startTime || new Date().toISOString()` ja usado neste arquivo pra outros
// campos (que aceitam Date|string) nao tipa como string aqui -- o TS reclama
// (CI: "Lint & Type Check" pegou, esbuild nao, por nao fazer typecheck real).
function normalizarTimestamp(valor: Date | string | undefined | null): string {
  if (!valor) return new Date().toISOString();
  return typeof valor === 'string' ? valor : valor.toISOString();
}

export class ValidateActivityService {
  constructor(
    private activityRepository: ActivityRepository,
    private userRepository: UserRepository,
    private auditRepository: AuditRepository,
    private notificationService: NotificationService,
  ) {}

  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private validateInput(data: ValidateActivityRequest['activityData']): void {
    if (!data) {
      throw new AppError('Dados da atividade sao obrigatorios', 400);
    }
    if (!data.type || typeof data.type !== 'string') {
      throw new AppError('Tipo da atividade e obrigatorio', 400);
    }
    if (data.duration !== undefined && (typeof data.duration !== 'number' || data.duration < 0)) {
      throw new AppError('Duracao da atividade deve ser um numero valido de minutos', 400);
    }
    const validIntensities = ['low', 'moderate', 'high'];
    if (data.intensity && !validIntensities.includes(data.intensity)) {
      throw new AppError('Intensidade invalida. Opcoes aceitas: low, moderate, high', 400);
    }
  }

  private calculateScore(data: ValidateActivityRequest['activityData']): number {
    const profile = resolverPerfilValidacao(data);
    const rawDuration = Number((data as any).duration ?? (data as any).durationMins) || 0;
    const duration = profile.maxMinutosContabilizados > 0
      ? Math.min(rawDuration, profile.maxMinutosContabilizados)
      : rawDuration;
    const basePointsPerMinute = data.type === 'power_video' ? 10 : 2;
    const intensityMultiplier = data.intensity === 'high' ? 1.5 : data.intensity === 'moderate' ? 1.2 : 1.0;

    let totalScore = Math.round(duration * basePointsPerMinute * intensityMultiplier);
    if (data.type === 'power_video') {
      totalScore = Math.min(totalScore, 100);
    }
    return Math.max(totalScore, 10);
  }

  private detectFraud(data: ValidateActivityRequest['activityData']): { isFraud: boolean; reason?: string } {
    if (data.duration && data.duration > 360) {
      return { isFraud: true, reason: 'Duracao excessiva e nao crivel (> 6 horas continuas)' };
    }
    if (data.evidence?.steps && data.duration && data.duration > 0) {
      const stepsPerMinute = data.evidence.steps / data.duration;
      if (stepsPerMinute > 300) {
        return { isFraud: true, reason: 'Cadencia de passos por minuto sobre-humana (> 300 spm)' };
      }
    }
    return { isFraud: false };
  }

  // #325 (pedido do usuario): o atleta precisa de uma mensagem SIMPLES e
  // amigavel, nunca do relatorio tecnico interno (score de risco, trust,
  // reputacao, nome do driver em ingles etc). O detalhe tecnico completo
  // continua indo pro audit log e pro campo `rejectionReason` salvo no
  // documento da atividade -- so nao vai mais para a tela do usuario.
  private buildSecurityUserMessage(decision: string): string {
    if (decision === 'UNDER_REVIEW') {
      return 'Recebemos sua atividade. Ela está em análise de segurança e ainda não gerou pontos.';
    }
    // BLOCKED (e qualquer outro motivo tecnico que caia aqui): a atividade
    // NAO trava mais o atleta numa tela de erro pedindo pra tentar de novo.
    // Ela e recebida, fica pendente de revisao, e o status muda depois que a
    // checagem terminar (resposta passa a ser 200/pending, nao mais 422).
    return 'Recebemos sua atividade! Estamos concluindo a verificação de segurança e você será avisado assim que ela for confirmada.';
  }

  // Motivo tecnico completo (score, driver, decisao) -- so para uso interno
  // (audit log, rejectionReason no documento, fila de revisao do admin).
  // Nunca deve ser exibido diretamente ao atleta.
  private buildInternalSecurityReason(decision: string, explanationSummary?: string, primaryRiskDriver?: string): string {
    if (explanationSummary) return `Decisão ${decision}: ${explanationSummary}`;
    if (primaryRiskDriver) return `Decisão ${decision}. Principal fator de risco: ${primaryRiskDriver}.`;
    return `Decisão ${decision}. Inconsistências entre GPS, sensores do aparelho e o tipo de atividade declarado.`;
  }

  async execute(request: ValidateActivityRequest): Promise<ValidateActivityResponse> {
    const traceId = this.generateTraceId();
    console.log(`[ValidateActivityService] [${traceId}] Iniciando validacao para usuario ${request.userId}`);

    this.validateInput(request.activityData);
    console.log(`[ValidateActivityService] [${traceId}] Entrada de dados validada com sucesso`);

    const user = await this.userRepository.findById(request.userId);
    if (!user) {
      console.warn(`[ValidateActivityService] [${traceId}] Usuario ${request.userId} nao encontrado no Firestore`);
      throw new AppError('Usuario nao encontrado no sistema', 404);
    }

    const fraudCheck = this.detectFraud(request.activityData);
    if (fraudCheck.isFraud) {
      console.warn(`[ValidateActivityService] [${traceId}] Suspeita de fraude: ${fraudCheck.reason}`);
      await this.auditRepository.log({
        traceId,
        userId: request.userId,
        action: 'VALIDATE_ACTIVITY_FRAUD_DETECTED',
        details: { activityData: request.activityData, reason: fraudCheck.reason },
        result: 'FLAGGED'
      });
      throw new AppError(`Atividade recusada: ${fraudCheck.reason}.`, 422);
    }

    const recentActivities = await this.activityRepository.findRecentByUser(request.userId, 0.1);
    const tenSecondsAgo = Date.now() - 10000;
    const isDuplicateSubmission = recentActivities.some(a => {
      const createdAtMs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      return createdAtMs >= tenSecondsAgo &&
        a.type === request.activityData.type &&
        (a.duration || 0) === (request.activityData.duration || 30);
    });
    if (isDuplicateSubmission) {
      console.warn(`[ValidateActivityService] [${traceId}] Envio duplicado detectado e bloqueado (mesma atividade nos ultimos 10s)`);
      throw new AppError('Esta atividade ja foi registrada. Aguarde alguns segundos antes de tentar novamente.', 409);
    }

    const rawActivity: any = request.activityData || {};
    const durationForMetrics = Number(request.activityData.duration ?? rawActivity.durationMins) || 0;
    const modality = resolveModality(rawActivity);
    // Para cardio externo, distancia/velocidade competitivas nunca sao
    // aceitas diretamente do aparelho. O servidor refaz a trilha ponto a
    // ponto, descartando baixa precisao e outliers, como processamento
    // posterior de um arquivo GPS. O valor do cliente permanece apenas no
    // payload bruto de auditoria.
    const routeReport = modality?.requiresGps ? GpsEngine.evaluate(rawActivity) : null;
    const effectiveDistanceKm = routeReport
      ? routeReport.verifiedDistanceKm
      : (Number(rawActivity.distanceKm) || 0);
    const userWeightKg = (user as any).weight || (user as any).weightKg;
    // #204: calorias/ritmo nao sao enviados pelo cliente nesta rota legada -- estimamos
    // server-side (MET x peso x tempo) para que o historico sempre tenha algo util,
    // em vez de deixar o card de atividade vazio quando o dispositivo nao informa isso.
    const estimatedCalories = estimateCalories({
      type: request.activityData.type,
      cardioType: rawActivity.cardioType,
      durationMins: durationForMetrics,
      weightKg: userWeightKg
    });
    const estimatedPace = formatPace(effectiveDistanceKm, durationForMetrics);
    const finalCalories = (rawActivity.healthTelemetry && typeof rawActivity.healthTelemetry.calories === 'number' && rawActivity.healthTelemetry.calories > 0)
      ? rawActivity.healthTelemetry.calories
      : estimatedCalories;
    // #71: Health Data Layer -- fonte 'invictus_gps' quando ha percurso real
    // (distancia/checkpoints), 'invictus_manual' quando nao ha (musculacao,
    // cardio indoor sem GPS). So decide a FONTE da amostra de saude, nao
    // influencia pontuacao/IGA.
    const healthSampleSource: HealthSampleSource = (effectiveDistanceKm > 0 || Array.isArray(rawActivity.checkpoints) && rawActivity.checkpoints.length > 0)
      ? 'invictus_gps'
      : 'invictus_manual';

    // Geofence de academia -- RE-VALIDACAO NO SERVIDOR.
    //
    // Ate agora a unica checagem de "o atleta esta mesmo na academia" para
    // musculacao rodava so no cliente (src/services/activityService.ts,
    // startSession) usando uma copia local do motor de geofence. O motor de
    // verdade, testado (api/_lib/geofence-engine.ts, 10/10 em
    // geofenceEngine.test.ts), so era chamado por api/_handlers/gyms_checkin.ts
    // -- um endpoint que NENHUM fluxo real do app invoca (checkInId nunca e
    // preenchido por handleStartActivity em Challenges.tsx). Ou seja: nada
    // impedia uma chamada direta a este endpoint (fora do app, sem passar pelo
    // client) com `startLocation` fabricado ou ausente de creditar pontos de
    // musculacao sem o atleta jamais ter estado na academia. Nunca confiar no
    // cliente para uma checagem antifraude que o proprio cliente decide se
    // roda -- reaproveita aqui o mesmo motor/limites (80m raio, 30m precisao)
    // ja usado no check-in.
    const championshipCheckInRequired = request.activityData.type === 'workout'
      ? await hasActiveChampionshipEnrollment(request.userId)
      : false;

    if (request.activityData.type === 'workout' && rawActivity.checkInId) {
      await validateCheckInOwnership(request.userId, rawActivity.checkInId);
    }

    if (request.activityData.type === 'workout' && championshipCheckInRequired && !rawActivity.checkInId) {
      const gymId = (user as any).gymId;
      const gymLocation = (user as any).gymLocation;
      const geofenceResult = validateGeofenceCheckin(
        gymId ? {
          id: gymId,
          name: (user as any).gymName || 'Sua Academia',
          latitude: gymLocation?.lat,
          longitude: gymLocation?.lng
        } : null,
        rawActivity.startLocation ? {
          latitude: rawActivity.startLocation.lat,
          longitude: rawActivity.startLocation.lng,
          accuracy: rawActivity.startLocation.accuracy,
          isMock: !!rawActivity.isMockLocation
        } : null,
        MAX_GEOFENCE_RADIUS_METERS,
        MAX_GPS_ACCURACY_METERS
      );

      if (!geofenceResult.approved) {
        console.warn(`[ValidateActivityService] [${traceId}] Geofence de academia recusada: ${geofenceResult.reason}`);

        // #325 (pedido do usuario): mesmo tratamento do bloqueio do
        // SecurityPipeline abaixo -- a musculacao tambem nao trava mais numa
        // tela de erro. Fecha a sessao normalmente, sem pontos, com status
        // pending_review (fica na fila de revisao do admin).
        const geofenceReasonCode = 'GEOFENCE_' + geofenceResult.status.toUpperCase();
        let pendingActivityId: string | undefined;
        let pendingActivityTimestamp = request.activityData.endTime || new Date().toISOString();
        try {
          const pendingActivity = await this.activityRepository.create({
            userId: request.userId,
            type: request.activityData.type,
            muscleGroup: rawActivity.muscleGroup,
            duration: durationForMetrics,
            intensity: request.activityData.intensity || 'moderate',
            startTime: request.activityData.startTime || new Date().toISOString(),
            endTime: request.activityData.endTime || new Date().toISOString(),
            points: 0,
            pointsEarned: 0,
            scoreAwarded: 0,
            rankingPointsEarned: 0,
            status: 'pending_review',
            validationStatus: 'pending_review',
            pendingReview: true,
            nonScoringReason: geofenceReasonCode,
            rejectionReason: geofenceResult.reason,
            userMessage: geofenceResult.userFacingMessage,
            evidence: request.activityData.evidence || {},
            traceId
          });
          pendingActivityId = pendingActivity.id;
          pendingActivityTimestamp = pendingActivity.createdAt || pendingActivityTimestamp;
        } catch (persistErr) {
          console.error(`[ValidateActivityService] [${traceId}] Falha ao persistir atividade de musculacao pendente de revisao:`, persistErr);
        }

        await this.auditRepository.log({
          traceId,
          userId: request.userId,
          action: 'VALIDATE_ACTIVITY_GEOFENCE_PENDING_REVIEW',
          details: { activityData: request.activityData, reason: geofenceResult.reason, status: geofenceResult.status, activityId: pendingActivityId },
          result: 'FLAGGED'
        });

        return {
          success: true,
          pending: true,
          status: 'pending_review',
          activityId: pendingActivityId,
          message: geofenceResult.userFacingMessage,
          userMessage: geofenceResult.userFacingMessage,
          isScoringEligible: false,
          nonScoringReason: geofenceReasonCode,
          reasonCode: geofenceReasonCode,
          canRetry: true,
          traceId,
          workout: pendingActivityId ? {
            id: pendingActivityId,
            points: 0,
            rankingPointsEarned: 0,
            status: 'pending_review',
            type: request.activityData.type,
            muscleGroup: rawActivity.muscleGroup,
            distance: 0,
            duration: durationForMetrics,
            calories: finalCalories,
            avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate,
            steps: rawActivity.pedometerSteps ?? rawActivity.healthTelemetry?.steps,
            timestamp: pendingActivityTimestamp
          } : undefined,
          validation: {
            success: true,
            status: 'pending_review',
            score: 0,
            reasonCode: geofenceReasonCode
          }
        } as any;
      }
    }

    let securityBlocked = false;
    let securityReason: string | null = null;
    let securityUserMessage: string | null = null;
    // Detalhe tecnico (score/driver/decisao) -- so pro audit log e pra fila
    // de revisao do admin, nunca mostrado ao atleta (ver buildSecurityUserMessage).
    let securityInternalReason: string | null = null;
    let securityCanRetry = true;
    let competitivelyEligible = true;
    let competitiveIneligibleReason: string | null = null;
    // Guardado a parte de securityReason (que ja vem prefixado 'SECURITY_PIPELINE_')
    // para decidir, logo abaixo, se este e o caso especifico UNDER_REVIEW que
    // oferece uma segunda chance via selfie em vez de bloquear direto.
    // #237: historico real do atleta -- sem ele, BehaviorEngine e
    // ReputationEngine ficam no ramo neutro e nunca comparam o atleta com ele
    // mesmo. Ver api/_lib/user-activity-history.ts.
    const userHistory = await buscarHistoricoRecente(request.userId);
    try {
      const securityResult = await SecurityPipeline.runPipeline(
        {
          activityType: modality?.antiFraudProfile || (rawActivity.type || 'WORKOUT').toString().toUpperCase(),
          type: (rawActivity.type || 'WORKOUT').toString().toUpperCase(),
          muscleGroup: rawActivity.muscleGroup,
          cardioType: rawActivity.cardioType,
          durationMins: Number(rawActivity.durationMins ?? rawActivity.duration) || 0,
          distanceKm: effectiveDistanceKm,
          checkpoints: rawActivity.checkpoints,
          timestamp: rawActivity.startTime || new Date().toISOString(),
          source: 'UNIFIED_ACTIVITY_ENGINE',
          avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate,
          steps: rawActivity.pedometerSteps ?? rawActivity.healthTelemetry?.steps ?? rawActivity.evidence?.steps,
          calories: finalCalories,
          smartwatchData: rawActivity.smartwatchData,
          healthTelemetry: rawActivity.healthTelemetry,
          metricSources: rawActivity.metricSources,
          sensorTelemetry: rawActivity.sensorTelemetry,
          isMockLocation: rawActivity.isMockLocation,
          isEmulator: rawActivity.isEmulator,
          isRooted: rawActivity.isRooted,
          isDeveloperMode: rawActivity.isDeveloperMode
        },
        request.userId,
        user || {},
        userHistory
      );
      competitivelyEligible = securityResult.report.validation.competitivelyEligible;
      competitiveIneligibleReason = securityResult.report.validation.ineligibleReason || null;
      if (!securityResult.shouldScore) {
        securityBlocked = true;
        securityReason = 'SECURITY_PIPELINE_' + securityResult.decision;
        securityCanRetry = securityResult.decision !== 'BLOCKED';
        securityUserMessage = this.buildSecurityUserMessage(securityResult.decision);
        securityInternalReason = this.buildInternalSecurityReason(
          securityResult.decision,
          securityResult.report?.explanation?.summaryText,
          securityResult.report?.explanation?.primaryRiskDriver
        );
      }
    } catch (secErr) {
      // #203: Fail-closed -- se o motor de seguranca falhar tecnicamente, a
      // atividade NAO e aprovada automaticamente -- mas tambem nao trava mais
      // o atleta numa tela de erro. Cai no mesmo fluxo "pendente de revisao"
      // do BLOCKED (ver #325): a sessao fecha normalmente, sem pontos, e o
      // status muda depois que alguem revisar manualmente.
      securityBlocked = true;
      securityReason = 'SECURITY_PIPELINE_ERROR';
      securityCanRetry = true;
      securityUserMessage = this.buildSecurityUserMessage('BLOCKED');
      securityInternalReason = 'Falha tecnica no motor antifraude (fail-closed): ' + (secErr instanceof Error ? secErr.message : String(secErr));
      console.error(`[ValidateActivityService] [${traceId}] SecurityPipeline.runPipeline falhou, bloqueando por seguranca (fail-closed):`, secErr);
    }

    if (securityBlocked) {
      console.warn(`[ValidateActivityService] [${traceId}] SecurityPipeline recusou pontuacao automatica: ${securityReason}`);

      // #325 (pedido do usuario, cardio E musculacao): a atividade NAO fica
      // mais travada numa tela de erro pedindo retry -- ela e recebida e
      // encerrada normalmente do lado do atleta, com status "pendente de
      // revisao" (pending_review). O antifraude continua rodando exatamente
      // igual (nada foi enfraquecido); so muda O QUE o atleta ve na hora: uma
      // mensagem simples de "em analise" em vez do relatorio tecnico, e a
      // sessao fecha (nao precisa mais tentar de novo). Zero pontos ate a
      // revisao mudar o status -- ver `pendingReview: true`, consumido pela
      // fila de revisao do admin (api/_handlers/admin.ts, action
      // 'list-flagged-activities') e pelo endpoint ja existente
      // 'review-activity', que flipa o status manualmente depois.
      let pendingActivityId: string | undefined;
      let pendingActivityTimestamp = request.activityData.endTime || new Date().toISOString();
      try {
        const pendingActivity = await this.activityRepository.create({
          userId: request.userId,
          type: request.activityData.type,
          muscleGroup: rawActivity.muscleGroup,
          cardioType: rawActivity.cardioType,
          cardioTypeLabel: rawActivity.cardioTypeLabel,
          duration: durationForMetrics,
          distance: effectiveDistanceKm,
          trajectory: Array.isArray(rawActivity.checkpoints) ? rawActivity.checkpoints : undefined,
          avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate ?? undefined,
          steps: rawActivity.pedometerSteps ?? rawActivity.healthTelemetry?.steps ?? rawActivity.evidence?.steps ?? undefined,
          calories: finalCalories,
          healthTelemetry: rawActivity.healthTelemetry ?? undefined,
          metricSources: rawActivity.metricSources ?? undefined,
          smartwatchData: rawActivity.smartwatchData ?? undefined,
          pace: estimatedPace ?? undefined,
          intensity: request.activityData.intensity || 'moderate',
          startTime: request.activityData.startTime || new Date().toISOString(),
          endTime: request.activityData.endTime || new Date().toISOString(),
          points: 0,
          pointsEarned: 0,
          scoreAwarded: 0,
          rankingPointsEarned: 0,
          status: 'pending_review',
          validationStatus: 'pending_review',
          pendingReview: true,
          nonScoringReason: securityReason,
          rejectionReason: securityInternalReason,
          userMessage: securityUserMessage,
          evidence: request.activityData.evidence || {},
          traceId
        });
        pendingActivityId = pendingActivity.id;
        pendingActivityTimestamp = pendingActivity.createdAt || pendingActivityTimestamp;

        // #71: Health Data Layer -- ADITIVO. Uma atividade pendente de revisao
        // ainda pode ter uma leitura biometrica REAL por baixo (o sensor nao
        // mentiu so porque o GPS/padrao de movimento pareceu suspeito) --
        // por isso quality='sensor_flagged' em vez de descartar a leitura.
        // Nunca afeta pontuacao/IGA; falha aqui nunca derruba a resposta
        // principal (ja calculada abaixo).
        try {
          await registrarAmostrasDeAtividade({
            userId: request.userId,
            source: healthSampleSource,
            sourceActivityId: pendingActivity.id!,
            timestamp: normalizarTimestamp(request.activityData.startTime),
            aprovadoPeloAntifraude: false,
            pularDuplicata: false,
            avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate,
            calories: finalCalories,
            distanceKm: effectiveDistanceKm > 0 ? effectiveDistanceKm : undefined,
            durationMin: durationForMetrics > 0 ? durationForMetrics : undefined
          });
        } catch (healthLayerErr) {
          console.error(`[ValidateActivityService] [${traceId}] Health Data Layer falhou (nao-fatal):`, healthLayerErr);
        }
      } catch (persistErr) {
        console.error(`[ValidateActivityService] [${traceId}] Falha ao persistir atividade pendente de revisao:`, persistErr);
      }

      await this.auditRepository.log({
        traceId,
        userId: request.userId,
        action: 'VALIDATE_ACTIVITY_SECURITY_PIPELINE_PENDING_REVIEW',
        details: { activityData: request.activityData, reason: securityReason, internalReason: securityInternalReason, activityId: pendingActivityId },
        result: 'FLAGGED'
      });

      return {
        success: true,
        pending: true,
        status: 'pending_review',
        activityId: pendingActivityId,
        message: securityUserMessage,
        userMessage: securityUserMessage,
        isScoringEligible: false,
        nonScoringReason: securityReason,
        reasonCode: securityReason,
        canRetry: securityCanRetry,
        traceId,
        workout: pendingActivityId ? {
          id: pendingActivityId,
          points: 0,
          rankingPointsEarned: 0,
          status: 'pending_review',
          type: request.activityData.type,
          muscleGroup: rawActivity.muscleGroup,
          cardioType: rawActivity.cardioType,
          cardioTypeLabel: rawActivity.cardioTypeLabel,
          distance: effectiveDistanceKm,
          duration: durationForMetrics,
          calories: finalCalories,
          avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate,
          steps: rawActivity.pedometerSteps ?? rawActivity.healthTelemetry?.steps,
          timestamp: pendingActivityTimestamp
        } : undefined,
        validation: {
          success: true,
          status: 'pending_review',
          score: 0,
          reasonCode: securityReason
        }
      } as any;
    }

    const scoreAwarded = competitivelyEligible ? this.calculateScore(request.activityData) : 0;
    console.log(`[ValidateActivityService] [${traceId}] Pontuacao calculada: +${scoreAwarded} XP`);

    // PONTOS DE RANKING (competicao) -- distinto do XP acima. Ate 2026-08 este
    // endpoint calculava pontos de ranking com uma formula propria (calculateRankingPoints)
    // e gravava direto em users.score via addRankingScore -- uma das 5 formulas
    // independentes de pontuacao identificadas em AUDITORIA-CORE-INVICTUS.md (secao 1).
    // Agora o ranking (semana/mes/temporada) e recalculado pela FONTE UNICA (IGA,
    // api/_lib/igaService.ts) logo apos a atividade ser persistida -- ver abaixo.
    // "rankingPointsEarned" no documento da atividade fica 0: nao existe mais um
    // "delta" de pontos por atividade, o IGA recalcula a pontuacao inteira da janela
    // a partir das atividades validas do usuario.
    const rankingPointsEarned = 0;

    // NOTA: alem de pointsEarned/scoreAwarded (campos "oficiais" de XP usados pelo
    // restante do backend), tambem gravamos "points" aqui -- e o nome de campo que
    // ActivityHistorySection.tsx (frontend) le para exibir o XP ganho no historico de
    // atividades. Sem isso, uma atividade homologada por este endpoint aparecia
    // corretamente como "HOMOLOGADA" no historico mas sempre mostrando "0 XP".
    // #204: tambem gravamos avgHeartRate/steps/calories/pace -- ate 2026-08 esses
    // dados eram usados so para analise antifraude e descartados antes de chegar
    // no documento salvo, entao o historico nunca tinha nada alem de duracao/distancia.
    const savedActivity = await this.activityRepository.create({
      userId: request.userId,
      type: request.activityData.type,
      muscleGroup: rawActivity.muscleGroup,
      cardioType: rawActivity.cardioType,
      cardioTypeLabel: rawActivity.cardioTypeLabel,
      isIndoorCardio: rawActivity.isIndoorCardio,
      requiresGpsDistance: rawActivity.requiresGpsDistance,
      duration: durationForMetrics,
      distance: effectiveDistanceKm,
      trajectory: Array.isArray(rawActivity.checkpoints) ? rawActivity.checkpoints : undefined,
      avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate ?? undefined,
      steps: rawActivity.pedometerSteps ?? rawActivity.healthTelemetry?.steps ?? rawActivity.evidence?.steps ?? undefined,
      calories: finalCalories,
      healthTelemetry: rawActivity.healthTelemetry ?? undefined,
      metricSources: rawActivity.metricSources ?? undefined,
      smartwatchData: rawActivity.smartwatchData ?? undefined,
      pace: estimatedPace ?? undefined,
      photoUrl: rawActivity.photoBase64 || undefined,
      intensity: request.activityData.intensity || 'moderate',
      startTime: request.activityData.startTime || new Date().toISOString(),
      endTime: request.activityData.endTime || new Date().toISOString(),
      points: scoreAwarded,
      pointsEarned: scoreAwarded,
      scoreAwarded,
      rankingPointsEarned,
      status: 'completed',
      validationStatus: competitivelyEligible ? 'validated' : 'not_eligible',
      isScoringEligible: competitivelyEligible,
      nonScoringReason: competitivelyEligible ? null : competitiveIneligibleReason,
      userMessage: competitivelyEligible ? null : competitiveIneligibleReason,
      evidence: request.activityData.evidence || {},
      traceId
    });
    console.log(`[ValidateActivityService] [${traceId}] Atividade registrada no repositorio (ID: ${savedActivity.id})`);

    // #71: Health Data Layer -- registro ADITIVO, alem da pontuacao acima.
    // Alimenta a serie temporal de saude independente da competicao; nunca
    // influencia XP/ranking e uma falha aqui nunca derruba a resposta
    // principal (ja calculada).
    const healthRegistrationPromise = registrarAmostrasDeAtividade({
        userId: request.userId,
        source: healthSampleSource,
        sourceActivityId: savedActivity.id!,
        timestamp: normalizarTimestamp(request.activityData.startTime),
        aprovadoPeloAntifraude: true,
        pularDuplicata: false,
        avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate,
        calories: finalCalories,
        distanceKm: effectiveDistanceKm > 0 ? effectiveDistanceKm : undefined,
        durationMin: durationForMetrics > 0 ? durationForMetrics : undefined
      }).catch((healthLayerErr) => {
      console.error(`[ValidateActivityService] [${traceId}] Health Data Layer falhou (nao-fatal):`, healthLayerErr);
      });

    // Uma sessao curta pode ser perfeitamente real e passar pelo antifraude,
    // mas nao deve gerar XP, IGA ou inscricao automatica em campeonato. Ela
    // permanece no historico para saude/consulta, sem prejudicar a reputacao
    // do atleta e com uma explicacao simples do requisito nao atendido.
    if (!competitivelyEligible) {
      const message = competitiveIneligibleReason
        || 'Atividade concluida, mas sem pontuacao porque nao atingiu o tempo minimo da modalidade.';
      await Promise.all([healthRegistrationPromise, this.auditRepository.log({
        traceId,
        userId: request.userId,
        action: 'VALIDATE_ACTIVITY_NOT_COMPETITIVELY_ELIGIBLE',
        details: { activityId: savedActivity.id, reason: message, duration: durationForMetrics },
        result: 'SUCCESS'
      })]);
      return {
        success: true,
        activityId: savedActivity.id || '',
        scoreAwarded: 0,
        rankingPointsEarned: 0,
        message,
        userMessage: message,
        traceId,
        workout: {
          id: savedActivity.id,
          points: 0,
          rankingPointsEarned: 0,
          status: 'not_eligible',
          type: request.activityData.type,
          muscleGroup: rawActivity.muscleGroup,
          cardioType: rawActivity.cardioType,
          cardioTypeLabel: rawActivity.cardioTypeLabel,
          distance: effectiveDistanceKm,
          duration: durationForMetrics,
          calories: finalCalories,
          avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate,
          steps: rawActivity.pedometerSteps ?? rawActivity.healthTelemetry?.steps,
          timestamp: savedActivity.createdAt || new Date().toISOString()
        },
        validation: {
          success: true,
          status: 'not_eligible',
          score: 100,
          reasonCode: 'MINIMUM_COMPETITIVE_DURATION_NOT_MET'
        },
        isScoringEligible: false,
        nonScoringReason: message
      } as any;
    }

    const xpPromise = this.userRepository.addXP(request.userId, scoreAwarded);

    // Recalcula weeklyScore/monthlyScore/score (temporada) a partir da FONTE UNICA
    // (IGA) agora que a atividade ja esta persistida no Firestore -- a query interna
    // de recalculateAllUserScores ja vai encontrar este workout. Roda DEPOIS do
    // create() de proposito: rodar antes contaria a atividade duas vezes (uma pela
    // query, outra por extraSession).
    const rankingPromise = recalculateAllUserScores(request.userId).catch((rankingErr) => {
      console.error(`[ValidateActivityService] [${traceId}] Falha ao recalcular pontuacao IGA, atividade permanece salva mas ranking pode ficar desatualizado:`, rankingErr);
      return null;
    });

    // Submissao automatica a campeonatos (Arena/Run Elite) em que o usuario
    // tenha inscricao PAGA e ativa -- ver championship-scoring-service.ts.
    // E um no-op de custo minimo (uma leitura por campeonato compativel, e
    // so 2 campeonatos existem hoje) para quem nao esta inscrito em nenhum,
    // e nunca pode derrubar a resposta principal da atividade.
    const championshipPromise = submitActivityToActiveChampionships({
        userId: request.userId,
        userName: user.name || user.displayName,
        userGymName: user.gymName,
        activityId: savedActivity.id || '',
        activityType: request.activityData.type,
        isIndoorCardio: rawActivity.isIndoorCardio,
        durationMinutes: durationForMetrics,
        distanceKm: effectiveDistanceKm,
        score: scoreAwarded,
        when: new Date(request.activityData.endTime || request.activityData.startTime || Date.now()),
      }).catch((championshipErr) => {
      console.error(`[ValidateActivityService] [${traceId}] Falha ao submeter atividade a campeonatos (nao-fatal):`, championshipErr);
      });

    // As quatro tarefas dependem apenas da atividade já persistida e não umas
    // das outras. Executá-las em série fazia o atleta esperar várias viagens
    // ao Firestore depois de a decisão antifraude já estar pronta.
    const [{ newXP, newLevel }, recalculated] = await Promise.all([
      xpPromise,
      rankingPromise,
      championshipPromise,
      healthRegistrationPromise
    ]);
    console.log(`[ValidateActivityService] [${traceId}] XP do usuario atualizado para ${newXP} (Nivel ${newLevel})`);
    const weeklyIgaScore = recalculated?.weekly.igaRanking || 0;
    const newRankingScore = recalculated?.season.average;
    if (recalculated) {
      console.log(`[ValidateActivityService] [${traceId}] Pontuacao IGA recalculada: semana=${recalculated.weekly.igaRanking} mes=${recalculated.monthly.average} temporada=${recalculated.season.average}`);
    }

    const successUserMessage = `Atividade homologada com sucesso! Voce ganhou +${scoreAwarded} XP. Seu IGA da semana agora e ${weeklyIgaScore}.`;

    await Promise.all([this.auditRepository.log({
      traceId,
      userId: request.userId,
      action: 'VALIDATE_ACTIVITY_SUCCESS',
      details: { activityId: savedActivity.id, scoreAwarded, weeklyIgaScore, newXP, newLevel },
      result: 'SUCCESS'
    }), this.notificationService.send({
      userId: request.userId,
      title: 'Atividade Validada!',
      body: `Sua atividade de ${request.activityData.type} foi concluida com sucesso. Voce ganhou +${scoreAwarded} XP! Seu IGA da semana agora e ${weeklyIgaScore}.`,
      type: 'activity_validated',
      data: { activityId: savedActivity.id, scoreAwarded, weeklyIgaScore, traceId }
    })]);

    return {
      success: true,
      activityId: savedActivity.id || '',
      scoreAwarded,
      rankingPointsEarned: weeklyIgaScore,
      newRankingScore,
      level: newLevel,
      message: successUserMessage,
      userMessage: successUserMessage,
      traceId,
      workout: {
        id: savedActivity.id,
        points: scoreAwarded,
        rankingPointsEarned: weeklyIgaScore,
        level: newLevel,
        status: 'valid',
        type: request.activityData.type,
        muscleGroup: rawActivity.muscleGroup,
        cardioType: rawActivity.cardioType,
        cardioTypeLabel: rawActivity.cardioTypeLabel,
        distance: effectiveDistanceKm,
        duration: request.activityData.duration || rawActivity.durationMins || 30,
        calories: finalCalories,
        avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate,
        steps: rawActivity.pedometerSteps ?? rawActivity.healthTelemetry?.steps,
        timestamp: savedActivity.createdAt || new Date().toISOString()
      },
      validation: {
        success: true,
        status: 'approved',
        score: 100,
        reasonCode: null
      },
      isScoringEligible: true,
      nonScoringReason: null
    } as any;
  }
}
