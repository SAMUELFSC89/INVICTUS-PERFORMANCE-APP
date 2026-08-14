import { VercelRequest, VercelResponse } from '@vercel/node';
import { 
  db,
  cors, 
  verifyAuth,
  FieldValue
} from '../_lib/common.js';
import { logEvent } from '../_lib/observability.js';
import { GoogleGenAI } from "@google/genai";
import { calculateWeeklyIGA, IGASession } from '../../src/core/iga/index.js';
import { readActiveHabitGoal, applyHabitProgressWithGoal } from '../_lib/habit-integration.js';
import { SCORE_CONFIG } from '../_lib/score-config.js';
import { GPSValidator } from '../_lib/fraud-detection/gps-validator.js';

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

    if (true) { // Active for all subscription tiers (Performance and Open)
      updates.score = (userData.score || 0) + pointsEarned;
      updates.monthlyScore = (userData.monthlyScore || 0) + pointsEarned;

      let previousSessions: IGASession[] = [];
      if (userData.igaAudit && Array.isArray(userData.igaAudit.topSessions)) {
        previousSessions = userData.igaAudit.topSessions.map((s: any) => ({
          id: s.sessionId,
          type: s.type,
          durationMinutes: s.durationMinutes,
          avgHeartRate: s.avgHeartRate,
          caloriesInformed: s.informedCalories,
          isValid: s.eligible
        }));
      }

      const presenceSession: IGASession = {
        type: 'workout',
        durationMinutes: Number(durationMins) || 45,
        isValid: finalDecision === 'approved'
      };

      const igaResult = calculateWeeklyIGA(
        [...previousSessions, presenceSession],
        {
          age: Number(userData.age) || 30,
          weightKg: Number(userData.weight) || Number(userData.weightKg) || 70,
          maxHeartRate: Number(userData.maxHeartRate) || undefined
        }
      );

      updates.weeklyScore = igaResult.igaRanking;
      updates.igaAudit = igaResult;
      
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

    const workoutObj = {
      id: workoutRef.id,
      userId,
      type,
      timestamp: nowLocalDate.toISOString(),
      duration: durationMins || 45,
      distance: distanceKm || 0,
      status: computedStatus,
      points: pointsEarned,
      isScoringEligible,
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
      if (isSpeedImplausible || isGpsFraud) {
        console.warn(`[commitRunningSession] Atividade suspeita bloqueada para userId=${userId}. speedImplausible=${isSpeedImplausible} (${avgSpeedMs.toFixed(2)}m/s, limite ${SCORE_CONFIG.SPEED_LIMIT_MS}m/s) gpsFraud=${isGpsFraud}${gpsCheck ? ' flags=' + gpsCheck.flags.join(',') : ''}. Pontuacao zerada.`);
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
      userUpdates.score = (userData.score || 0) + xpAwarded;
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
    const workoutDocRef = db.collection('workouts').doc();
    await transaction.set(workoutDocRef, {
      id: workoutDocRef.id,
      userId,
      type: 'cardio',
      timestamp: nowIso,
      duration: Math.ceil((timeSeconds || 0) / 60),
      distance: currentKm,
      status: finalDecision === 'approved' ? 'valid' : 'pending_review',
      points: xpAwarded,
      isScoringEligible,
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
}
