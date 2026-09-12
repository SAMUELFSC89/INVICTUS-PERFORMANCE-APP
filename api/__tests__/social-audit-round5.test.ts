jest.mock('../_lib/common', () => ({
  db: { collection: jest.fn(), runTransaction: jest.fn() },
  increment: (value: number) => ({ increment: value }),
}));

import { deriveSocialStatsFromRecords } from '../_lib/user-social-stats';
import { socialAchievementsForStats } from '../../src/achievements';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('social audit round 5', () => {
  test('deduplicates repeated follow documents and ignores self relationships', () => {
    const stats = deriveSocialStatsFromRecords(
      'me',
      [{ id: 'p1' }, { id: 'p2' }],
      [
        { followerId: 'me', followingId: 'u1' },
        { followerId: 'me', followingId: 'u1' },
        { followerId: 'me', followingId: 'u2' },
        { followerId: 'me', followingId: 'me' },
      ],
      [
        { followerId: 'u3', followingId: 'me' },
        { followerId: 'u3', followingId: 'me' },
        { followerId: 'u4', followingId: 'me' },
        { followerId: 'me', followingId: 'me' },
      ],
    );

    expect(stats).toEqual({ postsCount: 2, followingCount: 2, followersCount: 2 });
  });

  test('social achievements unlock only from canonical social thresholds', () => {
    expect(socialAchievementsForStats({ postsCount: 1, followersCount: 9, followingCount: 99 }).map(item => item.id))
      .toEqual(['first_post']);
    expect(socialAchievementsForStats({ postsCount: 1, followersCount: 50, followingCount: 0 }).map(item => item.id))
      .toEqual(['first_post', 'followers_10', 'followers_50']);
  });

  test('client no longer increments protected profile counters directly', () => {
    const service = read('src/services/socialService.ts');
    expect(service).not.toContain('postsCount: increment(1)');
    expect(service).not.toContain('followingCount: increment(');
    expect(service).not.toContain('followersCount: increment(');
    expect(service).toContain("authenticatedSocialRequest('record-post-share'");
    expect(service).toContain("authenticatedSocialRequest<{ users?: UserProfile[] }>('search-users'");
    expect(service).toContain("authenticatedSocialRequest('sync-social-stats'");
  });

  test('server backfills social stats on profile reconciliation and exposes only whitelisted search fields', () => {
    const missions = read('api/_handlers/missions.ts');
    expect(missions).toContain('const socialStats = await reconcileUserSocialStats(auth.uid)');
    expect(missions).toContain("action === 'record-post-share'");
    expect(missions).toContain("action === 'search-users'");
    expect(missions).toContain("sharesCount: increment(1)");
    expect(missions).not.toContain('cpf: data.cpf');
    expect(missions).not.toContain('email: data.email');
  });
});
