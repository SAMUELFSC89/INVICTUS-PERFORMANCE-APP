import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('season tracker timezone migration contract', () => {
  test('legacy UTC boundaries are reconstructed from seasonId before advancing', () => {
    const source = readFileSync(resolve(process.cwd(), 'api/_lib/season-prize-engine.ts'), 'utf8');

    expect(source).toContain('canonicalWindowForSeasonId(atual.seasonId)');
    expect(source).toContain('canonicalWindowForSeasonId(stored.seasonId)');
    expect(source).toContain('stored.startDate.getTime() !== canonical.startDate.getTime()');
    expect(source).toContain('stored.endDate.getTime() !== canonical.endDate.getTime()');
    expect(source).toContain('timeZone: COMPETITION_TIME_ZONE');
  });
});
