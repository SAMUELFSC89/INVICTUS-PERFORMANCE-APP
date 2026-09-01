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
import { GoogleGenAI, Type } from "@google/genai";
import { db } from '../_lib/common.js';
import { resolveClientSampledFramesStatus } from '../_lib/powerlift-audit.js';
import { getAiApiKey, getAiTextModel } from '../_lib/ai-config.js';

// Instanciar repositórios e serviços (Injeção de Dependência)
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
const MAX_POWER_FRAME_BASE64_LENGTH = 1_500_000;

type PowerDecision = 'approved' | 'manual_review' | 'rejected';

function cleanPowerMotives(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * A validação de frames e o posterior upload do vídeo são etapas distintas no
 * cliente. Esta sessão, emitida apenas pelo backend, liga as duas etapas para
 * que /api/powerlift nunca aceite uma decisão/score forjado pelo dispositivo.
 */
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
    // Sem uma sessão imutável, o PowerLift não pode aplicar o resultado de IA
    // à gravação posterior. Em vez de aprovar no escuro, rebaixa a revisão.
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
    // 1. Middlewares de infraestrutura e segurança
    if (corsMiddleware(req, res)) return;
    if (!methodMiddleware(req, res, ['POST'])) return;
    if (!(await authMiddleware(req, res))) return;

    // 2. Extrair payload do request
    const payload = req.body || {};
    const activityData = req.body.activityData || req.body;
    const type = payload.type || activityData?.type;

    // PowerLift nunca cai no fluxo genérico de treino/XP. A decisão é criada
    // e persistida pelo servidor e depois consumida por /api/powerlift.
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
      if (frames.some((frame) => frame.length > MAX_POWER_FRAME_BASE64_LENGTH)) {
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

        const response = await ai.models.generateContent({
          model: getAiTextModel(),
          contents: [promptText, ...imageParts],
          config: {
            responseMimeType: 'application/json',
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
        console.warn('[validate-activity] Power video Gemini audit warning:', gemErr?.message || 'erro desconhecido');
        return res.status(200).json(await manual('A auditoria automática falhou; o vídeo seguirá para revisão manual.'));
      }
    }

    // #224 - VALIDACAO DE FOTO POR IA MIGRADA PARA O SERVIDOR.
    //
    // Antes o frontend (src/services/validationService.ts) chamava o Gemini
    // direto do navegador. Isso obrigava o vite.config.ts a embutir a
    // GEMINI_API_KEY no bundle publico -- qualquer pessoa conseguia abrir o JS
    // do site e extrair a chave. Alem disso, validacao de atividade rodando no
    // cliente e falsificavel: bastava adulterar a resposta no proprio aparelho
    // para homologar um treino que nunca aconteceu.
    //
    // Comportamento fail-closed preservado: sem IA disponivel, sem imagem ou em
    // caso de erro, a atividade vai para revisao manual e NAO recebe pontos.
    if (type === 'image_validation') {
      const imageType = payload.imageType === 'diet' || payload.imageType === 'cardio' ? payload.imageType : 'workout';
      const base64 = String(payload.photoBase64 || '').replace(/^data:image\/\w+;base64,/, '');

      const revisaoManual = {
        isValid: false,
        status: 'pending_review',
        requiresManualReview: true,
        pointsAwarded: 0,
        reason: 'AI_VALIDATION_UNAVAILABLE',
        analysis: 'Sua atividade foi recebida e está em análise. Não foi possível concluir a validação automática neste momento.',
        confidence: 0
      };

      if (!ai || !base64) {
        return res.status(200).json(revisaoManual);
      }

      const promptImagem = imageType === 'workout'
        ? "Você é um inspetor de academia rigoroso. Analise esta imagem. Ela mostra de forma clara e inequívoca um ambiente de academia (aparelhos, pesos, sala de aula) ou uma pessoa visivelmente praticando exercícios? REJEITE e considere 'isValid: false' se for apenas uma selfie de rosto sem contexto, fotos de casa, objetos aleatórios ou ambientes não-fitness. Responda em JSON com 'isValid' (boolean), 'analysis' (string curto e direto em português) e 'confidence' (0-100)."
        : imageType === 'diet'
          ? "Você é um nutricionista avaliando a adesão à dieta. Esta imagem mostra uma refeição real preparada (prato de comida, salada, frutas, lanche saudável)? REJEITE e considere 'isValid: false' se for uma foto de ambiente, uma embalagem fechada, uma pessoa, um animal, objetos aleatórios, telas de computador ou fotos da internet. Deve ser comida real pronta para consumo. Responda em JSON com 'isValid' (boolean), 'analysis' (string curto e direto em português) e 'confidence' (0-100)."
          : "Você é um monitor de desempenho esportivo. Analise esta imagem. Ela mostra de forma clara um contexto de atividade física (pessoa suada, roupa de treino, pista de corrida, parque, academia ou o visor de uma esteira/bike)? REJEITE se for uma foto sem contexto de esforço físico, fotos de ambientes internos comuns, animais, carros ou fotos da internet. Responda em JSON com 'isValid' (boolean), 'analysis' (string curto e direto em português) e 'confidence' (0-100).";

      try {
        const respostaIA = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: {
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: base64 } },
              { text: promptImagem }
            ]
          },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                isValid: { type: Type.BOOLEAN },
                analysis: { type: Type.STRING },
                confidence: { type: Type.NUMBER }
              },
              required: ["isValid", "analysis", "confidence"]
            }
          }
        });

        const resultado = JSON.parse(respostaIA.text || '{}');
        return res.status(200).json({
          isValid: resultado.isValid === true,
          analysis: resultado.analysis || "Não foi possível analisar a imagem.",
          confidence: Number(resultado.confidence) || 0
        });
      } catch (imgErr: any) {
        console.warn('[validate-activity] image_validation Gemini error:', imgErr?.message);
        return res.status(200).json(revisaoManual);
      }
    }

    // 3. Executar lógica de negócio no Service de Domínio para atividades padrão
    const result = await validateActivityService.execute({
      userId: req.userId!,
      activityData
    });

    // 4. Retornar resposta HTTP 200 de sucesso. O objeto `result` ja vem no formato
    // plano (workout/validation/message/userMessage na raiz) que o frontend
    // (activityService.ts / Challenges.tsx) espera -- ver validate-activity-service.ts.
    // Antes isso era envolvido em { success: true, data: result }, fazendo o frontend
    // nunca enxergar respData.workout / respData.validation / respData.userMessage
    // (sempre undefined), entao a tela de resumo do cardio nunca mostrava pontos reais,
    // pace, distancia ou a mensagem de homologacao/rejeicao.
    return res.status(200).json(result);
  } catch (error: any) {
    return errorHandler(error, res);
  }
}
