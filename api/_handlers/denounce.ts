import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth, FieldValue } from '../_lib/common.js';
import { logEvent } from '../_lib/observability.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido.' });
  }

  const authUser = await verifyAuth(req);
  if (!authUser) {
    return res.status(401).json({ success: false, error: 'Sessão expirada. Entre novamente.' });
  }

  const { suspectUserId } = req.body;
  if (!suspectUserId) {
    return res.status(400).json({ success: false, error: 'Usuário suspeito não informado.' });
  }

  if (authUser.uid === suspectUserId) {
    return res.status(400).json({ success: false, error: 'Você não pode denunciar a si mesmo.' });
  }

  try {
    if (!db) {
      return res.status(500).json({ success: false, error: 'Serviço temporariamente indisponível.' });
    }

    // 1. Get suspect profile
    const suspectRef = db.collection('users').doc(suspectUserId);
    const suspectSnap = await suspectRef.get();
    if (!suspectSnap.exists) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
    }
    const suspectData = suspectSnap.data() || {};

    // 2. Determine if user is in Top 1, Top 3 or prize zone (Top 5)
    const pos = suspectData.positions || {};
    const isTopAthlete = 
      (pos.gym && pos.gym <= 5) || 
      (pos.city && pos.city <= 5) || 
      (pos.national && pos.national <= 5);

    // 3. Register denunciation doc
    const denounceRef = db.collection('denunciations').doc();
    const denunciation = {
      id: denounceRef.id,
      reporterUserId: authUser.uid,
      suspectUserId,
      suspectDisplayName: suspectData.displayName || 'Atleta',
      isTopAthleteAtDenounce: !!isTopAthlete,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };
    await denounceRef.set(denunciation);

    // 4. Update suspect trust score
    const trustProfileRef = db.collection('user_trust_profiles').doc(suspectUserId);
    const trustProfileSnap = await trustProfileRef.get();
    let trustScore = 100;
    
    if (trustProfileSnap.exists) {
      trustScore = trustProfileSnap.data()?.trustScore ?? 100;
    }
    
    // Reduces trust score significantly due to reports
    const newTrustScore = Math.max(0, trustScore - 20);
    const fraudRiskLevel = newTrustScore >= 80 ? 'low' : newTrustScore >= 50 ? 'medium' : 'high';

    await trustProfileRef.set({
      userId: suspectUserId,
      trustScore: newTrustScore,
      fraudRiskLevel,
      denunciationCount: FieldValue.increment(1),
      lastValidationReview: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // 5. Query recent activities in last 48h to adjust risk or flag for review
    const fortyEightHoursAgo = new Date();
    fortyEightHoursAgo.setDate(fortyEightHoursAgo.getDate() - 2);

    const recentWorkouts = await db.collection('workouts')
      .where('userId', '==', suspectUserId)
      .where('timestamp', '>=', fortyEightHoursAgo.toISOString())
      .get();

    let flaggedCount = 0;
    const batch = db.batch();

    recentWorkouts.forEach((doc: any) => {
      const workout = doc.data();
      // If of top athlete or highly suspicious, flag for mandatory review immediately
      if (isTopAthlete || newTrustScore < 60) {
        batch.update(doc.ref, {
          status: 'under_review',
          'validation.status': 'pending_review',
          'validation.requiresManualReview': true,
          'validation.reason': (workout.validation?.reason || '') + ' | Denúncia recebida de competidor (' + (isTopAthlete ? 'Zona de Premiação' : 'Aumento de Risco') + ')'
        });
        flaggedCount++;
      }
    });

    if (flaggedCount > 0) {
      await batch.commit();
    }

    // 6. Log Fraud Audit entry
    const logId = db.collection('fraud_audit_logs').doc().id;
    await db.collection('fraud_audit_logs').doc(logId).set({
      id: logId,
      userId: suspectUserId,
      displayName: suspectData.displayName || 'Competidor',
      type: 'user_reported',
      fraudRiskScore: parseFloat(((100 - newTrustScore) / 100).toFixed(2)),
      fraudFlags: ['USER_REPORTED_IN_RANKING', isTopAthlete ? 'REPRESENT_TOP_LEAGUE_RISK' : 'MEMBER_REPORTED'],
      trustLevel: fraudRiskLevel,
      severity: isTopAthlete ? 'CRITICAL' : 'WARNING',
      actionTaken: isTopAthlete ? 'auto_under_review' : 'shadow_logged',
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      reviewStatus: 'pending'
    });

    await logEvent({
      severity: isTopAthlete ? 'HIGH_RISK' : 'WARNING',
      category: 'fraud_audit_logs',
      message: `Denúncia registrada para o atleta ${suspectData.displayName} (UID: ${suspectUserId}). TrustScore reduzido de ${trustScore} para ${newTrustScore}. Atividades sob revisão: ${flaggedCount}`,
      userId: authUser.uid,
      route: '/api/denounce',
      details: { suspectUserId, isTopAthlete, flaggedCount, newTrustScore }
    });

    return res.json({
      success: true,
      isTopAthlete,
      flaggedCount,
      message: 'Denúncia registrada com sucesso. Nossos auditores analisarão as evidências do usuário em breve.'
    });
  } catch (error: any) {
    console.error('Denounce error:', error);
    return res.status(500).json({ success: false, error: 'Ocorreu um erro ao enviar a denúncia.' });
  }
}
