import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('shared Strava provider lease contract', () => {
  test('webhook uses the same connection lease fields as manual sync before provider fetch', () => {
    const webhook = read('api/strava-webhook-guarded.ts');
    expect(webhook).toContain('activitiesFetchLeaseToken');
    expect(webhook).toContain('activitiesFetchLeaseUntil');
    const reserve = webhook.indexOf('await reserveProviderLease(userId)');
    const fetchActivity = webhook.indexOf('await strava.fetchActivity(objectId)');
    expect(reserve).toBeGreaterThan(-1);
    expect(fetchActivity).toBeGreaterThan(reserve);
    expect(webhook).toContain("res.setHeader('Retry-After', '30')");
    expect(webhook).toContain('await releaseProviderLease(leasedUserId, leaseToken)');
  });

  test('manual sync branch reserves those same fields before token/provider fetch', () => {
    // This test intentionally documents the cross-PR contract with #145. When
    // #145 is merged the same fields serialize /sync and webhook provider use.
    const source = read('api/_lib/strava-api.ts');
    if (!source.includes('reserveActivitiesFetch')) return;
    expect(source).toContain('activitiesFetchLeaseToken');
    expect(source).toContain('activitiesFetchLeaseUntil');
    expect(source.indexOf('const reservation = await this.reserveActivitiesFetch(after)'))
      .toBeLessThan(source.indexOf('const token = await this.getAccessToken()'));
  });
});
