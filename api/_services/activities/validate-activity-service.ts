import { ValidateActivityRequest, ValidateActivityResponse } from '../../_dto/activity-dto.js';
import { ActivityRepository } from '../../_repositories/activity-repository.js';
import { UserRepository } from '../../_repositories/user-repository.js';
import { AuditRepository } from '../../_repositories/audit-repository.js';
import { NotificationService } from '../notification-service.js';
import { AppError } from '../../_middleware/error.js';

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
