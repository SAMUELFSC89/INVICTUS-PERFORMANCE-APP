import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergePowerLiftRankingRows, personalBestFromRecords, type PowerLiftRankingRow } from '../core/powerLift/ranking';

const row = (id: string, userId: string, exercise: PowerLiftRankingRow['exercise'], weight: number, videoStatus = 'approved'): PowerLiftRankingRow => ({
  id, userId, exercise, weight, videoStatus,
});

describe('Power Lift ranking audit', () => {
  test('keeps only the best mark per athlete inside each exercise in the legacy helper', () => {
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

  test('server ranking uses the seasonal materialized state, Diamond gate and explicit opt-in', () => {
    const handler = readFileSync(resolve(process.cwd(), 'api/_handlers/powerlift.ts'), 'utf8');
    const engine = readFileSync(resolve(process.cwd(), 'api/_lib/powerlift-season-engine.ts'), 'utf8');

    expect(handler).toContain('getPowerLiftEliteRanking(userId, exercise, take)');
    expect(handler).toContain("handleRanking(req, res, auth.uid)");
    expect(handler).toContain("action === 'opt-in'");
    expect(handler).toContain("action === 'status'");

    expect(engine).toContain("const ENTRY_COLLECTION = 'powerlift_season_entries'");
    expect(engine).toContain('reconcileApprovedUserSeasonRecords(userId, season)');
    expect(engine).toContain("entry.tier === 'DIAMANTE' && entry.eliteOptIn === true");
    expect(engine).toContain('.sort(compareElite)');
    expect(engine).toContain('getPowerLiftGeneralRanking');
  });
});
