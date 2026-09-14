import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Gate 1 lifecycle and privacy hardening', () => {
  test('strict auth checks Firebase revocation and active account state', () => {
    const source = read('api/_lib/strict-auth.ts');
    expect(source).toContain('verifyIdToken(token, true)');
    expect(source).toContain('isActiveAccountState');
  });

  test('public activity sharing is grant-based, not raw activity-id based', () => {
    const access = read('api/_lib/share-access.ts');
    const handler = read('api/_handlers/activity-share.ts');
    expect(access).toContain("collection('activity_share_grants')");
    expect(access).toContain('randomBytes(24)');
    expect(handler).toContain('createActivityShareGrant');
    expect(handler).toContain('verifyStrictAuth');
  });
});
