import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergePowerLiftRankingRows, personalBestFromRecords, type PowerLiftRankingRow } from '../core/powerLift/ranking';

const row = (id: string, userId: string, exercise: PowerLiftRankingRow['exercise'], weight: number, videoStatus = 'approved'): PowerLiftRankingRow => ({
  id, userId, exercise, weight, videoStatus,
});

describe('Power Lift ranking audit', () => {
  test('keeps only the best mark per athlete inside each exercise', () => {
    const result = mergePowerLiftRankingRows([
      row('a1', 'u1', 'supino', 80),
      row('a2', 'u1', 'supino', 100),
      row('b1', 'u2', 'supino', 90),
      row('c1', 'u1', 'terra', 140),
      row('c2', 'u1', 'terra', 150),
    ]);

    expect(result.filter((item) => item.exercise === 'supino')).toEqual([
      expect.objectContaining({ id: 'a2', userId: 'u1', weight: 100 }),
      expect.objectContaining({ id: 'b1', userId: 'u2', weight: 90 }),
    ]);
    expect(result.filter((item) => item.exercise === 'terra')).toEqual([
      expect.objectContaining({ id: 'c2', userId: 'u1', weight: 150 }),
    ]);
  });

  test('personal best uses the athlete own approved history instead of the public ranking cutoff', () => {
    const own = [
      row('pending', 'me', 'agachamento', 180, 'manual_review'),
      row('approved-old', 'me', 'agachamento', 150),
      row('approved-best', 'me', 'agachamento', 170),
    ];
    expect(personalBestFromRecords(own, 'agachamento')).toBe(170);
  });

  test('server ranking is authenticated, athlete-based and builds independent modality windows', () => {
    const source = readFileSync(resolve(process.cwd(), 'api/_handlers/powerlift.ts'), 'utf8');
    expect(source).toContain('mergePowerLiftRankingRows(records)');
    expect(source).toContain("const requestedExercises = exercise ? [exercise] : RANKING_EXERCISES");
    expect(source).toContain('approvedOwnRecords(userId)');
    expect(source).toContain("handleRanking(req, res, auth.uid)");
    expect(source).toContain('MAX_RANKING_SCAN = 500');
  });
});
