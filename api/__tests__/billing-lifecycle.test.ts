import fs from 'node:fs';
import path from 'node:path';
import { billingAccountStatusPatch } from '../_lib/billing-lifecycle';

const source = fs.readFileSync(path.join(process.cwd(), 'api/_lib/payments-service.ts'), 'utf8');

describe('billing lifecycle ownership', () => {
  test('active profiles may receive the subscription display status', () => {
    expect(billingAccountStatusPatch({ status: 'active' }, 'PRO_ATIVO')).toEqual({ status: 'PRO_ATIVO' });
    expect(billingAccountStatusPatch({ accountStatus: 'active' }, 'OPEN_ATIVO')).toEqual({ status: 'OPEN_ATIVO' });
  });

  test.each([
    { status: 'suspended' },
    { status: 'blocked' },
    { accountStatus: 'banned' },
    { lifecycleStatus: 'suspended' },
    { isBlocked: true },
    { isBanned: true },
    { isSuspended: true },
    { disabled: true },
    { tombstone: true },
    { deletedAt: '2026-09-15T00:00:00.000Z' },
    { deletionStatus: 'completed' },
  ])('billing cannot overwrite inactive account status %#', (profile) => {
    expect(billingAccountStatusPatch(profile, 'PRO_ATIVO')).toEqual({});
    expect(billingAccountStatusPatch(profile, 'OPEN_ATIVO')).toEqual({});
  });

  test('grant, Open activation and revoke all use the lifecycle-preserving projection', () => {
    expect(source).toContain("import { billingAccountStatusPatch } from './billing-lifecycle.js'");
    expect((source.match(/billingAccountStatusPatch\(userData, 'PRO_ATIVO'\)/g) || [])).toHaveLength(1);
    expect((source.match(/billingAccountStatusPatch\(userData, 'OPEN_ATIVO'\)/g) || [])).toHaveLength(2);
    expect(source).not.toContain("isSubscribed: true,\n        status: 'PRO_ATIVO'");
    expect(source).not.toContain("isSubscribed: false,\n        status: 'OPEN_ATIVO'");
  });
});
