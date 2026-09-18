import { db } from './common.js';
import { calculateAllUserScores } from './igaService.js';

function serialize(document: any) {
  return { id: document.id, ...document.data() };
}

function millis(value: unknown): number {
  if (!value) return 0;
  if (typeof (value as any)?.toMillis === 'function') return Number((value as any).toMillis()) || 0;
  if (typeof (value as any)?._seconds === 'number') return Number((value as any)._seconds) * 1000;
  if (typeof (value as any)?.seconds === 'number') return Number((value as any).seconds) * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function drift(persisted: unknown, expected: unknown) {
  const left = Number(persisted || 0);
  const right = Number(expected || 0);
  const difference = Number((left - right).toFixed(6));
  return { persisted: left, expected: right, difference, matches: Math.abs(difference) < 0.000001 };
}

async function resolveUser(targetInput: unknown) {
  const target = String(targetInput || '').trim();
  if (!target || target.length > 180) throw new Error('Informe UID, e-mail ou CPF válido.');

  const direct = await db.collection('users').doc(target).get();
  if (direct.exists) return direct;

  if (target.includes('@')) {
    const byEmail = await db.collection('users').where('email', '==', target.toLowerCase()).limit(1).get();
    if (!byEmail.empty) return byEmail.docs[0];
  }

  const cpf = target.replace(/\D/g, '');
  if (cpf.length === 11) {
    const byCpf = await db.collection('users').where('cpf', '==', cpf).limit(1).get();
    if (!byCpf.empty) return byCpf.docs[0];
  }

  throw new Error('Atleta não encontrado.');
}

export async function getAdminAthleteAudit(targetInput: unknown, limitInput?: unknown) {
  const userSnap = await resolveUser(targetInput);
  const userId = userSnap.id;
  const user = serialize(userSnap);
  const parsedLimit = Math.floor(Number(limitInput));
  const limit = Number.isFinite(parsedLimit) ? Math.max(10, Math.min(100, parsedLimit)) : 50;

  const [workoutsSnap, trustSnap, reviewsSnap, registrationsSnap] = await Promise.all([
    db.collection('workouts').where('userId', '==', userId).limit(limit).get(),
    db.collection('user_trust_profiles').doc(userId).get(),
    db.collection('admin_reviews').where('userId', '==', userId).limit(100).get(),
    db.collection('championship_registrations').where('userId', '==', userId).limit(100).get(),
  ]);

  const workouts = workoutsSnap.docs
    .map(serialize)
    .sort((a: any, b: any) => millis(b.endTime || b.createdAt || b.startTime) - millis(a.endTime || a.createdAt || a.startTime));

  const securityReports = await Promise.all(workouts.map(async (workout: any) => {
    const report = await db.collection('security_reports').doc(workout.id).get();
    return report.exists ? serialize(report) : null;
  }));

  let igaPreview: any = null;
  let igaPreviewError: string | null = null;
  try {
    igaPreview = await calculateAllUserScores(userId);
  } catch (error: any) {
    igaPreviewError = String(error?.message || 'Falha no dry-run do IGA.');
  }

  const igaDrift = igaPreview ? {
    weekly: drift(user.weeklyScore, igaPreview.weekly?.igaRanking),
    monthly: drift(user.monthlyScore, igaPreview.monthly?.average),
    season: drift(user.score, igaPreview.season?.average),
  } : null;

  const reports = securityReports.filter(Boolean) as any[];
  const decisions = reports.reduce((acc: Record<string, number>, report: any) => {
    const decision = String(report.decision || report.risk?.automaticDecision || 'UNKNOWN').toUpperCase();
    acc[decision] = (acc[decision] || 0) + 1;
    return acc;
  }, {});
  const highRisk = reports.filter((report: any) => Number(report.risk?.riskScore ?? report.riskScore ?? 0) >= 60);
  const reviewRequired = reports.filter((report: any) => ['UNDER_REVIEW', 'PARTIALLY_APPROVED', 'BLOCKED'].includes(String(report.decision || report.risk?.automaticDecision || '').toUpperCase()));

  return {
    generatedAt: new Date().toISOString(),
    user: {
      uid: userId,
      displayName: user.displayName || null,
      email: user.email || null,
      cpf: user.cpf || null,
      role: user.role || null,
      subscriptionTier: user.subscriptionTier || null,
      gymId: user.gymId || null,
      gymName: user.gymName || null,
      createdAt: user.createdAt || null,
      accountStatus: user.accountStatus || null,
    },
    trustProfile: trustSnap.exists ? serialize(trustSnap) : null,
    summary: {
      workoutsLoaded: workouts.length,
      securityReportsLoaded: reports.length,
      highRiskActivities: highRisk.length,
      reviewRequiredActivities: reviewRequired.length,
      decisions,
      registrations: registrationsSnap.size,
      adminReviews: reviewsSnap.size,
    },
    iga: {
      persisted: {
        weeklyScore: Number(user.weeklyScore || 0),
        monthlyScore: Number(user.monthlyScore || 0),
        seasonScore: Number(user.score || 0),
      },
      expected: igaPreview ? {
        weeklyScore: Number(igaPreview.weekly?.igaRanking || 0),
        monthlyScore: Number(igaPreview.monthly?.average || 0),
        seasonScore: Number(igaPreview.season?.average || 0),
      } : null,
      drift: igaDrift,
      inSync: igaDrift ? igaDrift.weekly.matches && igaDrift.monthly.matches && igaDrift.season.matches : null,
      dryRunError: igaPreviewError,
      expectedAudit: igaPreview,
      persistedAudit: {
        weekly: user.igaAudit || null,
        monthly: user.igaAuditMonthly || null,
        season: user.igaAuditSeason || null,
      },
    },
    activities: workouts.map((workout: any, index: number) => {
      const report = securityReports[index] as any;
      return {
        id: workout.id,
        type: workout.cardioType || workout.type || null,
        startTime: workout.startTime || null,
        endTime: workout.endTime || null,
        durationMinutes: Number(workout.durationMinutes || workout.duration || 0),
        validationStatus: workout.validationStatus || null,
        competitionReviewStatus: workout.competitionReviewStatus || null,
        isScoringEligible: workout.isScoringEligible ?? null,
        score: workout.score ?? workout.igaScore ?? null,
        riskScore: Number(report?.risk?.riskScore ?? workout.securityRiskScore ?? 0),
        riskLevel: report?.risk?.riskLevel || null,
        decision: report?.decision || report?.risk?.automaticDecision || null,
        integrityScore: Number(report?.integrity?.integrityScore ?? 0),
        trustScore: Number(report?.trust?.trustScore ?? 0),
        primaryRiskDriver: report?.explanation?.primaryRiskDriver || null,
        evidenceCount: Array.isArray(report?.fraud?.evidences) ? report.fraud.evidences.length : 0,
      };
    }),
    registrations: registrationsSnap.docs.map(serialize),
    adminReviews: reviewsSnap.docs.map(serialize).sort((a: any, b: any) => millis(b.createdAt) - millis(a.createdAt)),
  };
}
