import { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { db, cors, verifyAuth, serverTimestamp } from '../_lib/common.js';
import { validateGeofenceCheckin, MAX_GEOFENCE_RADIUS_METERS, MAX_GPS_ACCURACY_METERS } from '../_lib/geofence-engine.js';
import { ScoreEngine } from '../_lib/score-engine/index.js';
import { loadActivityCompetitionPolicySnapshot } from '../_lib/activity-competition-policy.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }

  const { action: rawAction, latitude, longitude, accuracy, isMock, deviceId, deviceFingerprint, activityPolicySnapshotId, activitySessionId } = req.body || {};
  const action = String(rawAction || '');
  if (!['verify', 'confirm', 'confirm_activity'].includes(action)) {
    return res.status(400).json({ error: 'Ação de check-in inválida.' });
  }

  if (latitude === undefined || longitude === undefined || accuracy === undefined) {
    return res.status(400).json({ 
      status: 'blocked_invalid_coords', 
      error: 'Coordenadas e precisão de GPS são obrigatórios para validação.' 
    });
  }

  try {
    if (!db) {
      return res.status(500).json({ error: 'Banco de dados indisponível no momento.' });
    }

    let activityPolicy: Awaited<ReturnType<typeof loadActivityCompetitionPolicySnapshot>> = null;
    if (action === 'confirm_activity') {
      if (!activityPolicySnapshotId || !activitySessionId) {
        return res.status(400).json({ error: 'A autorização e a sessão são obrigatórias para o check-in competitivo.' });
      }
      activityPolicy = await loadActivityCompetitionPolicySnapshot({
        snapshotId: String(activityPolicySnapshotId),
        userId: auth.uid,
        activityType: 'workout',
        sessionId: String(activitySessionId),
      });
      if (!activityPolicy || !activityPolicy.requiresSecurityReview || !activityPolicy.requiresGymCheckIn) {
        return res.status(400).json({ error: 'O contexto competitivo deste treino é inválido ou expirou.' });
      }
      if (!activityPolicy.startBy || Date.parse(activityPolicy.startBy) < Date.now()) {
        return res.status(409).json({ error: 'A autorização para iniciar este treino expirou. Atualize a tela e tente novamente.' });
      }
    }

    // 1. Fetch user profile
    const userRef = db.collection('users').doc(auth.uid);
    const userSnap = await userRef.get();
    
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'Perfil do usuário não encontrado.' });
    }

    const userData = userSnap.data() || {};
    if (!userData.gymId) {
      return res.status(400).json({
        status: 'blocked_no_gym',
        error: 'Você precisa selecionar uma academia cadastrada antes de confirmar o check-in.'
      });
    }
    const expectedGymIds = [...new Set((activityPolicy?.contexts || [])
      .filter((context) => context.requiresGymCheckIn && context.gymId)
      .map((context) => String(context.gymId)))];
    if (expectedGymIds.length > 1) {
      return res.status(409).json({
        status: 'blocked_competition_gym_conflict',
        error: 'Suas participações competitivas apontam para academias diferentes. Atualize as inscrições antes de iniciar.',
      });
    }
    if (expectedGymIds.length > 0 && expectedGymIds[0] !== String(userData.gymId)) {
      return res.status(409).json({
        status: 'blocked_wrong_gym',
        error: 'A academia do perfil não corresponde à academia desta participação competitiva.'
      });
    }

    let gymLat: number | undefined;
    let gymLng: number | undefined;

    // First try loading canonical coordinates directly from gyms collection
    try {
      const gymSnap = await db.collection('gyms').doc(userData.gymId).get();
      if (gymSnap.exists) {
        const gymData = gymSnap.data() || {};
        const gLat = gymData.latitude ?? gymData.lat;
        const gLng = gymData.longitude ?? gymData.lng;
        if (gLat !== undefined && gLng !== undefined && !isNaN(Number(gLat)) && !isNaN(Number(gLng))) {
          gymLat = Number(gLat);
          gymLng = Number(gLng);
        }
      }
    } catch (e) {
      console.warn('Failed fetching gym document in gyms_checkin:', e);
    }

    // Fallback to user.gymLocation if gym document not found or lacks coordinates
    if (gymLat === undefined || gymLng === undefined) {
      if (userData.gymLocation && userData.gymLocation.lat !== undefined && userData.gymLocation.lng !== undefined) {
        const uLat = Number(userData.gymLocation.lat);
        const uLng = Number(userData.gymLocation.lng);
        if (!isNaN(uLat) && !isNaN(uLng) && (uLat !== 0 || uLng !== 0)) {
          gymLat = uLat;
          gymLng = uLng;
        }
      }
    }

    if (gymLat === undefined || gymLng === undefined) {
      console.log(`Academia sem coordenadas válidas: ${userData.gymId}, ${auth.uid}, ${new Date().toISOString()}`);
      return res.status(400).json({
        status: 'blocked_invalid_coords',
        error: '⚠ A academia selecionada ainda não tem localização definida no mapa. Por favor, selecione sua academia novamente no menu Academia.'
      });
    }

    // 2. Validate Geofence (Strictly 80m max radius & 30m max GPS accuracy)
    const geofenceResult = validateGeofenceCheckin(
      {
        id: userData.gymId,
        name: userData.gymName || 'Sua Academia',
        latitude: gymLat,
        longitude: gymLng
      },
      {
        latitude,
        longitude,
        accuracy,
        isMock: isMock === true,
        timestamp: new Date().toISOString()
      },
      MAX_GEOFENCE_RADIUS_METERS, // 80m
      MAX_GPS_ACCURACY_METERS   // 30m
    );

    if (!geofenceResult.approved) {
      return res.status(400).json({
        status: geofenceResult.status,
        error: geofenceResult.userFacingMessage,
        distanceMeters: geofenceResult.distanceMeters,
        gpsAccuracy: geofenceResult.gpsAccuracy,
        auditLog: geofenceResult.auditLog
      });
    }

    const distanceMeters = geofenceResult.distanceMeters!;

    // 5. Anti-spoofing and security analyses
    const riskFlags: string[] = [];
    let isSuspicious = false;

    // Block simulated/mock locations
    if (isMock) {
      return res.status(400).json({
        status: 'blocked_mock_location',
        error: 'Acesso bloqueado: Localização simulada/fictícia (Mock Location) detectada pela tecnologia antifraude Invictus.'
      });
    }

    // Anti rapid gym hopping detection
    const latestCheckinSnap = await db.collection('gym_checkins')
      .where('userId', '==', auth.uid)
      .orderBy('confirmedAt', 'desc')
      .limit(1)
      .get();
    
    if (!latestCheckinSnap.empty) {
      const lastCheckin = latestCheckinSnap.docs[0].data();
      const lastGymId = lastCheckin.gymId;
      const lastTime = new Date(lastCheckin.confirmedAt).getTime();
      const timeDiffMins = (Date.now() - lastTime) / 60000;
      
      if (lastGymId !== userData.gymId && timeDiffMins < 15) {
        riskFlags.push('SUSPICIOUS_RAPID_GYM_HOPPING');
        isSuspicious = true;
      }
    }

    // If the action is "verify", we only analyze proximity and eligibility
    // but do not persist the check-in yet or generate a consumed checkInId
    if (action === 'verify') {
      return res.json({
        success: true,
        status: 'eligible',
        distanceMeters: Number(distanceMeters.toFixed(1)),
        gpsAccuracy: accuracy,
        message: 'Você está na academia. Confirme seu check-in para iniciar.'
      });
    }

    if (isSuspicious && action === 'confirm_activity') {
      return res.status(409).json({
        status: 'blocked_suspicious_checkin',
        error: 'Não foi possível confirmar este check-in competitivo agora. Aguarde alguns minutos e tente novamente.',
        riskFlags,
      });
    }

    // 6. Record the manual check-in
    const now = new Date();
    const localDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
    const checkInId = action === 'confirm_activity'
      ? `activity_${String(activitySessionId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 400)}`
      : `manual_${createHash('sha256')
          .update(`${auth.uid}\u0000${String(userData.gymId)}\u0000${localDay}`)
          .digest('hex')}`;
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString(); // valid for 15 minutes
    const checkinStatus = isSuspicious ? 'suspicious' : 'confirmed';
    const checkinMessage = isSuspicious
      ? `Check-in aceito mas marcado para revisão: ${riskFlags.join(', ')} (distância: ${distanceMeters.toFixed(1)}m, precisão GPS: ${accuracy}m)`
      : `Check-in confirmado a ${distanceMeters.toFixed(1)}m da academia (precisão GPS: ${accuracy}m)`;

    const checkinDoc = {
      id: checkInId,
      userId: auth.uid,
      gymId: userData.gymId,
      gymName: userData.gymName || 'Academia Vinculada',
      confirmedAt: now.toISOString(),
      expiresAt,
      userLocation: { lat: Number(latitude), lng: Number(longitude) },
      gymLocation: { lat: gymLat, lng: gymLng },
      distanceMeters: Number(distanceMeters.toFixed(1)),
      gpsAccuracy: accuracy,
      status: checkinStatus,
      userMessage: checkinMessage,
      deviceId: deviceId || '',
      deviceFingerprint: deviceFingerprint || '',
      activityPolicySnapshotId: activityPolicySnapshotId ? String(activityPolicySnapshotId) : null,
      activitySessionId: activitySessionId ? String(activitySessionId) : null,
      mockLocationDetected: false,
      riskFlags,
      createdAt: serverTimestamp()
    };

    const checkInRef = db.collection('gym_checkins').doc(checkInId);
    try {
      await checkInRef.create(checkinDoc);
    } catch (createError: any) {
      const existing = await checkInRef.get();
      const existingData = existing.data() || {};
      const sameOwner = existing.exists && existingData.userId === auth.uid;
      const sameSession = action !== 'confirm_activity'
        || (existingData.activityPolicySnapshotId === String(activityPolicySnapshotId)
          && existingData.activitySessionId === String(activitySessionId));
      if (!sameOwner || !sameSession) throw createError;
      return res.json({
        success: true,
        status: existingData.status,
        checkInId,
        expiresAt: existingData.expiresAt,
        gymName: existingData.gymName,
        distanceMeters: existingData.distanceMeters,
        gpsAccuracy: existingData.gpsAccuracy,
        riskFlags: existingData.riskFlags || [],
        pointsAwarded: Math.max(0, Number(existingData.pointsAwarded) || 0),
        scoringPending: existingData.scoringPending === true,
        duplicate: true,
      });
    }

    // Check-in competitivo só comprova presença; a recompensa vem da atividade
    // concluída. O check-in manual independente mantém sua regra legada.
    let pointsAwarded = 0;
    let scoringPending = false;
    if (action !== 'confirm_activity') {
      try {
        pointsAwarded = await ScoreEngine.processCheckin(auth.uid, {
          checkInId,
          gymId: userData.gymId,
          timestamp: now.toISOString(),
          hasPhoto: false,
        });
        await checkInRef.set({ pointsAwarded }, { merge: true });
      } catch (scoringError) {
        // O check-in já foi confirmado. Uma indisponibilidade isolada do motor
        // não pode induzir o cliente a repetir a presença.
        scoringPending = true;
        console.error('[Gym Checkin] Check-in salvo; pontuação pendente de reconciliação:', scoringError);
        await checkInRef.set({
          pointsAwarded: 0,
          scoringPending: true,
          scoringErrorAt: now.toISOString(),
        }, { merge: true });
      }
    }

    // Log the event for forensic inspection / audit
    try {
      const { logEvent } = require('../_lib/observability');
      await logEvent({
        severity: isSuspicious ? 'WARNING' : 'INFO',
        category: 'fraud_audit_logs',
        message: `Check-in manual presencial realizado por ${userData.displayName || auth.uid} na academia ${userData.gymName || ''} (Distância: ${Math.round(distanceMeters)}m)`,
        userId: auth.uid,
        route: '/api/gyms/checkin',
        details: {
          checkInId,
          gymId: userData.gymId,
          distanceMeters,
          gpsAccuracy: accuracy,
          isSuspicious,
          riskFlags
        }
      });
    } catch (_) {}

    return res.json({
      success: true,
      status: checkinStatus,
      checkInId,
      expiresAt,
      gymName: userData.gymName,
      distanceMeters: Number(distanceMeters.toFixed(1)),
      gpsAccuracy: accuracy,
      riskFlags,
      pointsAwarded,
      scoringPending
    });

  } catch (error: any) {
    console.error('Gym Checkin API Error:', error);
    return res.status(500).json({ error: error.message || 'Erro ao registrar check-in' });
  }
}
