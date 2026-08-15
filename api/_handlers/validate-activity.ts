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

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

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

    // Handling Power Video Validation with Gemini AI
    if (type === 'power_video') {
      const { exercise, exerciseName, weight, weightKg, reps, photoBase64, framesBase64 } = payload;
      const exName = exercise || exerciseName || 'Power Lift';
      const declaredWeight = weight || weightKg || 0;

      const frames: string[] = Array.isArray(framesBase64) && framesBase64.length > 0
        ? framesBase64
        : photoBase64 ? [photoBase64] : [];

      if (ai && frames.length > 0) {
        try {
          const imageParts = frames.map(f => {
            const cleanBase64 = f.replace(/^data:image\/\w+;base64,/, '');
            return {
              inlineData: {
                data: cleanBase64,
                mimeType: 'image/jpeg'
              }
            };
          });

          const promptText = `# AUDITORIA TÉCNICA OFICIAL POWER LIFT INVICTUS IA

Você é o auditor biomecânico e antifraude oficial do Invictus Power Lift.
Valide a submissão de vídeo de levantamento de força conforme os dados declarados e as REGRAS MANDATÓRIAS abaixo.

DADOS DECLARADOS:
- Exercício Declarado: ${exName}
- Carga Declarada: ${declaredWeight} kg
- Repetições: ${reps || 1}

--------------------------------------------------
REGRAS OBRIGATÓRIAS DE VALIDAÇÃO (POWER LIFT)
--------------------------------------------------
1. EXIBIÇÃO DA PRIMEIRA ANILHA NO INÍCIO DO VÍDEO:
O vídeo DEVE obrigatoriamente abrir/iniciar mostrando claramente o peso gravado/impresso na primeira anilha (ex: "20kg", "15kg", "25kg", "45lb").
2. MÚLTIPLAS ANILHAS:
Se houver mais de uma anilha de cada lado da barra, exige-se apenas a exibição nítida da marcação da primeira anilha no início. No entanto, o atleta DEVE informar (falado no áudio do vídeo ou por texto sobreposto na tela) o valor total combinado das demais anilhas.
3. CONTINUIDADE SEM CORTES OU EDIÇÕES:
O vídeo deve ser 100% contínuo desde a exibição inicial do peso na primeira anilha até a conclusão total do levantamento (lockout), sem cortes, edições, acelerações, pausas ou transições de câmera.
4. AMBIENTE E BIOMECÂNICA:
Ambiente de academia real. Exercício correto (${exName}) com amplitude técnica completa (Supino: barra toca peito + lockout; Agachamento: quadril abaixo do joelho + lockout; Terra: extensão completa de joelhos e quadril no topo).
5. ANTIFRAUDE:
Qualquer suspeita de vídeo editado, gravação de tela, deepfake ou ausência da exibição inicial do peso da anilha deve resultar em REPROVADO ou AUDITORIA_MANUAL.

Retorne estritamente o JSON com a avaliação.`;

          const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: [promptText, ...imageParts],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  status: { type: Type.STRING },
                  isValid: { type: Type.BOOLEAN },
                  confidence: { type: Type.NUMBER },
                  exercise: { type: Type.STRING },
                  estimatedWeight: { type: Type.NUMBER },
                  motivos: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  },
                  analysis: { type: Type.STRING }
                }
              },
              temperature: 0.1
            }
          });

          const parsed = JSON.parse(response.text || '{}');
          const confidence = parsed.confidence || 0;
          const statusStr = (parsed.status || '').toUpperCase();
          const isValid = statusStr === 'VALIDADO' || (parsed.isValid === true && confidence >= 95);
          const isManualReview = statusStr === 'AUDITORIA_MANUAL' || (!isValid && confidence >= 80);

          const auditResult = isValid ? 'VALIDADO' : isManualReview ? 'AUDITORIA_MANUAL' : 'REPROVADO';
          const motivos = parsed.motivos || [parsed.analysis || 'Validação concluída.'];

          return res.status(200).json({
            success: true,
            isValid,
            isManualReview,
            auditResult,
            confidence,
            estimatedWeight: parsed.estimatedWeight || declaredWeight,
            motivos,
            analysis: parsed.analysis || `STATUS: ${auditResult}\nCONFIANÇA: ${confidence}%`
          });
        } catch (gemErr: any) {
          console.warn('[validate-activity] Power video Gemini audit warning:', gemErr?.message);
        }
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
