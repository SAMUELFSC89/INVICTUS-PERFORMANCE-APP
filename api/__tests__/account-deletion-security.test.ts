import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasActiveAdminAuthority } from '../_lib/admin-authority.js';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('exclusão administrativa de conta', () => {
  test('rejeita autoridade administrativa de toda conta desativada', () => {
    expect(hasActiveAdminAuthority({ role: 'admin' })).toBe(true);

    for (const status of ['deleted', 'blocked', 'banned', 'suspended', 'DELETED']) {
      expect(hasActiveAdminAuthority({ role: 'admin', status })).toBe(false);
      expect(hasActiveAdminAuthority({ role: 'admin', accountStatus: status })).toBe(false);
      expect(hasActiveAdminAuthority({ role: 'admin', lifecycleStatus: status })).toBe(false);
    }

    for (const flag of [
      'isBlocked', 'isBanned', 'isSuspended', 'isDeleted', 'deleted',
      'accountDeleted', 'disabled', 'tombstone',
    ]) {
      expect(hasActiveAdminAuthority({ role: 'admin', [flag]: true })).toBe(false);
    }

    expect(hasActiveAdminAuthority({ role: 'admin', deletedAt: '2026-09-06T00:00:00.000Z' })).toBe(false);
    expect(hasActiveAdminAuthority({ role: 'admin', deletionStatus: 'completed' })).toBe(false);
    expect(hasActiveAdminAuthority({ role: 'user' })).toBe(false);
  });

  test('passa somente pelo servidor, preserva tombstone e desabilita a identidade', () => {
    const adminHandler = source('api/_handlers/admin.ts');
    const dashboard = source('src/pages/AdminDashboard.tsx');
    const profile = source('api/_handlers/profile.ts');
    const rules = source('firestore.rules');

    expect(adminHandler).toContain("case 'delete-user'");
    expect(adminHandler).toContain("collection('deleted_users')");
    expect(adminHandler).toContain('updateUser(uid, { disabled: true })');
    expect(adminHandler).toContain('revokeRefreshTokens(uid)');
    expect(adminHandler).toContain("role: 'user'");
    expect(adminHandler).toContain('isAdmin: false');
    expect(dashboard).not.toContain('deleteDoc(');
    expect(profile).toContain("code: 'ACCOUNT_DELETED'");
    expect(rules).toContain('match /deleted_users/{userId}');
    expect(rules).toContain('allow read, write: if false;');
  });
});
