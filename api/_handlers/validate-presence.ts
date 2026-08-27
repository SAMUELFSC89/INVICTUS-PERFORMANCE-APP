import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  db,
  cors,
  verifyAuth,
  FieldValue
} from '../_lib/common.js';
import { logEvent } from '../_lib/observability.js';
import { GoogleGenAI } from "@google/genai";
import { readActiveHabitGoal, applyHabitProgressWithGoal } from '../_lib/habit-integration.js';
import { recalculateAllUserScores } from '../_lib/igaService.js';
import { buscarHistoricoRecente } from '../_lib/user-activity-history.js';
import { SCORE_CONFIG } from '../_lib/score-config.js';
import { GPSValidator } from '../_lib/fraud-detection/gps-validator.js';
import { SecurityPipeline } from '../_lib/security-pipeline.js';
import { estimateCalories, formatPace } from '../_lib/activity-metrics.js';

// Initialize Gemini API
const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const ai = new GoogleGenAI(apiKey ? {
  apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
} : {
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      userMessage: "Método não permitido."
    });
  }

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({
      success: false,
      userMessage: "Sessão expirada. Entre novamente para confirmar sua presença."
    });
  }

  const { presenceCheckId, photoBase64 } = req.body;

  if (!presenceCheckId || !photoBase64) {
    return res.status(400).json({
      success: false,
      userMessage: "ID de verificação e foto selfie são obrigatórios."
    });
  }

  let pendingCheckRef: any;
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        userMessage: "Banco de dados indisponível no momento."
      });
    }

    // 1. Fetch the pending check record
    pendingCheckRef = db.collection('pending_presence_checks').doc(presenceCheckId);
    const pendingCheckSnap = await pendingCheckRef.get();

    if (!pendingCheckSnap.exists) {
      return res.status(404).json({
        success: false,
        userMessage: "Solicitação de presença expirada ou não encontrada para esta atividade."
      });
    }

    const checkData = pendingCheckSnap.data() || {};

    if (checkData.status !== 'pending') {
      return res.status(400).json({
        success: false,
        userMessage: "Esta verificação de presença já foi processada."
      });
    }

    // Ensure it belongs to the authenticated user
    if (checkData.userId !== auth.uid) {
      return res.status(403).json({
        success: false,
        userMessage: "Acesso negado. Esta verificação pertence a outro usuário."
      });
    }

    // Check expiry
    const now = new Date();
    if (new Date(checkData.expiredAt) < now) {
      await pendingCheckRef.update({ status: 'expired' });
      return res.status(400).json({
        success: false,
        userMessage: "Tempo limite de 15 minutos expirado. Realize uma nova atividade para registrar seus pontos."
      });
    }

    // Reivindicar atomicamente este registro ANTES de qualquer trabalho lento
    // (a verificacao de vivacidade/identidade via IA abaixo pode levar varios
    // segundos). Sem isso, duas requisicoes quase simultaneas para o mesmo
    // presenceCheckId podiam passar pela checagem de status acima (uma leitura
    // simples, nao atomica) e as duas seguirem para pontuar a mesma atividade
    // duas vezes (XP duplicado). A transacao abaixo relê o status de forma
    // atomica e so permite que o primeiro chamador reivindique o registro.
    try {
      await db.runTransaction(async (transaction: any) => {
        const freshSnap = await transaction.get(pendingCheckRef);
        const freshData = freshSnap.data() || {};
        if (!freshSnap.exists || freshData.status !== 'pending') {
          throw new Error('ALREADY_CLAIMED');
        }
        transaction.update(pendingCheckRef, { status: 'processing', claimedAt: FieldValue.serverTimestamp() });
      });
    } catch (claimErr: any) {
      if (claimErr?.message === 'ALREADY_CLAIMED') {
        return res.status(409).json({
          success: false,
          userMessage: "Esta verificacao de presenca ja esta sendo processada ou ja foi concluida."
        });
      }
      throw claimErr;
    }

    const userId = auth.uid;

    // 2. Fetch reference photo for identity comparison (face matching)
    let referencePhotoBase64: string | null = null;
    let referenceSource = 'none';

    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    const userData = userSnap.data() || {};

    if (userData.photoURL && userData.photoURL.startsWith('data:image')) {
      referencePhotoBase64 = userData.photoURL.split(',')[1] || userData.photoURL;
      referenceSource = 'profile_url';
    } else if (userData.photoURL && userData.photoURL.startsWith('http')) {
      // In case we can't download external url easily, we will prioritize firestore workout photos
      referenceSource = 'profile_http_url';
    }

    // Fallback: look up last successful workout with a base64 selfie
    if (!referencePhotoBase64) {
      const recentWorkoutsDocs = await db.collection('workouts')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(8)
        .get();

      for (const doc of recentWorkoutsDocs.docs) {
        const wData = doc.data();
        if (wData.photoUrl && wData.photoUrl.startsWith('data:image')) {
          referencePhotoBase64 = wData.photoUrl.split(',')[1] || wData.photoUrl;
          referenceSource = `workout_photo_${doc.id}`;
          break;
        }
      }
    }

    // 3. Invoke server-side Gemini API with multimodal prompt
    const cleanSelfieBase64 = photoBase64.startsWith('data:image') ? photoBase64.split(',')[1] : photoBase64;

    const parts: any[] = [
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: cleanSelfieBase64
        }
      }
    ];

    if (referencePhotoBase64) {
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: referencePhotoBase64
        }
      });
    }

    const systemInstruction =
      "Você é um engenheiro sênior e de inteligência artificial de biometria antifraude focado em fisiculturismo e aplicativos fitness.\n" +
      "Seu objetivo é analisar as imagens fornecidas para validar a presença física (prova de vida) e a correspondência de identidade do usuário logado.";

    const promptText =
      `Instruções técnicas para análise de selfie biométrica:\n` +
      `IMAGEM 1: A selfie tirada ao vivo pelo usuário para a confirmação de presença.\n` +
      `${referencePhotoBase64 ? 'IMAGEM 2: A foto de referência anterior do usuário armazenada no banco de dados.\n' : 'Nenhuma imagem de referência armazenada anterior. Faça uma análise focada em prova de vida (liveness).\n'}\n` +
      `TAREFAS:\n` +
      `1. PROVA DE VIDA (Liveness): O usuário foi solicitado a fazer este gesto na selfie: "${checkData.livenessPrompt}". Ele realizou o gesto com sucesso na Imagem 1? Detecte movimentos faciais naturais, iluminação, profundidade e texturas para atestar que é um humano vivo jogando o gesto.\n` +
      `2. DETECÇÃO DE REPLAY/FRAUDE: Identifique fraudes como: foto de outra tela, foto impressa em papel, filtros artificiais ou imagem estática de foto antiga.\n` +
      `3. COMPARAÇÃO FACIAL (De Identidade): ${referencePhotoBase64 ? 'As duas fotos fornecidas pertencem à mesma pessoa? Analise olhos, nariz, boca, maçãs do rosto e estrutura óssea do rosto.' : 'Ausência de modelo prévio para comparação. Marcar o nível de identidade como baseline "high" para bootstrapper seguro.'}\n\n` +
      `Retorne estritamente um objeto JSON com o seguinte formato:\n` +
      `{\n` +
      `  "livenessConfidence": "high" | "medium" | "low",\n` +
      `  "identityConfidence": "high" | "medium" | "low",\n` +
      `  "presenceConfidence": 0 a 100, // Score numérico final condensado de confiança física\n` +
      `  "livenessMatched": true | false, // Se o gesto requerido foi concluído\n` +
      `  "identityMatched": true | false, // Se as características faciais conferem com o perfil\n` +
      `  "reason": "uma explicação curta em português, amigável e técnica, justificando seu diagnóstico"\n` +
      `}`;

    parts.push({ text: promptText });

    let geminiResponse;
    try {
      geminiResponse = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: { parts },
        config: {
          systemInstruction,
          responseMimeType: "application/json"
        }
      });
    } catch (apiErr: any) {
      console.error('[Verified Presence API] Gemini processing error:', apiErr);
      throw new Error(`Servidor de análise biométrica temporariamente ocupado: ${apiErr.message}`);
    }

    const responseText = geminiResponse.text?.trim() || '{}';
    let biometrics: any = {};
    try {
      biometrics = JSON.parse(responseText);
    } catch (_) {
      console.warn('[Verified Presence API] JSON parse error in response:', responseText);
      biometrics = {
        livenessConfidence: "medium",
        identityConfidence: "medium",
        presenceConfidence: 70,
        livenessMatched: true,
        identityMatched: true,
        reason: "Validação mecânica em andamento devido a flutuação nas leituras primárias."
      };
    }

    // Extract metrics parameters
    const livenessConfidence = biometrics.livenessConfidence || 'medium';
    const identityConfidence = biometrics.identityConfidence || 'medium';
    const presenceConfidence = biometrics.presenceConfidence ?? 75;
    const livenessMatched = biometrics.livenessMatched !== false;
    const identityMatched = biometrics.identityMatched !== false;
    const aiReason = biometrics.reason || "Confirmação biométrica revisada via telemetria.";

    // Determine Final Decision based on criteria
    let finalDecision: 'approved' | 'pending' | 'rejected' = 'approved';
    let friendlyResultMessage = "Presença confirmada com sucesso.";

    if (presenceConfidence < 40 || !livenessMatched) {
      finalDecision = 'rejected';
      friendlyResultMessage = "Não foi possível concluir a confirmação de presença desta atividade.";
    } else if (presenceConfidence < 72 || !identityMatched) {
      finalDecision = 'pending';
      friendlyResultMessage = "Não conseguimos confirmar sua presença automaticamente. Sua atividade foi enviada para análise.";
    }

    // Save metrics on checking collection
    await pendingCheckRef.update({
      status: finalDecision,
      presenceConfidence,
      identityConfidence,
      livenessConfidence,
      finalDecision,
      completedAt: new Date().toISOString(),
      biometricReason: aiReason,
      referenceSource
    });

    const workoutPayload = checkData.workoutPayload || {};

    // 4. APPROVED PATH: Let's execute standard workout or running points commit
    if (finalDecision === 'approved' || finalDecision === 'pending') {
      const isRunning = checkData.workoutPayload?.km !== undefined || (checkData.type === 'running');

      if (isRunning) {
        // Submit run tracking session to db
        await commitRunningSession(userId, workoutPayload, finalDecision);
      } else {
        // Submit standard gym workout/cardio to db
        await commitWorkoutSession(userId, workoutPayload, finalDecision, cleanSelfieBase64);
      }
    }

    // Save new profile reference if passing high-confidence
    if (finalDecision === 'approved' && presenceConfidence >= 85 && (!userData.photoURL || !userData.photoURL.startsWith('data:image'))) {
      try {
        await userRef.update({
          photoURL: `data:image/jpeg;base64,${cleanSelfieBase64}`,
          updatedAt: FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.warn('[Presence Verification] Failed to update profile photo reference:', err);
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
          presenceConfidence,
          identityConfidence,
          livenessConfidence,
          finalDecision,
          aiReason
        }
      });
    } catch (_) {}

    return res.json({
      success: true,
      status: finalDecision,
      finalDecision,
      presenceConfidence,
      identityConfidence,
      livenessConfidence,
      userMessage: friendlyResultMessage,
      reason: aiReason
    });

  } catch (error: any) {
    console.error('[Presence Checker Endpoint Error]:', error);
    // Se reivindicamos este registro (status='processing') mas falhamos antes
    // de gravar uma decisao final, devolvemos para 'pending' para permitir
    // uma nova tentativa. Se a decisao final ja foi gravada, NAO mexemos no
    // status (evita reabrir uma verificacao ja pontuada e causar XP duplicado).
    try {
      if (pendingCheckRef) {
        const recheckSnap = await pendingCheckRef.get();
        if (recheckSnap.exists && recheckSnap.data()?.status === 'processing') {
          await pendingCheckRef.update({ status: 'pending' });
        }
      }
    } catch (_) {}

    return res.status(500).json({
      success: false,
      userMessage: error.message || "Erro inesperado ao validar sua foto de presença."
    });
  }
}

