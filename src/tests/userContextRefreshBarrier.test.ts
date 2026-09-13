import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('UserContext explicit refresh reconciliation barrier', () => {
  test('refreshUser awaits the already in-flight canonical activity reconciliation', () => {
    const context = read('src/UserContext.tsx');

    expect(context).toContain("const statsSyncRef = useRef<{ uid: string; promise: Promise<ActivityStatsPatch | null> } | null>(null)");
    expect(context).toContain('if (statsSyncRef.current?.uid === uid) return statsSyncRef.current.promise');
    expect(context).toContain('void reconcileActivityStats(uid, generation)');
    expect(context).toContain('const pendingStatsSync = statsSyncRef.current');
    expect(context).toContain('if (pendingStatsSync?.uid === uid)');
    expect(context).toContain('await pendingStatsSync.promise');
  });

  test('activity completion flows await refreshUser before the handler settles', () => {
    const challenges = read('src/pages/Challenges.tsx');
    const awaitedRefreshes = challenges.match(/await Promise\.allSettled\(\[refreshUser\(\), loadSubmissions\(\)\]\);/g) || [];

    expect(awaitedRefreshes.length).toBeGreaterThanOrEqual(2);
  });
});
