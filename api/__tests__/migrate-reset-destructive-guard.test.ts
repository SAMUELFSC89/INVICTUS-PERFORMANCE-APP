import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(process.cwd(), 'api/_handlers/migrate-reset.ts'), 'utf8');

describe('destructive migrate-reset guardrails', () => {
  test('stays disabled by default and requires active admin authority', () => {
    expect(source).toContain("process.env.ENABLE_MIGRATE_RESET !== 'true'");
    expect(source).toContain('hasActiveAdminAuthority');
  });

  test('requires POST and an explicit destructive confirmation before mutation', () => {
    const methodGuard = source.indexOf("req.method !== 'POST'");
    const authGuard = source.indexOf('hasActiveAdminAuthority');
    const confirmation = source.indexOf("String(req.body?.confirm || '') !== REQUIRED_CONFIRMATION");
    const firstMutationRead = source.indexOf("db.collection('users').get()");
    expect(methodGuard).toBeGreaterThan(-1);
    expect(authGuard).toBeGreaterThan(methodGuard);
    expect(confirmation).toBeGreaterThan(authGuard);
    expect(firstMutationRead).toBeGreaterThan(confirmation);
    expect(source).toContain("const REQUIRED_CONFIRMATION = 'RESET_ALL_PROGRESS'");
  });

  test('chunks writes below Firestore batch limit for users, deletions and running stats', () => {
    expect(source).toContain('const MAX_BATCH_WRITES = 400');
    expect(source).toContain('async function commitInChunks');
    expect(source).toContain('offset += MAX_BATCH_WRITES');
    expect(source).toContain('commitInChunks(usersSnap.docs');
    expect(source).toContain('commitInChunks(snap.docs');
    expect(source).toContain('commitInChunks(statsSnap.docs');
  });
});
