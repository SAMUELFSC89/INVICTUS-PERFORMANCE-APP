import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../api/_lib/common.js';
import { syncReviewedActivityCompetitionScores } from '../api/_lib/championship-scoring-service.js';
import { recalculateAllUserScores } from '../api/_lib/igaService.js';

const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = 200;

async function listUnsafe(source: 'apple_health' | 'health_connect') {
  const result: Array<{ id: string; data: Record<string, any> }> = [];
  let cursor: any = null;
  do {
    let query: any = db.collection('workouts')
      .where('source', '==', source)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const trusted = data.competitionEvidenceStatus === 'trusted_native_attestation'
        || data.competitionEvidenceStatus === 'trusted_server_source';
      const scoring = data.isScoringEligible === true
        || data.competitionReviewStatus === 'approved'
        || Number(data.competitionPoints) > 0;
      if (!trusted && scoring) result.push({ id: doc.id, data });
    }
    cursor = snap.docs.length === PAGE_SIZE ? snap.docs[snap.docs.length - 1] : null;
  } while (cursor);
  return result;
}

async function invalidateLegacyScoreDocs(activityId: string) {
  const [paid, community] = await Promise.all([
    db.collection('championship_scores').where('activityId', '==', activityId).get(),
    db.collection('gym_championship_scores').where('activityId', '==', activityId).get(),
  ]);
  const batch = db.batch();
  paid.docs.forEach(doc => batch.set(doc.ref, {
    validationStatus: 'REJECTED', score: 0, invalidatedAt: new Date().toISOString(),
  }, { merge: true }));
  community.docs.forEach(doc => batch.set(doc.ref, {
    validationStatus: 'REJECTED', auditStatus: 'REJECTED', score: 0,
    invalidatedAt: new Date().toISOString(),
  }, { merge: true }));
  if (paid.size + community.size > 0) await batch.commit();
}

async function main() {
  const candidates = (await Promise.all([
    listUnsafe('apple_health'),
    listUnsafe('health_connect'),
  ])).flat();
  const users = new Set(candidates.map(item => String(item.data.userId || '')).filter(Boolean));
  console.log(`[wearable-migration] ${candidates.length} projeção(ões), ${users.size} usuário(s).`);
  if (!APPLY) {
    console.log('[wearable-migration] Dry-run. Revise o total e execute novamente com --apply.');
    return;
  }

  for (const candidate of candidates) {
    await db.collection('workouts').doc(candidate.id).set({
      validationStatus: 'not_eligible',
      competitionReviewStatus: 'ineligible',
      competitionStatus: 'ineligible',
      competitionEvidenceStatus: 'untrusted_client_import',
      securityReviewApplied: false,
      securityDecision: 'ATTESTATION_REQUIRED',
      pendingReview: false,
      isScoringEligible: false,
      nonScoringReason: 'UNVERIFIED_WEARABLE_SOURCE',
      competitionPoints: 0,
      rankingPointsEarned: 0,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    await syncReviewedActivityCompetitionScores(candidate.id);
    await invalidateLegacyScoreDocs(candidate.id);
  }
  for (const userId of users) await recalculateAllUserScores(userId);
  console.log('[wearable-migration] Migração concluída.');
}

main().catch((error) => {
  console.error('[wearable-migration] Falha:', error);
  process.exitCode = 1;
});
