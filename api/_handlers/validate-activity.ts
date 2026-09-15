import { VercelRequest, VercelResponse } from '@vercel/node';
import { corsMiddleware } from '../_middleware/cors.js';
import { methodMiddleware } from '../_middleware/method.js';
import { authMiddleware } from '../_middleware/auth.js';
import { errorHandler } from '../_middleware/error.js';
import { ActivityRepository } from '../_repositories/activity-repository.js';
import { UserRepository } from '../_repositories/user-repository.js';
import { AuditRepository } from '../_repositories/audit-repository.js';
import { NotificationService } from '../_services/notification-service.js';
import { ValidateActivityService } from '../_services/activities/validate-activity-service.js';
import { GoogleGenAI, Type } from '@google/genai';
import { db } from '../_lib/common.js';
import { resolveClientSampledFramesStatus } from '../_lib/powerlift-audit.js';
import { getAiApiKey, getAiVisionModel } from '../_lib/ai-config.js';
import { extractUsage, logAiUsage, newAiRequestId } from '../_lib/ai-usage-logger.js';
import { consumeAiQuota } from '../_lib/ai-quota.js';

const activityRepository = new ActivityRepository();
const userRepository = new UserRepository();
const auditRepository = new AuditRepository();
const notificationService = new NotificationService();

const validateActivityService = new ValidateActivityService(
  activityRepository,
  userRepository,
  auditRepository,
  notificationService
);

const apiKey = getAiApiKey();
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
const POWER_EXERCISES = new Set(['supino', 'agachamento', 'terra']);
const MAX_POWER_FRAMES = 8;
// The official client samples at max ~448 px wide and JPEG .62. These server
// ceilings leave generous headroom while preventing a modified client from
// turning a Power Lift audit into a multi-megabyte Gemini upload.
const MAX_POWER_FRAME_BASE64_LENGTH = 650_000;
const MAX_POWER_TOTAL_BASE64_LENGTH = 4_500_000;
const MAX_POWER_OUTPUT_TOKENS = 700;

type PowerDecision = 'approved' | 'manual_review' | 'rejected';

function cleanPowerMotives(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 10);
}

async function createPowerValidationSession(input: {
  userId: string;
  exercise: 'supino' | 'agachamento' | 'terra';
  weight: number;
  decision: PowerDecision;
  confidence: number;
  analysis: string;
  motives: string[];
  estimatedWeight: number;
  modelDecision?: PowerDecision;
}): Promise<string> {
  const ref = db.collection('power_validation_sessions').doc();
  const now = new Date();
  await ref.create({
    ...input,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    source: 'client_sampled_frames_v1'
  });
  return ref.id;
}

async function powerValidationResponse(input: {
  userId: string;
  exercise: 'supino' | 'agachamento' | 'terra';
  weight: number;
  decision: PowerDecision;
  confidence: number;
  estimatedWeight: number;
  motives: string[];
  analysis: string;
}) {
  const modelDecision = input.decision;
  let finalDecision = resolveClientSampledFramesStatus(modelDecision);
  let validationId: string | undefined;
  try {
    validationId = await createPowerValidationSession({ ...input, decision: finalDecision, modelDecision });
  } catch (error: any) {
    console.error('[validate-activity] Não foi possível emitir sessão PowerLift:', error?.message || 'erro desconhecido');
    finalDecision = 'manual_review';
  }

  const isValid = finalDecision === 'approved';
  const isManualReview = finalDecision === 'manual_review';
  return {
    success: true,
    isValid,
    isManualReview,
    auditResult: isValid ? 'VALIDADO' : isManualReview ? 'AUDITORIA_MANUAL' : 'REPROVADO',
    confidence: input.confidence,
    estimatedWeight: input.estimatedWeight,
    motivos: input.motives,
    analysis: input.analysis,
    ...(validationId ? { validationId } : {})
  };
}