// TRANSACTIONALLY COMMIT STANDARD PLAYLOADS FOR WORKOUTS
async function commitWorkoutSession(userId: string, payload: any, finalDecision: 'approved' | 'pending', presenceSelfie: string) {
  const { type, durationMins, distanceKm, photoBase64, checkpoints, hasExercises, aiResult, focus, description, quizAnswers } = payload;
  const nowLocalDate = new Date();
  const todayISO = nowLocalDate.toISOString().split('T')[0];

  const userRef = db.collection('users').doc(userId);
  const workoutRef = db.collection('workouts').doc();
  const stValue = FieldValue.serverTimestamp();

  // Load stats
  const getWeekNo = (date: Date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  };
  const weekId = `${nowLocalDate.getFullYear()}-W${getWeekNo(nowLocalDate)}`;
  const weeklyStatsRef = userRef.collection('weeklyStats').doc(weekId);

  // Enterprise Security Pipeline (ver auditoria antifraude 2026-08). Roda ANTES da
  // transacao de pontuacao pois o pipeline faz suas proprias leituras/escritas no
  // Firestore, que nao podem acontecer dentro de uma transaction alheia. Este e o
  // PRIMEIRO cross-check antifraude de comportamento/dispositivo/sensor para
  // treinos de academia -- antes so havia a checagem de presenca via selfie (IA).
  let workoutSecurityBlocked = false;
  let workoutSecurityReason: string | null = null;
  try {
    let secUserProfile: any = {};
    try {
      const secUserSnap = await userRef.get();
      if (secUserSnap.exists) secUserProfile = secUserSnap.data() || {};
    } catch (secFetchErr) {
      console.warn('[commitWorkoutSession] Falha ao buscar perfil do usuario para o SecurityPipeline:', secFetchErr);
    }

    const securityResult = await SecurityPipeline.runPipeline(
      {
        activityType: (type || 'WORKOUT').toString().toUpperCase(),
        type: (type || 'WORKOUT').toString().toUpperCase(),
        durationMins: Number(durationMins) || 0,
        distanceKm: Number(distanceKm) || 0,
        checkpoints,
        timestamp: nowLocalDate.toISOString(),
        source: 'PRESENCE_VERIFIED',
        avgHeartRate: payload.avgHeartRate,
        steps: payload.steps,
        sensorTelemetry: payload.sensorTelemetry,
        isMockLocation: payload.isMockLocation,
        isEmulator: payload.isEmulator,
        isRooted: payload.isRooted,
        isDeveloperMode: payload.isDeveloperMode
      },
      userId,
      secUserProfile,
      // #237: historico real -- ver api/_lib/user-activity-history.ts.
      await buscarHistoricoRecente(userId)
    );

    if (!securityResult.shouldScore) {
      workoutSecurityBlocked = true;
      workoutSecurityReason = 'SECURITY_PIPELINE_' + securityResult.decision;
      console.warn(`[commitWorkoutSession] SecurityPipeline recusou pontuacao para userId=${userId}: ${workoutSecurityReason}`);
    }
  } catch (secErr) {
    // #203: Fail-closed -- se o motor de seguranca falhar tecnicamente, o commit NAO e aprovado.
    workoutSecurityBlocked = true;
    workoutSecurityReason = 'SECURITY_PIPELINE_ERROR';
    console.error('[commitWorkoutSession] SecurityPipeline.runPipeline falhou, bloqueando por seguranca (fail-closed):', secErr);
  }

  await db.runTransaction(async (transaction: any) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) return;
    const userData = userSnap.data() || {};

    const weeklyStatsSnap = await transaction.get(weeklyStatsRef);
    let weeklyStatsData = weeklyStatsSnap.exists ? weeklyStatsSnap.data() : {
      weekId,
      scoredDays: [],
      totalScoredDays: 0,
      totalPoints: 0
    };

    const scoredDays = weeklyStatsData.scoredDays || [];
    const isDayAlreadyScored = scoredDays.includes(todayISO);

    // Points logic
    let pointsEarned = 0;
    let computedStatus: 'valid' | 'pending_review' | 'invalid' | 'suspicious' = 'valid';

    const subTier = userData.subscriptionTier || 'open';
    const dailyCap = subTier === 'performance' ? 100 : 60;

    if (finalDecision === 'pending') {
      pointsEarned = 0;
      computedStatus = 'pending_review';
    } else if (workoutSecurityBlocked) {
      pointsEarned = 0;
      computedStatus = 'suspicious';
    } else {
      // Calculate points dynamically based on activity parameters (standard base points is 50/35 for performance, 30/20 for open)
      const basePoints = type === 'workout'
        ? (subTier === 'performance' ? 50 : 30)
        : (subTier === 'performance' ? 35 : 20);
      pointsEarned = basePoints;
    }

    // Rate limits on daily score capping
    let todayPoints = 0;
    const todayDocs = await db.collection('workouts')
      .where('userId', '==', userId)
      .where('timestamp', '>=', todayISO)
      .get();

    todayDocs.forEach((d: any) => {
      const w = d.data();
      if (w.status !== 'invalid') todayPoints += w.points || 0;
    });

    if (pointsEarned > 0 && todayPoints + pointsEarned > dailyCap) {
      pointsEarned = Math.max(0, dailyCap - todayPoints);
    }

    let isScoringEligible = false;
    let nonScoringReason = null;

    if (pointsEarned > 0) {
      if (isDayAlreadyScored) {
        isScoringEligible = true;
      } else if (scoredDays.length < 5) {
        isScoringEligible = true;
        scoredDays.push(todayISO);
        weeklyStatsData.scoredDays = scoredDays;
        weeklyStatsData.totalScoredDays = scoredDays.length;
      } else {
        isScoringEligible = false;
        nonScoringReason = "WEEKLY_SCORING_LIMIT_REACHED";
        pointsEarned = 0;
      }
    } else {
      isScoringEligible = true;
    }

    // Committing updates
    const updates: any = {
      updatedAt: stValue
    };

    // #228: score/monthlyScore/weeklyScore/igaAudit NAO sao mais gravados aqui.
    // Ate 2026-08 este bloco calculava um IGA proprio (a partir de uma lista
    // incompleta reconstruida de userData.igaAudit.topSessions -- nem a mesma
    // fonte de dados que api/_lib/igaService.ts usa) e incrementava score/
    // monthlyScore diretamente, em paralelo ao IGA "oficial" que so alimentava
    // weeklyScore. Essa era uma das 5 formulas independentes de pontuacao
    // identificadas em AUDITORIA-CORE-INVICTUS.md (secao 1, item 4). A partir de
    // agora, a FONTE UNICA (recalculateAllUserScores, chamada apos este
    // transaction.commit ao final da funcao) recalcula as tres janelas de
    // ranking direto do historico real em `workouts`. pointsEarned continua
    // gravado no documento do treino (abaixo) como XP/gamificacao -- XP != IGA.
    if (true) { // Active for all subscription tiers (Performance and Open)
      if (finalDecision === 'approved') {
        const lastCheckIn = userData.lastCheckIn ? new Date(userData.lastCheckIn) : null;
        let newStreak = userData.streak || 0;
        if (lastCheckIn) {
          const lastCheckInDay = userData.lastCheckIn.split('T')[0];
          if (todayISO !== lastCheckInDay) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            if (lastCheckInDay === yesterday.toISOString().split('T')[0]) {
              newStreak += 1;
            } else {
              newStreak = 1;
            }
          }
        } else {
          newStreak = 1;
        }

        updates.streak = newStreak;
        updates.lastCheckIn = nowLocalDate.toISOString();
        updates.totalWorkouts = (userData.totalWorkouts || 0) + 1;

        if (!userData.lastCheckIn || todayISO !== userData.lastCheckIn.split('T')[0]) {
          updates.totalActiveDays = (userData.totalActiveDays || 0) + 1;
        }
      }
    }

    if (pointsEarned > 0) {
      weeklyStatsData.totalPoints = (weeklyStatsData.totalPoints || 0) + pointsEarned;
      weeklyStatsData.updatedAt = stValue;
      transaction.set(weeklyStatsRef, weeklyStatsData);
    }

    // #204: estimamos calorias/ritmo quando o cliente nao envia esses valores
    // prontos (a maioria dos treinos de academia so envia duracao/distancia),
    // e preservamos avgHeartRate/steps/checkpoints -- ate 2026-08 esses campos
    // eram usados so na analise antifraude acima e nunca chegavam a ser
    // gravados no documento que ActivityHistorySection.tsx le.
    const estimatedCalories = estimateCalories({
      type,
      durationMins: durationMins || 45,
      weightKg: userData.weight || userData.weightKg
    });
    const estimatedPace = formatPace(distanceKm, durationMins);

    const workoutObj = {
      id: workoutRef.id,
      userId,
      type,
      // #240: origem gravada no documento, usada pela deduplicacao entre fontes.
      source: 'invictus',
      timestamp: nowLocalDate.toISOString(),
      duration: durationMins || 45,
      distance: distanceKm || 0,
      trajectory: Array.isArray(checkpoints) ? checkpoints : undefined,
      avgHeartRate: payload.avgHeartRate ?? undefined,
      steps: payload.steps ?? undefined,
      calories: estimatedCalories,
      pace: estimatedPace ?? undefined,
      status: computedStatus,
      points: pointsEarned,
      isScoringEligible,
      ...(workoutSecurityBlocked ? { securityBlocked: true, securityBlockReason: workoutSecurityReason } : {}),
      ...(isScoringEligible ? { scoringWeekId: weekId, scoringDate: todayISO } : { nonScoringReason }),
      validation: {
        status: computedStatus,
        reason: 'Presença e identidade verificadas biometricamente.',
        score: finalDecision === 'approved' ? 100 : 70,
        details: {
          presenceCheckRequested: true,
          presenceCheckCompleted: true,
          finalDecision,
          livenessVerified: finalDecision === 'approved'
        }
      },
      // Save selfie face as the activity photo!
      photoUrl: presenceSelfie ? `data:image/jpeg;base64,${presenceSelfie}` : (photoBase64 ? `data:image/jpeg;base64,${photoBase64}` : null),
      createdAt: stValue
    };

    transaction.set(workoutRef, workoutObj);
    transaction.update(userRef, updates);
  });

  // Recalcula weeklyScore/monthlyScore/score (temporada) pela FONTE UNICA (IGA)
  // agora que o workout ja esta commitado -- roda FORA da transaction acima de
  // proposito (recalculateAllUserScores faz suas proprias leituras/escritas no
  // Firestore, que nao podem acontecer dentro de uma transaction alheia).
  try {
    await recalculateAllUserScores(userId);
  } catch (rankingErr) {
    console.error(`[commitWorkoutSession] Falha ao recalcular pontuacao IGA para userId=${userId}, treino permanece salvo:`, rankingErr);
  }
}

