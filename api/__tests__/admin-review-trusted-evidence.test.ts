import fs from 'node:fs';
import path from 'node:path';

const repository = fs.readFileSync(path.join(process.cwd(), 'api/_repositories/admin-repository.ts'), 'utf8');
const service = fs.readFileSync(path.join(process.cwd(), 'api/_services/admin/admin-service.ts'), 'utf8');

describe('admin competitive review provenance', () => {
  test('v2 manual approval requires trusted competition metrics before scoring', () => {
    expect(repository).toContain("import { readCompetitionEvidenceMetrics } from '../_lib/competition-evidence.js'");
    expect(repository).toContain('readCompetitionEvidenceMetrics(workoutData)');
    expect(repository).toContain("competitionEligibleAfterReview = status === 'valid'");
    expect(repository).toContain("competitionEligibleAfterReview ? 'approved' : 'ineligible'");
    expect(repository).toContain("'MISSING_TRUSTED_COMPETITION_EVIDENCE'");
    expect(repository).toContain('isScoringEligible: competitionEligibleAfterReview');
    expect(repository).toContain('competitionPoints: effectiveCompetitionPoints');
  });

  test('activity competition entries inherit the same fail-closed decision', () => {
    expect(repository).toContain('reviewStatus: isVersionedActivity ? effectiveCompetitionStatus');
    expect(repository).toContain('competitionPoints: isVersionedActivity ? effectiveCompetitionPoints');
    expect(repository).toContain('reasonCode: isVersionedActivity ? effectiveReason');
  });

  test('admin service does not advertise points when v2 provenance is absent', () => {
    expect(service).toContain('readCompetitionEvidenceMetrics(workout)');
    expect(service).toContain('const adjustedPoints = competitionEligibleAfterReview');
    expect(service).toContain('mantida fora da pontuação competitiva por ausência de evidência confiável');
  });
});
