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
import { criarPresenceCheck } from '../../_lib/presence-check-service.js';

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
    const duration = data.duration || 30;
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

  private buildSecurityUserMessage(decision: string, explanationSummary?: string, primaryRiskDriver?: string): string {
    const decisionLabel = decision === 'BLOCKED'
      ? 'nao foi homologada'
      : decision === 'UNDER_REVIEW'
        ? 'ficou pendente de analise manual'
        : 'foi sinalizada como parcialmente aprovada';

    if (explanationSummary) {
      return `Sua atividade ${decisionLabel} pela auditoria antifraude. Motivo: ${explanationSummary}`;
    }
    if (primaryRiskDriver) {
      return `Sua atividade ${decisionLabel} pela auditoria antifraude. Principal fator de risco: ${primaryRiskDriver}.`;
    }
    return `Sua atividade ${decisionLabel} pela auditoria antifraude. Nossos sistemas detectaram inconsistencias entre o GPS, os sensores do aparelho e o tipo de atividade declarado.`;
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
    const durationForMetrics = request.activityData.duration || rawActivity.durationMins || 30;
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
    const estimatedPace = formatPace(rawActivity.distanceKm, durationForMetrics);
    const finalCalories = (rawActivity.healthTelemetry && typeof rawActivity.healthTelemetry.calories === 'number' && rawActivity.healthTelemetry.calories > 0)
      ? rawActivity.healthTelemetry.calories
      : estimatedCalories;
    // #71: Health Data Layer -- fonte 'invictus_gps' quando ha percurso real
    // (distancia/checkpoints), 'invictus_manual' quando nao ha (musculacao,
    // cardio indoor sem GPS). So decide a FONTE da amostra de saude, nao
    // influencia pontuacao/IGA.
    const healthSampleSource: HealthSampleSource = (Number(rawActivity.distanceKm) > 0 || Array.isArray(rawActivity.checkpoints) && rawActivity.checkpoints.length > 0)
      ? 'invictus_gps'
      : 'invictus_manual';

    let securityBlocked = false;
    let securityReason: string | null = null;
    let securityUserMessage: string | null = null;
    let securityCanRetry = true;
    // Guardado a parte de securityReason (que ja vem prefixado 'SECURITY_PIPELINE_')
    // para decidir, logo abaixo, se este e o caso especifico UNDER_REVIEW que
    // oferece uma segunda chance via selfie em vez de bloquear direto.
    let securityDecision: string | null = null;
    // #237: historico real do atleta -- sem ele, BehaviorEngine e
    // ReputationEngine ficam no ramo neutro e nunca comparam o atleta com ele
    // mesmo. Ver api/_lib/user-activity-history.ts.
    const userHistory = await buscarHistoricoRecente(request.userId);
    try {
      const securityResult = await SecurityPipeline.runPipeline(
        {
          activityType: (rawActivity.type || 'WORKOUT').toString().toUpperCase(),
          type: (rawActivity.type || 'WORKOUT').toString().toUpperCase(),
          muscleGroup: rawActivity.muscleGroup,
          cardioType: rawActivity.cardioType,
          durationMins: Number(rawActivity.durationMins ?? rawActivity.duration) || 0,
          distanceKm: Number(rawActivity.distanceKm) || 0,
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
      if (!securityResult.shouldScore) {
        securityBlocked = true;
        securityDecision = securityResult.decision;
        securityReason = 'SECURITY_PIPELINE_' + securityResult.decision;
        securityCanRetry = securityResult.decision !== 'BLOCKED';
        securityUserMessage = this.buildSecurityUserMessage(
          securityResult.decision,
          securityResult.report?.explanation?.summaryText,
          securityResult.report?.explanation?.primaryRiskDriver
        );
      }
    } catch (secErr) {
      // #203: Fail-closed -- se o motor de seguranca falhar tecnicamente, a atividade NAO e aprovada.
      securityBlocked = true;
      securityReason = 'SECURITY_PIPELINE_ERROR';
      securityCanRetry = true;
      securityUserMessage = 'Nao foi possivel validar esta atividade agora (falha tecnica no motor antifraude). Tente novamente em instantes.';
      console.error(`[ValidateActivityService] [${traceId}] SecurityPipeline.runPipeline falhou, bloqueando por seguranca (fail-closed):`, secErr);
    }

    // Segunda chance por selfie: UNDER_REVIEW significa confianca baixa mas
    // NAO um sinal de fraude definitivo (isso e BLOCKED -- mock location,
    // teleporte, etc., onde uma selfie nao resolve nada porque o problema e
    // no dispositivo/GPS, nao na identidade). Em vez de recusar a atividade
    // direto, oferece ao atleta confirmar presenca ao vivo -- mesmo mecanismo
    // ja usado no check-in de academia (ver api/_lib/presence-check-service.ts).
    // A atividade so e de fato persistida depois, em
    // api/_handlers/validate-presence.ts (actionType 'activity_under_review'),
    // apos a selfie ser avaliada.
    if (securityBlocked && securityDecision === 'UNDER_REVIEW') {
      try {
        const { presenceCheckId, livenessPrompt } = await criarPresenceCheck({
          userId: request.userId,
          actionType: 'activity_under_review',
          payload: {
            ...rawActivity,
            type: request.activityData.type,
            duration: durationForMetrics,
            intensity: request.activityData.intensity || 'moderate',
            startTime: request.activityData.startTime || new Date().toISOString(),
            endTime: request.activityData.endTime || new Date().toISOString(),
            evidence: request.activityData.evidence || {},
          },
        });

        await this.auditRepository.log({
          traceId,
          userId: request.userId,
          action: 'VALIDATE_ACTIVITY_SECURITY_PIPELINE_UNDER_REVIEW_PRESENCE_CHECK',
          details: { activityData: request.activityData, reason: securityReason, presenceCheckId },
          result: 'FLAGGED'
        });

        return {
          success: false,
          presenceCheckRequired: true,
          presenceCheckId,
          livenessPrompt,
          message: securityUserMessage || 'Confirme sua presenca por selfie para validar esta atividade.',
          userMessage: securityUserMessage || 'Confirme sua presenca por selfie para validar esta atividade.',
          traceId
        } as any;
      } catch (presenceErr) {
        // Se a criacao do presence check falhar por algum motivo tecnico, cai
        // para o bloqueio padrao abaixo em vez de deixar o atleta sem resposta.
        console.error(`[ValidateActivityService] [${traceId}] Falha ao criar presence check para UNDER_REVIEW, aplicando bloqueio padrao:`, presenceErr);
      }
    }

    if (securityBlocked) {
      console.warn(`[ValidateActivityService] [${traceId}] SecurityPipeline recusou pontuacao: ${securityReason}`);

      try {
        const rejectedActivity = await this.activityRepository.create({
          userId: request.userId,
          type: request.activityData.type,
          muscleGroup: rawActivity.muscleGroup,
          cardioType: rawActivity.cardioType,
          cardioTypeLabel: rawActivity.cardioTypeLabel,
          duration: durationForMetrics,
          distance: Number(rawActivity.distanceKm) || 0,
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
          status: 'rejected',
          validationStatus: 'invalid',
          nonScoringReason: securityReason,
          rejectionReason: securityUserMessage,
          userMessage: securityUserMessage,
          evidence: request.activityData.evidence || {},
          traceId
        });

        // #71: Health Data Layer -- ADITIVO. Uma atividade bloqueada pelo
        // antifraude ainda pode ter uma leitura biometrica REAL por baixo
        // (o sensor nao mentiu so porque o GPS/padrao de movimento pareceu
        // suspeito) -- por isso quality='sensor_flagged' em vez de
        // descartar a leitura. Nunca afeta pontuacao/IGA; falha aqui nunca
        // derruba a resposta principal (ja lancada acima).
        try {
          await registrarAmostrasDeAtividade({
            userId: request.userId,
            source: healthSampleSource,
            sourceActivityId: rejectedActivity.id!,
            timestamp: normalizarTimestamp(request.activityData.startTime),
            aprovadoPeloAntifraude: false,
            pularDuplicata: false,
            avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate,
            calories: finalCalories,
            distanceKm: Number(rawActivity.distanceKm) > 0 ? Number(rawActivity.distanceKm) : undefined,
            durationMin: durationForMetrics > 0 ? durationForMetrics : undefined
          });
        } catch (healthLayerErr) {
          console.error(`[ValidateActivityService] [${traceId}] Health Data Layer falhou (nao-fatal):`, healthLayerErr);
        }
      } catch (persistErr) {
        console.error(`[ValidateActivityService] [${traceId}] Falha ao persistir atividade rejeitada no historico:`, persistErr);
      }

      await this.auditRepository.log({
        traceId,
        userId: request.userId,
        action: 'VALIDATE_ACTIVITY_SECURITY_PIPELINE_BLOCKED',
        details: { activityData: request.activityData, reason: securityReason },
        result: 'FLAGGED'
      });
      throw new AppError(securityUserMessage || `Atividade recusada pela auditoria antifraude (${securityReason}).`, 422, {
        reasonCode: securityReason,
        canRetry: securityCanRetry
      } as any);
    }

    const scoreAwarded = this.calculateScore(request.activityData);
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
      distance: Number(rawActivity.distanceKm) || 0,
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
      validationStatus: 'validated',
      evidence: request.activityData.evidence || {},
      traceId
    });
    console.log(`[ValidateActivityService] [${traceId}] Atividade registrada no repositorio (ID: ${savedActivity.id})`);

    // #71: Health Data Layer -- registro ADITIVO, alem da pontuacao acima.
    // Alimenta a serie temporal de saude independente da competicao; nunca
    // influencia XP/ranking e uma falha aqui nunca derruba a resposta
    // principal (ja calculada).
    try {
      await registrarAmostrasDeAtividade({
        userId: request.userId,
        source: healthSampleSource,
        sourceActivityId: savedActivity.id!,
        timestamp: normalizarTimestamp(request.activityData.startTime),
        aprovadoPeloAntifraude: true,
        pularDuplicata: false,
        avgHeartRate: rawActivity.avgHeartRate ?? rawActivity.healthTelemetry?.avgHeartRate,
        calories: finalCalories,
        distanceKm: Number(rawActivity.distanceKm) > 0 ? Number(rawActivity.distanceKm) : undefined,
        durationMin: durationForMetrics > 0 ? durationForMetrics : undefined
      });
    } catch (healthLayerErr) {
      console.error(`[ValidateActivityService] [${traceId}] Health Data Layer falhou (nao-fatal):`, healthLayerErr);
    }

    const { newXP, newLevel } = await this.userRepository.addXP(request.userId, scoreAwarded);
    console.log(`[ValidateActivityService] [${traceId}] XP do usuario atualizado para ${newXP} (Nivel ${newLevel})`);

    // Recalcula weeklyScore/monthlyScore/score (temporada) a partir da FONTE UNICA
    // (IGA) agora que a atividade ja esta persistida no Firestore -- a query interna
    // de recalculateAllUserScores ja vai encontrar este workout. Roda DEPOIS do
    // create() de proposito: rodar antes contaria a atividade duas vezes (uma pela
    // query, outra por extraSession).
    let weeklyIgaScore = 0;
    let newRankingScore: number | undefined;
    try {
      const recalculated = await recalculateAllUserScores(request.userId);
      weeklyIgaScore = recalculated.weekly.igaRanking;
      newRankingScore = recalculated.season.average;
      console.log(`[ValidateActivityService] [${traceId}] Pontuacao IGA recalculada: semana=${recalculated.weekly.igaRanking} mes=${recalculated.monthly.average} temporada=${recalculated.season.average}`);
    } catch (rankingErr) {
      console.error(`[ValidateActivityService] [${traceId}] Falha ao recalcular pontuacao IGA, atividade permanece salva mas ranking pode ficar desatualizado:`, rankingErr);
    }

    // Submissao automatica a campeonatos (Arena/Run Elite) em que o usuario
    // tenha inscricao PAGA e ativa -- ver championship-scoring-service.ts.
    // E um no-op de custo minimo (uma leitura por campeonato compativel, e
    // so 2 campeonatos existem hoje) para quem nao esta inscrito em nenhum,
    // e nunca pode derrubar a resposta principal da atividade.
    try {
      await submitActivityToActiveChampionships({
        userId: request.userId,
        userName: user.name || user.displayName,
        userGymName: user.gymName,
        activityId: savedActivity.id || '',
        activityType: request.activityData.type,
        isIndoorCardio: rawActivity.isIndoorCardio,
        durationMinutes: durationForMetrics,
        distanceKm: Number(rawActivity.distanceKm) || 0,
        score: scoreAwarded,
        when: new Date(request.activityData.endTime || request.activityData.startTime || Date.now()),
      });
    } catch (championshipErr) {
      console.error(`[ValidateActivityService] [${traceId}] Falha ao submeter atividade a campeonatos (nao-fatal):`, championshipErr);
    }

    await this.auditRepository.log({
      traceId,
      userId: request.userId,
      action: 'VALIDATE_ACTIVITY_SUCCESS',
      details: { activityId: savedActivity.id, scoreAwarded, weeklyIgaScore, newXP, newLevel },
      result: 'SUCCESS'
    });

    const successUserMessage = `Atividade homologada com sucesso! Voce ganhou +${scoreAwarded} XP. Seu IGA da semana agora e ${weeklyIgaScore}.`;

    await this.notificationService.send({
      userId: request.userId,
      title: 'Atividade Validada!',
      body: `Sua atividade de ${request.activityData.type} foi concluida com sucesso. Voce ganhou +${scoreAwarded} XP! Seu IGA da semana agora e ${weeklyIgaScore}.`,
      type: 'activity_validated',
      data: { activityId: savedActivity.id, scoreAwarded, weeklyIgaScore, traceId }
    });

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
        distance: Number(rawActivity.distanceKm) || 0,
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