// TRANSACTIONALLY COMMIT RUNNING PAYLOADS
async function commitRunningSession(userId: string, payload: any, finalDecision: 'approved' | 'pending') {
  const { km, timeSeconds, pace, calories, elevationGain, steps, trajectory, date, session } = payload;
  const now = new Date();
  const nowIso = now.toISOString();
  const todayISO = nowIso.split('T')[0];

  const userRef = db.collection('users').doc(userId);
  const currentKm = parseFloat(km || 0);

  // Initialize stats document for runs
  const runningStatsRef = db.collection('running_stats').doc(userId);
  const runningStatsSnap = await runningStatsRef.get();
  let rStats = runningStatsSnap.exists ? runningStatsSnap.data() : {
    userId,
    best_run_km_month: 0,
    best_run_km_week: 0,
    last_run_date: nowIso,
    is_paid_running: false
  };

  rStats.best_run_km_month = Math.max(rStats.best_run_km_month || 0, currentKm);
  rStats.best_run_km_week = Math.max(rStats.best_run_km_week || 0, currentKm);
  rStats.last_run_date = nowIso;
  rStats.last_run_stats = {
    km: currentKm,
    timeSeconds: timeSeconds || 0,
    pace: pace || "0'00\"/km",
    calories: calories || 0,
    elevationGain: elevationGain || 0,
    steps: steps || 0,
    trajectory: trajectory || [],
    date: date || nowIso
  };

  const getWeekNumber = (date: Date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  };
  const weekId = `${now.getFullYear()}-W${getWeekNumber(now)}`;
  const weeklyStatsRef = userRef.collection('weeklyStats').doc(weekId);

  let sessionId = null;
  if (session) {
    const sessionRef = db.collection('run_sessions').doc();
    sessionId = sessionRef.id;
    await sessionRef.set({
      ...session,
      id: sessionId,
      userId,
      validationStatus: finalDecision === 'approved' ? 'VALID' : 'SUSPICIOUS',
      createdAt: FieldValue.serverTimestamp()
    });
  }

  await db.collection('running_stats').doc(userId).set(rStats, { merge: true });

  // Enterprise Security Pipeline (ver auditoria antifraude 2026-08 / mesmo padrao
  // usado em RunningService.addRun). Roda ANTES da transacao de pontuacao pois o
  // pipeline faz suas proprias leituras/escritas no Firestore.
  let runSecurityBlocked = false;
  let runSecurityReason: string | null = null;
  try {
    let secUserProfile: any = {};
    try {
      const secUserSnap = await userRef.get();
      if (secUserSnap.exists) secUserProfile = secUserSnap.data() || {};
    } catch (secFetchErr) {
      console.warn('[commitRunningSession] Falha ao buscar perfil do usuario para o SecurityPipeline:', secFetchErr);
    }

    const securityResult = await SecurityPipeline.runPipeline(
      {
        activityType: 'RUNNING',
        type: 'RUNNING',
        durationMins: (timeSeconds || 0) / 60,
        distanceKm: currentKm,
        checkpoints: trajectory,
        timestamp: date || nowIso,
        source: 'PRESENCE_VERIFIED',
        avgHeartRate: payload.avgHeartRate,
        steps,
        sensorTelemetry: payload.sensorTelemetry,
        isMockLocation: payload.isMockLocation,
        isEmulator: payload.isEmulator,
        isRooted: payload.isRooted,
        isDeveloperMode: payload.isDeveloperMode
      },
      userId,
      secUserProfile,
      // #237: historico real -- ver api/_lib/user-activity-history.ts.
      await buscarHistoricoRecente(userId)
    );

    if (!securityResult.shouldScore) {
      runSecurityBlocked = true;
      runSecurityReason = 'SECURITY_PIPELINE_' + securityResult.decision;
      console.warn(`[commitRunningSession] SecurityPipeline recusou pontuacao para userId=${userId}: ${runSecurityReason}`);
    }
  } catch (secErr) {
    // #203: Fail-closed -- se o motor de seguranca falhar tecnicamente, o commit NAO e aprovado.
    runSecurityBlocked = true;
    runSecurityReason = 'SECURITY_PIPELINE_ERROR';
    console.error('[commitRunningSession] SecurityPipeline.runPipeline falhou, bloqueando por seguranca (fail-closed):', secErr);
  }

  await db.runTransaction(async (transaction: any) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) return;
    const userData = userSnap.data() || {};

    let xpAwarded = 0;
    const avgSpeedMs = timeSeconds > 0 ? (currentKm * 1000) / timeSeconds : 0;
    const isSpeedImplausible = avgSpeedMs > SCORE_CONFIG.SPEED_LIMIT_MS;
    const gpsCheck = (trajectory && Array.isArray(trajectory) && trajectory.length >= 2)
      ? GPSValidator.validateActivity(userId, trajectory, currentKm, timeSeconds || 0)
      : null;
    const isGpsFraud = !!(gpsCheck && !gpsCheck.isValid);
    if (finalDecision === 'approved' && userData) {
      if (isSpeedImplausible || isGpsFraud || runSecurityBlocked) {
        console.warn(`[commitRunningSession] Atividade suspeita bloqueada para userId=${userId}. speedImplausible=${isSpeedImplausible} (${avgSpeedMs.toFixed(2)}m/s, limite ${SCORE_CONFIG.SPEED_LIMIT_MS}m/s) gpsFraud=${isGpsFraud}${gpsCheck ? ' flags=' + gpsCheck.flags.join(',') : ''} securityPipeline=${runSecurityBlocked ? runSecurityReason : 'ok'}. Pontuacao zerada.`);
      } else {
        xpAwarded = 20 + Math.floor(currentKm * 5);
      }
    }

    const weeklyStatsSnap = await transaction.get(weeklyStatsRef);
    let weeklyStatsData = weeklyStatsSnap.exists ? weeklyStatsSnap.data() : {
      weekId,
      scoredDays: [],
      totalScoredDays: 0,
      totalPoints: 0
    };

    const scoredDays = weeklyStatsData.scoredDays || [];
    const isDayAlreadyScored = scoredDays.includes(todayISO);

    let isScoringEligible = false;
    let nonSpScoringReason = null;

    if (xpAwarded > 0) {
      if (isDayAlreadyScored) {
        isScoringEligible = true;
      } else if (scoredDays.length < 5) {
        isScoringEligible = true;
        scoredDays.push(todayISO);
        weeklyStatsData.scoredDays = scoredDays;
        weeklyStatsData.totalScoredDays = scoredDays.length;
      } else {
        isScoringEligible = false;
        nonSpScoringReason = "WEEKLY_SCORING_LIMIT_REACHED";
        xpAwarded = 0;
      }
    } else {
      isScoringEligible = true;
    }

    // Teto diario de pontuacao (mesma regra usada em commitWorkoutSession).
    // Sem isso, corridas repetidas no mesmo dia (dentro do limite semanal de
    // DIAS, mas sem limite de QUANTIDADE por dia) inflavam o score sem controle.
    if (xpAwarded > 0) {
      const subTier = userData.subscriptionTier || 'open';
      const dailyCap = subTier === 'performance' ? 100 : 60;
      const todaySnap = await transaction.get(
        db.collection('workouts').where('userId', '==', userId).where('timestamp', '>=', todayISO)
      );
      let todayPoints = 0;
      todaySnap.forEach((d: any) => {
        const w = d.data();
        if (w.status !== 'invalid') todayPoints += w.points || 0;
      });
      if (todayPoints + xpAwarded > dailyCap) {
        xpAwarded = Math.max(0, dailyCap - todayPoints);
      }
    }

    const userUpdates: any = {
      updatedAt: FieldValue.serverTimestamp()
    };

    if (userData) {
      // #228: "score" (ranking de temporada) nao e mais incrementado aqui --
      // era uma 6a fonte de pontuacao ad-hoc, nem sequer listada na auditoria
      // original, que somava xpAwarded direto em users.score sem passar pelo
      // IGA. Agora recalculateAllUserScores() (chamado apos este transaction
      // commitar, no final da funcao) recalcula score/monthlyScore/weeklyScore
      // pela FONTE UNICA a partir do historico real em `workouts`. xpAwarded
      // continua sendo gravado no documento do treino como XP -- XP != IGA.
      userUpdates.lastCheckIn = nowIso;

      const lastCheckInDay = userData.lastCheckIn ? userData.lastCheckIn.split('T')[0] : '';
      if (todayISO !== lastCheckInDay) {
        userUpdates.totalActiveDays = (userData.totalActiveDays || 0) + 1;
      }
    }

    // Habit integrity: read (not write) the active habit goal, if any, BEFORE
    // any write is issued in this transaction — Firestore requires all
    // transaction.get() calls to happen before any set()/update().
    const habitGoalDoc = await readActiveHabitGoal(transaction, userId);

    if (xpAwarded > 0) {
      weeklyStatsData.totalPoints = (weeklyStatsData.totalPoints || 0) + xpAwarded;
      weeklyStatsData.updatedAt = FieldValue.serverTimestamp();
      transaction.set(weeklyStatsRef, weeklyStatsData);
    }

    transaction.update(userRef, userUpdates);

    // Save running session in 'workouts' to count for user feed
    // #204: agora tambem gravamos pace/calorias/elevationGain/steps/avgHeartRate/
    // trajectory -- ate 2026-08 esses valores ja chegavam prontos do cliente
    // (destructured do payload acima) mas nunca eram escritos neste documento,
    // entao o historico de corridas nunca mostrava nada alem de duracao/distancia.
    const workoutDocRef = db.collection('workouts').doc();
    await transaction.set(workoutDocRef, {
      id: workoutDocRef.id,
      userId,
      type: 'cardio',
      // #240: origem gravada no documento, usada pela deduplicacao entre fontes.
      source: 'invictus',
      timestamp: nowIso,
      duration: Math.ceil((timeSeconds || 0) / 60),
      distance: currentKm,
      pace: pace || undefined,
      calories: calories || undefined,
      elevationGain: elevationGain || undefined,
      steps: steps || undefined,
      avgHeartRate: payload.avgHeartRate ?? undefined,
      trajectory: Array.isArray(trajectory) ? trajectory : undefined,
      status: (finalDecision === 'approved' && !runSecurityBlocked) ? 'valid' : (runSecurityBlocked ? 'suspicious' : 'pending_review'),
      points: xpAwarded,
      isScoringEligible,
      ...(runSecurityBlocked ? { securityBlocked: true, securityBlockReason: runSecurityReason } : {}),
      validation: {
        status: finalDecision === 'approved' ? 'valid' : 'pending_review',
        reason: 'Presença em corrida de rua verificada biometricamente.',
        score: finalDecision === 'approved' ? 100 : 70
      },
      createdAt: FieldValue.serverTimestamp()
    });

    // Habit integrity hook: apply progress toward an active "Criar Hábito" goal
    // in the SAME transaction/commit as the score, using the workout's own id
    // as the idempotency key (habit-integration.ts dedupes on appliedActivityIds).
    // Only real, scoring-eligible, approved activities can advance a habit —
    // pending/duplicate-capped/rejected activities never do.
    if (finalDecision === 'approved' && isScoringEligible) {
      try {
        applyHabitProgressWithGoal(transaction, habitGoalDoc, {
          activityId: workoutDocRef.id,
          distanceKm: currentKm,
          durationSec: timeSeconds || 0,
          timestamp: nowIso,
        });
      } catch (habitErr) {
        // Never let habit-progress logic break the core score commit.
        console.error('[habit-integration] failed to apply progress', habitErr);
      }
    }
  });

  // Recalcula weeklyScore/monthlyScore/score (temporada) pela FONTE UNICA (IGA),
  // fora da transaction acima pelo mesmo motivo de commitWorkoutSession.
  try {
    await recalculateAllUserScores(userId);
  } catch (rankingErr) {
    console.error(`[commitRunningSession] Falha ao recalcular pontuacao IGA para userId=${userId}, corrida permanece salva:`, rankingErr);
  }
}