export default async function handler(req: VercelRequest & { userId?: string }, res: VercelResponse) {
  try {
    if (corsMiddleware(req, res)) return;
    if (!methodMiddleware(req, res, ['POST'])) return;
    if (!(await authMiddleware(req, res))) return;

    const payload = req.body || {};
    const activityData = req.body.activityData || req.body;
    const type = payload.type || activityData?.type;

    // Legacy standalone photo validation has no live product caller. Keeping it
    // callable would expose a paid vision endpoint to modified clients even
    // though current activity finalization uses the canonical validation flow.
    if (type === 'image_validation') {
      return res.status(410).json({
        error: 'A validação avulsa de foto foi aposentada. Finalize a atividade pelo fluxo atual do Invictus.',
        code: 'LEGACY_IMAGE_VALIDATION_RETIRED'
      });
    }

    // PowerLift never enters generic workout/XP validation. Gemini is optional
    // automation: quota/provider failure must result in manual review, never in
    // an automatic approval or loss of the athlete's submitted evidence.
    if (type === 'power_video') {
      const exercise = typeof payload.exercise === 'string' ? payload.exercise.trim() : '';
      const declaredWeight = Math.round(Number(payload.weight ?? payload.weightKg) * 100) / 100;
      const repetitions = Math.floor(Number(payload.reps) || 1);
      if (!POWER_EXERCISES.has(exercise) || !Number.isFinite(declaredWeight) || declaredWeight < 2.5 || declaredWeight > 1000 || repetitions < 1 || repetitions > 20) {
        return res.status(400).json({ error: 'Dados do levantamento Power Lift inválidos.' });
      }

      const rawFrames = Array.isArray(payload.framesBase64) && payload.framesBase64.length > 0
        ? payload.framesBase64
        : payload.photoBase64 ? [payload.photoBase64] : [];
      const frames = rawFrames
        .filter((frame: unknown): frame is string => typeof frame === 'string')
        .slice(0, MAX_POWER_FRAMES);
      const totalFrameChars = frames.reduce((sum, frame) => sum + frame.length, 0);
      if (frames.some((frame) => frame.length > MAX_POWER_FRAME_BASE64_LENGTH) || totalFrameChars > MAX_POWER_TOTAL_BASE64_LENGTH) {
        return res.status(413).json({ error: 'Os frames de auditoria excedem o tamanho permitido.' });
      }

      const manual = (reason: string) => powerValidationResponse({
        userId: req.userId!,
        exercise: exercise as 'supino' | 'agachamento' | 'terra',
        weight: declaredWeight,
        decision: 'manual_review',
        confidence: 0,
        estimatedWeight: declaredWeight,
        motives: [reason],
        analysis: 'Vídeo encaminhado para auditoria manual. A homologação só ocorre após a validação segura.'
      });

      if (!ai || frames.length < 6) {
        return res.status(200).json(await manual('Não foi possível concluir a auditoria automática do vídeo.'));
      }

      const quota = await consumeAiQuota(req.userId!, 'powerlift_audit');
      if (!quota.allowed) {
        return res.status(200).json(await manual('A auditoria automática atingiu o limite temporário; a tentativa seguirá para revisão manual.'));
      }

      try {
        const imageParts = frames.map((frame) => ({
          inlineData: {
            data: frame.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, ''),
            mimeType: 'image/jpeg'
          }
        }));

        const exerciseName = exercise === 'supino' ? 'Supino reto' : exercise === 'agachamento' ? 'Agachamento livre' : 'Levantamento terra';
        const promptText = `# AUDITORIA TÉCNICA OFICIAL POWER LIFT INVICTUS IA

Você é o auditor biomecânico e antifraude oficial do Invictus Power Lift.
Analise os 8 frames cronológicos, distribuídos por todo o vídeo de levantamento. O resultado é apenas uma etapa; a homologação final também exige o vídeo completo do próprio atleta no armazenamento seguro.

DADOS DECLARADOS:
- Exercício: ${exerciseName}
- Carga: ${declaredWeight} kg
- Repetições: ${repetitions}

REGRAS:
1. A primeira anilha e a carga precisam estar visíveis no início.
2. O movimento precisa ser contínuo, sem cortes, edições ou gravação de tela.
3. O ambiente deve ser uma academia real; a técnica precisa ter amplitude completa.
4. Só retorne VALIDADO quando os frames demonstrarem, em sequência coerente, preparação, fase excêntrica, amplitude exigida, fase concêntrica e finalização completa.
5. Qualquer dúvida, frame ausente/inconsistente, mudança brusca de câmera/cenário, suspeita de edição, deepfake, peso incompatível ou imagem insuficiente deve resultar em AUDITORIA_MANUAL ou REPROVADO. Nunca presuma que uma etapa não visível aconteceu.

Retorne somente JSON com status (VALIDADO, AUDITORIA_MANUAL ou REPROVADO), isValid, confidence (0-100), estimatedWeight, motivos e analysis.`;

        const powerLiftModel = getAiVisionModel();
        const powerLiftRequestId = newAiRequestId();
        const powerLiftStartedAt = Date.now();
        const response = await ai.models.generateContent({
          model: powerLiftModel,
          contents: [promptText, ...imageParts],
          config: {
            responseMimeType: 'application/json',
            maxOutputTokens: MAX_POWER_OUTPUT_TOKENS,
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                status: { type: Type.STRING },
                isValid: { type: Type.BOOLEAN },
                confidence: { type: Type.NUMBER },
                estimatedWeight: { type: Type.NUMBER },
                motivos: { type: Type.ARRAY, items: { type: Type.STRING } },
                analysis: { type: Type.STRING }
              }
            },
          }
        });

        logAiUsage({
          requestId: powerLiftRequestId,
          userId: req.userId,
          feature: 'POWERLIFT_VIDEO_AUDIT',
          model: powerLiftModel,
          ...extractUsage(response),
          durationMs: Date.now() - powerLiftStartedAt,
          success: true,
          contextSize: promptText.length
        }).catch(() => {});

        const parsed = JSON.parse(response.text || '{}');
        const confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0));
        const estimatedWeightRaw = Number(parsed.estimatedWeight);
        const estimatedWeight = Number.isFinite(estimatedWeightRaw) && estimatedWeightRaw > 0
          ? Math.round(estimatedWeightRaw * 100) / 100
          : declaredWeight;
        const status = String(parsed.status || '').toUpperCase();
        const motives = cleanPowerMotives(parsed.motivos);
        const analysis = typeof parsed.analysis === 'string'
          ? parsed.analysis.trim().slice(0, 2000)
          : 'Auditoria automática concluída.';
        const weightConsistent = Math.abs(estimatedWeight - declaredWeight) <= Math.max(5, declaredWeight * 0.10);
        const approved = parsed.isValid === true && status === 'VALIDADO' && confidence >= 98 && weightConsistent && frames.length >= 8;
        const decision: PowerDecision = approved
          ? 'approved'
          : status === 'REPROVADO' || (!weightConsistent && confidence < 80)
            ? 'rejected'
            : 'manual_review';

        return res.status(200).json(await powerValidationResponse({
          userId: req.userId!,
          exercise: exercise as 'supino' | 'agachamento' | 'terra',
          weight: declaredWeight,
          decision,
          confidence,
          estimatedWeight,
          motives: motives.length ? motives : [analysis],
          analysis
        }));
      } catch (gemErr: any) {
        logAiUsage({
          requestId: newAiRequestId(),
          userId: req.userId,
          feature: 'POWERLIFT_VIDEO_AUDIT',
          model: getAiVisionModel(),
          durationMs: 0,
          success: false,
          errorCode: gemErr?.message ? String(gemErr.message).slice(0, 200) : 'unknown_error'
        }).catch(() => {});
        console.warn('[validate-activity] Power video Gemini audit warning:', gemErr?.message || 'erro desconhecido');
        return res.status(200).json(await manual('A auditoria automática falhou; o vídeo seguirá para revisão manual.'));
      }
    }

    const result = await validateActivityService.execute({
      userId: req.userId!,
      activityData
    });

    return res.status(200).json(result);
  } catch (error: any) {
    return errorHandler(error, res);
  }
}
