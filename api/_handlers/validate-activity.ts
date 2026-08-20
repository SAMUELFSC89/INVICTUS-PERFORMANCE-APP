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