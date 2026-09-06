import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('proteção do entitlement nas regras do Firestore', () => {
  const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

  it.each([
    'proEntitlement',
    'subscriptionStatus',
    'subscriptionTier',
    'isSubscribed',
    'premium',
    'isPro',
    'expiresAt',
    'subscriptionExpiresAt',
    'gracePeriodExpiresAt',
    'proStatus',
    'proActivatedAt',
    'performanceActivatedAt',
    'subscriptionStartedAt',
    'lastTransferOutAt',
    'lastTransferOutTransactionId',
    'lastTransferOutTransactionIds',
    'lastTransferInAt',
    'lastRevenueCatPurchaseEventAt',
    'lastRevenueCatPurchaseEventType',
    'lastRevenueCatPurchaseEventTransactionId',
    'proPaymentId',
    'isBlocked',
    'isBanned',
    'isSuspended',
    'isDeleted',
    'deleted',
    'accountDeleted',
    'disabled',
    'tombstone',
    'accountStatus',
    'lifecycleStatus',
    'deletionStatus',
    'deletedAt',
    'accountDeletedAt',
  ])('trata %s como campo privilegiado tanto no create quanto no update', (field) => {
    const occurrences = rules.match(new RegExp(`['\"]${field}['\"]`, 'g')) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('não permite apagar o próprio perfil e recriá-lo sem o estado do servidor', () => {
    const usersBlock = rules.slice(rules.indexOf('match /users/{userId}'), rules.indexOf('match /gyms/{gymId}'));
    expect(usersBlock).toContain('allow delete: if isAdmin();');
    expect(usersBlock).not.toContain('allow delete: if isAdmin() || isOwner(userId)');
  });

  it('nega autoridade de admin quando o perfil atual está desativado', () => {
    const authorityBlock = rules.slice(
      rules.indexOf('function isActiveAdminProfile'),
      rules.indexOf('function incoming()'),
    );

    expect(authorityBlock).toContain("data.get('role', 'user') == 'admin'");
    for (const flag of ['isBlocked', 'isBanned', 'isSuspended', 'isDeleted', 'deleted', 'accountDeleted', 'disabled', 'tombstone']) {
      expect(authorityBlock).toContain(`data.get('${flag}', false) != true`);
    }
    for (const status of ['deleted', 'blocked', 'banned', 'suspended']) {
      expect(authorityBlock).toContain(`'${status}'`);
    }
    expect(authorityBlock).toContain('isActiveAdminProfile(get(/databases/$(database)/documents/users/$(request.auth.uid)).data)');
  });
});
