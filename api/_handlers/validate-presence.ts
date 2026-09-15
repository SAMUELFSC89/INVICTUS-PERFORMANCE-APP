import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth, FieldValue } from '../_lib/common.js';
import { logEvent } from '../_lib/observability.js';
import { GoogleGenAI } from '@google/genai';
import { criarInscricaoChampionship } from '../_lib/championship-inscription-service.js';
import { WithdrawalEngine } from '../_lib/withdrawal-engine.js';
import { getAiPresenceModel } from '../_lib/ai-config.js';
import { extractUsage, logAiUsage, newAiRequestId } from '../_lib/ai-usage-logger.js';

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const ai = new GoogleGenAI(apiKey ? {
  apiKey,
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
} : {
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
});

const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
const TRUSTED_REFERENCE_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
]);

type BiometricConfidence = 'high' | 'medium' | 'low';
interface BiometricResult {
  livenessConfidence: BiometricConfidence;
  identityConfidence: BiometricConfidence;
  presenceConfidence: number;
  livenessMatched: boolean;
  identityMatched: boolean;
  reason: string;
}

function isConfidence(value: unknown): value is BiometricConfidence {
  return value === 'high' || value === 'medium' || value === 'low';
}

function parseBiometricResult(responseText: string): BiometricResult | null {
  try {
    const parsed = JSON.parse(responseText) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!isConfidence(parsed.livenessConfidence) || !isConfidence(parsed.identityConfidence)) return null;
    if (typeof parsed.presenceConfidence !== 'number'
      || !Number.isFinite(parsed.presenceConfidence)
      || parsed.presenceConfidence < 0
      || parsed.presenceConfidence > 100) return null;
    if (typeof parsed.livenessMatched !== 'boolean' || typeof parsed.identityMatched !== 'boolean') return null;
    if (typeof parsed.reason !== 'string' || !parsed.reason.trim()) return null;

    return {
      livenessConfidence: parsed.livenessConfidence,
      identityConfidence: parsed.identityConfidence,
      presenceConfidence: parsed.presenceConfidence,
      livenessMatched: parsed.livenessMatched,
      identityMatched: parsed.identityMatched,
      reason: parsed.reason.trim().slice(0, 1000),
    };
  } catch {
    return null;
  }
}

