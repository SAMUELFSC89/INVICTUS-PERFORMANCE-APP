import { ValidateActivityRequest, ValidateActivityResponse } from '../../_dto/activity-dto.js';
import { ActivityRepository } from '../../_repositories/activity-repository.js';
import { UserRepository } from '../../_repositories/user-repository.js';
import { AuditRepository } from '../../_repositories/audit-repository.js';
import { NotificationService } from '../notification-service.js';
import { AppError } from '../../_middleware/error.js';
import { SecurityPipeline } from '../../_lib/security-pipeline.js';

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
    let securityBlocked = false;
    let securityReason: string | null = null;
    let securityUserMessage: string | null = null;
    let securityCanRetry = true;
    try {
      const securityResult = await SecurityPipeline.runPipeline(
        {
          activityType: (rawActivity.type || 'WORKOUT').toString().toUpperCase(),
          type: (rawActivity.type || 'WORKOUT').toString().toUpperCase(),
          durationMins: Number(rawActivity.durationMins ?? rawActivity.duration) || 0,
          distanceKm: Number(rawActivity.distanceKm) || 0,
          checkpoints: rawActivity.checkpoints,
          timestamp: rawActivity.startTime || new Date().toISOString(),
          source: 'LEGACY_VALIDATE_ACTIVITY',
          avgHeartRate: rawActivity.avgHeartRate,
          steps: rawActivity.pedometerSteps ?? rawActivity.evidence?.steps,
          sensorTelemetry: rawActivity.sensorTelemetry,
          isMockLocation: rawActivity.isMockLocation,
          isEmulator: rawActivity.isEmulator,
          isRooted: rawActivity.isRooted,
          isDeveloperMode: rawActivity.isDeveloperMode
        },
        request.userId,
        user || {},
        []
      );
      if (!securityResult.shouldScore) {
        securityBlocked = true;
        securityReason = 'SECURITY_PIPELINE_' + securityResult.decision;
        securityCanRetry = securityResult.decision !== 'BLOCKED';
        securityUserMessage = this.buildSecurityUserMessage(
          securityResult.decision,
          securityResult.report?.explanation?.summaryText,
          securityResult.report?.explanation?.primaryRiskDriver
        );
      }
    } catch (secErr) {
      console.error(`[ValidateActivityService] [${traceId}] SecurityPipeline.runPipeline falhou, prosseguindo sem bloqueio:`, secErr);
    }

    if (securityBlocked) {
      console.warn(`[ValidateActivityService] [${traceId}] SecurityPipeline recusou pontuacao: ${securityReason}`);

      try {
        await this.activityRepository.create({
          userId: request.userId,
          type: request.activityData.type,
          cardioType: rawActivity.cardioType,
          cardioTypeLabel: rawActivity.cardioTypeLabel,
          duration: request.activityData.duration || rawActivity.durationMins || 30,
          distance: Number(rawActivity.distanceKm) || 0,
          intensity: request.activityData.intensity || 'moderate',
          startTime: request.activityData.startTime || new Date().toISOString(),
          endTime: request.activityData.endTime || new Date().toISOString(),
          pointsEarned: 0,
          scoreAwarded: 0,
          status: 'rejected',
          validationStatus: 'invalid',
          nonScoringReason: securityReason,
          rejectionReason: securityUserMessage,
          userMessage: securityUserMessage,
          evidence: request.activityData.evidence || {},
          traceId
        });
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

    const savedActivity = await this.activityRepository.create({
      userId: request.userId,
      type: request.activityData.type,
      cardioType: rawActivity.cardioType,
      cardioTypeLabel: rawActivity.cardioTypeLabel,
      duration: request.activityData.duration || rawActivity.durationMins || 30,
      distance: Number(rawActivity.distanceKm) || 0,
      trajectory: Array.isArray(rawActivity.checkpoints) ? rawActivity.checkpoints : undefined,
      photoUrl: rawActivity.photoBase64 || undefined,
      intensity: request.activityData.intensity || 'moderate',
      startTime: request.activityData.startTime || new Date().toISOString(),
      endTime: request.activityData.endTime || new Date().toISOString(),
      pointsEarned: scoreAwarded,
      scoreAwarded,
      status: 'completed',
      validationStatus: 'validated',
      evidence: request.activityData.evidence || {},
      traceId
    });
    console.log(`[ValidateActivityService] [${traceId}] Atividade registrada no repositorio (ID: ${savedActivity.id})`);

    const { newXP, newLevel } = await this.userRepository.addXP(request.userId, scoreAwarded);
    console.log(`[ValidateActivityService] [${traceId}] XP do usuario atualizado para ${newXP} (Nivel ${newLevel})`);

    await this.auditRepository.log({
      traceId,
      userId: request.userId,
      action: 'VALIDATE_ACTIVITY_SUCCESS',
      details: { activityId: savedActivity.id, scoreAwarded, newXP, newLevel },
      result: 'SUCCESS'
    });

    const successUserMessage = `Atividade homologada com sucesso! Voce ganhou +${scoreAwarded} XP.`;

    await this.notificationService.send({
      userId: request.userId,
      title: 'Atividade Validada!',
      body: `Sua atividade de ${request.activityData.type} foi concluida com sucesso. Voce ganhou +${scoreAwarded} XP!`,
      type: 'activity_validated',
      data: { activityId: savedActivity.id, scoreAwarded, traceId }
    });

    return {
      success: true,
      activityId: savedActivity.id || '',
      scoreAwarded,
      level: newLevel,
      message: successUserMessage,
      userMessage: successUserMessage,
      traceId,
      workout: {
        id: savedActivity.id,
        points: scoreAwarded,
        level: newLevel,
        status: 'valid',
        type: request.activityData.type,
        distance: Number(rawActivity.distanceKm) || 0,
        duration: request.activityData.duration || rawActivity.durationMins || 30
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
