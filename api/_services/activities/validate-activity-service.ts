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
      throw new AppError('Dados da atividade são obrigatórios', 400);
    }
    if (!data.type || typeof data.type !== 'string') {
      throw new AppError('Tipo da atividade é obrigatório', 400);
    }
    if (data.duration !== undefined && (typeof data.duration !== 'number' || data.duration < 0)) {
      throw new AppError('Duração da atividade deve ser um número válido de minutos', 400);
    }
    const validIntensities = ['low', 'moderate', 'high'];
    if (data.intensity && !validIntensities.includes(data.intensity)) {
      throw new AppError('Intensidade inválida. Opções aceitas: low, moderate, high', 400);
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
      return { isFraud: true, reason: 'Duração excessiva e não crível (> 6 horas contínuas)' };
    }
    if (data.evidence?.steps && data.duration && data.duration > 0) {
      const stepsPerMinute = data.evidence.steps / data.duration;
      if (stepsPerMinute > 300) {
        return { isFraud: true, reason: 'Cadência de passos por minuto sobre-humana (> 300 spm)' };
      }
    }
    return { isFraud: false };
  }

  async execute(request: ValidateActivityRequest): Promise<ValidateActivityResponse> {
    const traceId = this.generateTraceId();
    console.log(`[ValidateActivityService] [${traceId}] Iniciando validação para usuário ${request.userId}`);

    // 1. Validar entrada
    this.validateInput(request.activityData);
    console.log(`[ValidateActivityService] [${traceId}] Entrada de dados validada com sucesso`);

    // 2. Buscar usuário
    const user = await this.userRepository.findById(request.userId);
    if (!user) {
      console.warn(`[ValidateActivityService] [${traceId}] Usuário ${request.userId} não encontrado no Firestore`);
      throw new AppError('Usuário não encontrado no sistema', 404);
    }

    // 3. Detectar fraude
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
      throw new AppError(`Atividade rejeitada por inconsistência nos dados: ${fraudCheck.reason}`, 422);
    }

    // 3.5. Idempotencia basica: recusar reenvio da mesma atividade (mesmo type
    // + duration) nos ultimos 10 segundos. Este endpoint legado nao possui uma
    // chave de idempotencia formal do cliente; isso cobre o caso mais comum de
    // duplicidade (duplo clique, retry de rede). Reaproveita
    // ActivityRepository.findRecentByUser, que ja existia mas nunca era chamado.
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

    // 3.6. Enterprise Security Pipeline (ver auditoria antifraude 2026-08). O checador
    // de fraude legado acima (detectFraud) so cobre duracao>6h e passos/min>300, usando
    // campos (data.duration, data.evidence.steps) que na pratica NAO batem com o que o
    // frontend realmente envia para este endpoint legado hoje (durationMins,
    // pedometerSteps no nivel raiz de activityData) -- ou seja, a checagem legada
    // praticamente nunca disparava de verdade. O SecurityPipeline le os campos reais
    // enviados por activityService.ts (isMockLocation, isEmulator, isRooted,
    // isDeveloperMode, sensorTelemetry, avgHeartRate, checkpoints, distanceKm)
    // diretamente do payload recebido, com fallback seguro quando ausentes.
    const rawActivity: any = request.activityData || {};
    let securityBlocked = false;
    let securityReason: string | null = null;
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
      }
    } catch (secErr) {
      // Fail-open: falha no motor de seguranca nao derruba o registro da atividade.
      console.error(`[ValidateActivityService] [${traceId}] SecurityPipeline.runPipeline falhou, prosseguindo sem bloqueio:`, secErr);
    }

    if (securityBlocked) {
      console.warn(`[ValidateActivityService] [${traceId}] SecurityPipeline recusou pontuacao: ${securityReason}`);
      await this.auditRepository.log({
        traceId,
        userId: request.userId,
        action: 'VALIDATE_ACTIVITY_SECURITY_PIPELINE_BLOCKED',
        details: { activityData: request.activityData, reason: securityReason },
        result: 'FLAGGED'
      });
      throw new AppError(`Atividade recusada pela auditoria antifraude (${securityReason}).`, 422);
    }

    // 4. Calcular score
    const scoreAwarded = this.calculateScore(request.activityData);
    console.log(`[ValidateActivityService] [${traceId}] Pontuação calculada: +${scoreAwarded} XP`);

    // 5. Salvar atividade no repositório
    const savedActivity = await this.activityRepository.create({
      userId: request.userId,
      type: request.activityData.type,
      duration: request.activityData.duration || 30,
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
    console.log(`[ValidateActivityService] [${traceId}] Atividade registrada no repositório (ID: ${savedActivity.id})`);

    // 6. Atualizar XP do usuário
    const { newXP, newLevel } = await this.userRepository.addXP(request.userId, scoreAwarded);
    console.log(`[ValidateActivityService] [${traceId}] XP do usuário atualizado para ${newXP} (Nível ${newLevel})`);

    // 7. Registrar auditoria
    await this.auditRepository.log({
      traceId,
      userId: request.userId,
      action: 'VALIDATE_ACTIVITY_SUCCESS',
      details: { activityId: savedActivity.id, scoreAwarded, newXP, newLevel },
      result: 'SUCCESS'
    });

    // 8. Notificar usuário
    await this.notificationService.send({
      userId: request.userId,
      title: 'Atividade Validada! 🔥',
      body: `Sua atividade de ${request.activityData.type} foi concluída com sucesso. Você ganhou +${scoreAwarded} XP!`,
      type: 'activity_validated',
      data: { activityId: savedActivity.id, scoreAwarded, traceId }
    });

    return {
      success: true,
      activityId: savedActivity.id || '',
      scoreAwarded,
      level: newLevel,
      message: 'Atividade validada e registrada com sucesso!',
      traceId
    };
  }
}
