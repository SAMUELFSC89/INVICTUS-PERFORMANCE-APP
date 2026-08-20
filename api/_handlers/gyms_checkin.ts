import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth, serverTimestamp } from '../_lib/common.js';
import { validateGeofenceCheckin, MAX_GEOFENCE_RADIUS_METERS, MAX_GPS_ACCURACY_METERS } from '../_lib/geofence-engine.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }

  const { action, latitude, longitude, accuracy, isMock, deviceId, deviceFingerprint } = req.body;

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

    // 6. Record the manual check-in
    const checkInId = db.collection('gym_checkins').doc().id;
    const now = new Date();
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
      mockLocationDetected: false,
      riskFlags,
      createdAt: serverTimestamp()
    };

    await db.collection('gym_checkins').doc(checkInId).set(checkinDoc);

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
      riskFlags
    });

  } catch (error: any) {
    console.error('Gym Checkin API Error:', error);
    return res.status(500).json({ error: error.message || 'Erro ao registrar check-in' });
  }
}