async function fetchTrustedReferencePhoto(photoURL: unknown): Promise<string | null> {
  if (typeof photoURL !== 'string' || !photoURL.trim()) return null;
  if (photoURL.startsWith('data:image')) return photoURL.split(',')[1] || null;

  let parsed: URL;
  try {
    parsed = new URL(photoURL);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !TRUSTED_REFERENCE_HOSTS.has(parsed.hostname)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return null;
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REFERENCE_IMAGE_BYTES) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_REFERENCE_IMAGE_BYTES) return null;
    return bytes.toString('base64');
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function findReferencePhoto(userId: string, userData: Record<string, any>): Promise<{
  base64: string | null;
  source: string;
}> {
  const profileReference = await fetchTrustedReferencePhoto(userData.photoURL);
  if (profileReference) {
    return {
      base64: profileReference,
      source: typeof userData.photoURL === 'string' && userData.photoURL.startsWith('data:image')
        ? 'profile_data_url'
        : 'profile_storage_url',
    };
  }

  try {
    const recentWorkoutsDocs = await db.collection('workouts')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(8)
      .get();

    for (const document of recentWorkoutsDocs.docs) {
      const workout = document.data() || {};
      const reference = await fetchTrustedReferencePhoto(workout.photoUrl);
      if (reference) return { base64: reference, source: `workout_photo_${document.id}` };
    }
  } catch (error) {
    console.warn('[Presence Verification] Não foi possível obter foto de referência de treino:', error);
  }

  return { base64: null, source: 'none' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, userMessage: 'Método não permitido.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({
      success: false,
      userMessage: 'Sessão expirada. Entre novamente para confirmar sua presença.',
    });
  }

  const presenceCheckId = typeof req.body?.presenceCheckId === 'string' ? req.body.presenceCheckId.trim() : '';
  const photoBase64 = typeof req.body?.photoBase64 === 'string' ? req.body.photoBase64.trim() : '';
  if (!presenceCheckId || !photoBase64) {
    return res.status(400).json({
      success: false,
      userMessage: 'ID de verificação e foto selfie são obrigatórios.',
    });
  }

  let pendingCheckRef: any;
  try {
    pendingCheckRef = db.collection('pending_presence_checks').doc(presenceCheckId);
    const pendingCheckSnap = await pendingCheckRef.get();
    if (!pendingCheckSnap.exists) {
      return res.status(404).json({
        success: false,
        userMessage: 'Solicitação de presença expirada ou não encontrada.',
      });
    }

    const checkData = pendingCheckSnap.data() || {};
    if (checkData.status !== 'pending') {
      return res.status(409).json({
        success: false,
        userMessage: 'Esta verificação de presença já foi processada ou está em processamento.',
      });
    }
    if (checkData.userId !== auth.uid) {
      return res.status(403).json({
        success: false,
        userMessage: 'Acesso negado. Esta verificação pertence a outro usuário.',
      });
    }

    const actionType = String(checkData.actionType || '');
    if (!['championship_registration', 'withdrawal'].includes(actionType)) {
      await pendingCheckRef.update({
        status: 'unsupported_activity_flow',
        completedAt: new Date().toISOString(),
      });
      return res.status(409).json({
        success: false,
        userMessage: 'Esta confirmação pertence a uma versão antiga do fluxo. Atualize o app e tente novamente.',
      });
    }

    const expiresAt = new Date(checkData.expiredAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt < new Date()) {
      await pendingCheckRef.update({ status: 'expired', completedAt: new Date().toISOString() });
      return res.status(400).json({
        success: false,
        userMessage: 'O tempo da confirmação expirou. Inicie o processo novamente.',
      });
    }

    try {
      await db.runTransaction(async (transaction: any) => {
        const freshSnap = await transaction.get(pendingCheckRef);
        const freshData = freshSnap.data() || {};
        if (!freshSnap.exists || freshData.status !== 'pending' || freshData.userId !== auth.uid) {
          throw new Error('ALREADY_CLAIMED');
        }
        transaction.update(pendingCheckRef, {
          status: 'processing',
          claimedAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (claimError: any) {
      if (claimError?.message === 'ALREADY_CLAIMED') {
        return res.status(409).json({
          success: false,
          userMessage: 'Esta verificação já está sendo processada ou foi concluída.',
        });
      }
      throw claimError;
    }

    const userId = auth.uid;
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) throw new Error('Perfil do usuário não encontrado.');
    const userData = userSnap.data() || {};

    const reference = await findReferencePhoto(userId, userData);
    const cleanSelfieBase64 = photoBase64.startsWith('data:image') ? photoBase64.split(',')[1] : photoBase64;
    if (!cleanSelfieBase64 || cleanSelfieBase64.length > 8_000_000) {
      throw new Error('A selfie enviada é inválida ou excede o limite permitido.');
    }

    const parts: any[] = [{
      inlineData: { mimeType: 'image/jpeg', data: cleanSelfieBase64 },
    }];
    if (reference.base64) {
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: reference.base64 } });
    }

    const systemInstruction =
      'Você é um sistema antifraude de biometria para um aplicativo fitness. ' +
      'Analise prova de vida, replay/fraude e, quando houver imagem de referência, correspondência de identidade. ' +
      'Nunca invente confiança quando evidência suficiente não existir.';

    const promptText =
      `IMAGEM 1: selfie atual do usuário.\n` +
      `${reference.base64 ? 'IMAGEM 2: foto de referência anterior do mesmo perfil.\n' : 'IMAGEM 2 AUSENTE: identityMatched deve ser false e identityConfidence deve ser low.\n'}` +
      `GESTO SOLICITADO: ${String(checkData.livenessPrompt || 'gesto não informado').slice(0, 200)}\n\n` +
      'Retorne SOMENTE JSON válido, sem markdown, com todos os campos obrigatórios:\n' +
      '{"livenessConfidence":"high|medium|low","identityConfidence":"high|medium|low",' +
      '"presenceConfidence":0,"livenessMatched":false,"identityMatched":false,"reason":"..."}\n' +
      'presenceConfidence deve ser número entre 0 e 100; os dois campos *Matched devem ser booleanos reais.';
    parts.push({ text: promptText });

    const presenceModel = getAiPresenceModel();
    const presenceRequestId = newAiRequestId();
    const presenceStartedAt = Date.now();
    let geminiResponse: any;
    try {
      geminiResponse = await ai.models.generateContent({
        model: presenceModel,
        contents: { parts },
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
        },
      });
      logAiUsage({
        requestId: presenceRequestId,
        userId,
        feature: 'PRESENCE_BIOMETRIC_CHECK',
        model: presenceModel,
        ...extractUsage(geminiResponse),
        durationMs: Date.now() - presenceStartedAt,
        success: true,
        contextSize: promptText.length,
      }).catch(() => {});
    } catch (apiError: any) {
      logAiUsage({
        requestId: presenceRequestId,
        userId,
        feature: 'PRESENCE_BIOMETRIC_CHECK',
        model: presenceModel,
        durationMs: Date.now() - presenceStartedAt,
        success: false,
        errorCode: apiError?.message ? String(apiError.message).slice(0, 200) : 'unknown_error',
      }).catch(() => {});
      console.error('[Verified Presence API] Gemini processing error:', apiError);
      throw new Error('O serviço biométrico está temporariamente indisponível. Tente novamente.');
    }

    const responseText = String(geminiResponse?.text || '').trim();
    const biometrics = parseBiometricResult(responseText);
    const schemaValid = biometrics !== null;

    const livenessConfidence: BiometricConfidence = biometrics?.livenessConfidence ?? 'low';
    const identityConfidence: BiometricConfidence = biometrics?.identityConfidence ?? 'low';
    const presenceConfidence = biometrics?.presenceConfidence ?? 0;
    const livenessMatched = biometrics?.livenessMatched === true;
    const identityMatched = reference.base64 ? biometrics?.identityMatched === true : false;
    const aiReason = biometrics?.reason
      || 'A resposta biométrica não apresentou evidência estruturada suficiente para aprovação automática.';

    let finalDecision: 'approved' | 'pending' | 'rejected' = 'pending';
    let friendlyResultMessage = 'Não conseguimos confirmar sua identidade automaticamente. A solicitação não foi autorizada e precisa de nova validação.';

    if (schemaValid && reference.base64) {
      if (presenceConfidence < 40 || !livenessMatched) {
        finalDecision = 'rejected';
        friendlyResultMessage = 'Não foi possível confirmar sua presença. Faça uma nova tentativa seguindo o gesto solicitado.';
      } else if (presenceConfidence >= 72 && identityMatched) {
        finalDecision = 'approved';
        friendlyResultMessage = 'Presença e identidade confirmadas com sucesso.';
      }
    } else if (!reference.base64) {
      friendlyResultMessage = 'Precisamos de uma foto de perfil válida para comparar sua identidade antes desta operação. Atualize sua foto e tente novamente.';
    }

    await pendingCheckRef.update({
      status: finalDecision,
      presenceConfidence,
      identityConfidence,
      livenessConfidence,
      livenessMatched,
      identityMatched,
      biometricSchemaValid: schemaValid,
      finalDecision,
      completedAt: new Date().toISOString(),
      biometricReason: aiReason,
      referenceSource: reference.source,
    });

    const workoutPayload = checkData.workoutPayload || {};
    let commitResult: any = undefined;

    if (actionType === 'championship_registration' && finalDecision === 'approved') {
      const championshipId = String(workoutPayload.championshipId || '').trim();
      const acceptanceId = String(workoutPayload.acceptanceId || '').trim();
      const checkoutSurface = String(workoutPayload.checkoutSurface || '').trim();
      if (!championshipId || !acceptanceId || !['ios_native', 'web'].includes(checkoutSurface)) {
        throw new Error('Dados da inscrição de campeonato inválidos ou incompletos.');
      }
      commitResult = await criarInscricaoChampionship(
        userId,
        championshipId,
        acceptanceId,
        checkoutSurface as 'ios_native' | 'web',
      );
    }

    if (actionType === 'withdrawal' && finalDecision === 'approved') {
      commitResult = await WithdrawalEngine.requestWithdrawal({ ...workoutPayload, userId });
    }

    if (finalDecision === 'approved' && presenceConfidence >= 85 && reference.source === 'none') {
      try {
        await userRef.update({
          photoURL: `data:image/jpeg;base64,${cleanSelfieBase64}`,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (error) {
        console.warn('[Presence Verification] Falha ao atualizar referência de perfil:', error);
      }
    }

    try {
      await logEvent({
        severity: finalDecision === 'approved' ? 'INFO' : finalDecision === 'pending' ? 'WARNING' : 'HIGH_RISK',
        category: 'fraud_audit_logs',
        message: `Biometria de presença concluída com decisão '${finalDecision}' (Score: ${presenceConfidence}) para usuário ${userId}`,
        userId,
        route: '/api/validate-presence',
        details: {
          presenceCheckId,
          actionType,
          presenceConfidence,
          identityConfidence,
          livenessConfidence,
          livenessMatched,
          identityMatched,
          biometricSchemaValid: schemaValid,
          referenceSource: reference.source,
          finalDecision,
        },
      });
    } catch {}

    return res.json({
      success: true,
      status: finalDecision,
      finalDecision,
      presenceConfidence,
      identityConfidence,
      livenessConfidence,
      userMessage: friendlyResultMessage,
      reason: aiReason,
      commitResult,
    });
  } catch (error: any) {
    console.error('[Presence Checker Endpoint Error]:', error);
    try {
      if (pendingCheckRef) {
        const recheckSnap = await pendingCheckRef.get();
        if (recheckSnap.exists && recheckSnap.data()?.status === 'processing') {
          await pendingCheckRef.update({ status: 'pending' });
        }
      }
    } catch {}

    return res.status(500).json({
      success: false,
      userMessage: error?.message || 'Erro inesperado ao validar sua foto de presença.',
    });
  }
}
