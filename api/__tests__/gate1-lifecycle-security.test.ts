import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

function functionBlock(source: string, name: string, nextMarker: string): string {
  const start = source.indexOf(name);
  const end = source.indexOf(nextMarker, start + name.length);
  if (start < 0 || end < 0) throw new Error(`Contract block not found: ${name}`);
  return source.slice(start, end);
}

describe('Gate 1 lifecycle and privacy hardening', () => {
  test('shared authentication rejects revoked tokens and inactive existing accounts', () => {
    const source = read('api/_lib/common.ts');
    expect(source).toContain('verifyIdToken(token, true)');
    expect(source).toContain('isActiveAccountState(profileSnap.data())');
    expect(source).toContain("collection('deleted_users').doc(decodedToken.uid)");
  });

  test('strict auth additionally requires an existing active application account', () => {
    const source = read('api/_lib/strict-auth.ts');
    expect(source).toContain('verifyIdToken(token, true)');
    expect(source).toContain('isActiveAccountState');
  });

  test('season prize idempotency is bound to the original season and gym', () => {
    const rewards = read('api/_lib/rewards-engine.ts');
    const engine = read('api/_lib/season-prize-engine.ts');
    const ledger = read('api/_lib/season-payout-credit.ts');

    expect(rewards).not.toContain("collection('system_config').doc('season_tracker')");
    expect(rewards).toContain("settlement: { seasonId: string; gymId?: string }");
    expect(engine).toContain('{ seasonId: season.seasonId, gymId: winner.gymId }');
    expect(ledger).toContain(".update(`${input.seasonId}|${input.userId}|${input.gymId || ''}|${input.rank}`)");
    expect(ledger).toContain("collection('season_prize_settlements')");
    expect(ledger).toContain("status: 'INELIGIBLE'");
    expect(ledger).toContain('transaction.create(txRef');
  });

  test('season payout freezes its complete winner plan before issuing any credit', () => {
    const engine = read('api/_lib/season-prize-engine.ts');
    const planWrite = engine.indexOf("status: 'PROCESSING'");
    const creditLoop = engine.indexOf('for (const winner of frozenPlan.result.winners)');
    expect(planWrite).toBeGreaterThan(0);
    expect(creditLoop).toBeGreaterThan(planWrite);
    expect(engine).toContain('payoutResultFromStored');
    expect(engine).toContain("status: 'DISTRIBUTED'");
  });

  test('inactive athlete is removed from competition without erasing already-paid pool revenue', () => {
    const engine = read('api/_lib/season-prize-engine.ts');
    const revenueBlock = functionBlock(engine, 'export async function computeSeasonRevenueByGym', 'export async function getSeasonParticipants');
    const participantBlock = functionBlock(engine, 'export async function getSeasonParticipantsByGym', 'function payoutResultFromStored');

    expect(revenueBlock).toContain("where('status', '==', 'paga')");
    expect(revenueBlock).not.toContain('activeUserIdSet');
    expect(revenueBlock).not.toContain('isActiveAccountState');
    expect(participantBlock).toContain('isActiveAccountState');
  });

  test('late Asaas payments for inactive accounts go to reconciliation instead of reactivation', () => {
    const season = read('api/_lib/inscricao-service.ts');
    const championship = read('api/_lib/championship-inscription-service.ts');
    expect(season).toContain("paymentStatus: 'RECONCILIATION_REQUIRED'");
    expect(season).toContain("reconciliationReason: 'ACCOUNT_INACTIVE_AT_PAYMENT_CONFIRMATION'");
    expect(championship).toContain("paymentStatus: 'RECONCILIATION_REQUIRED'");
    expect(championship).toContain("paymentReconciliationReason: 'ACCOUNT_INACTIVE_AT_PAYMENT_CONFIRMATION'");
  });

  test('championship checkout creation is leased and ambiguous failures fail closed', () => {
    const source = read('api/_lib/championship-inscription-service.ts');
    expect(source).toContain("checkoutCreationStatus: 'CREATING'");
    expect(source).toContain("checkoutCreationStatus: 'UNCERTAIN'");
    expect(source).toContain('checkoutCreationLeaseToken');
    expect(source).toContain('exige conciliacao antes de uma nova cobranca');
  });

  test('public activity sharing is grant-based and revocable, not raw activity-id based', () => {
    const access = read('api/_lib/share-access.ts');
    const createHandler = read('api/_handlers/activity-share.ts');
    const publicHandler = read('api/_handlers/share.ts');
    expect(access).toContain("collection('activity_share_grants')");
    expect(access).toContain('randomBytes(24)');
    expect(access).toContain('revokeActivityShareGrant');
    expect(createHandler).toContain('createActivityShareGrant');
    expect(createHandler).toContain('revokeActivityShareGrant');
    expect(createHandler).toContain('verifyStrictAuth');
    expect(publicHandler).toContain('resolveActivityShareGrant');
    expect(publicHandler).not.toContain("collection('workouts').doc(id");
  });

  test('approved public share visual remains intact while the token is hardened', () => {
    const source = read('api/_handlers/share.ts');
    for (const marker of ['Space Grotesk', 'class="container"', 'class="xp-badge"', '/capacete.webp']) {
      expect(source).toContain(marker);
    }
  });

  test('share-image blocks arbitrary remote fetches and bounds trusted image downloads', () => {
    const handler = read('api/_handlers/share-image.ts');
    const policy = read('api/_lib/share-image-policy.ts');
    expect(handler).toContain("redirect: 'error'");
    expect(handler).toContain('AbortSignal.timeout(5_000)');
    expect(handler).toContain('MAX_IMAGE_BYTES');
    expect(handler).toContain("contentType.startsWith('image/')");
    expect(policy).toContain('firebasestorage.googleapis.com');
    expect(policy).toContain('storage.googleapis.com');
  });

  test('Strava validates account lifecycle and uses the provider revocation endpoint', () => {
    const source = read('api/_lib/strava-api.ts');
    expect(source).toContain('isActiveAccountState');
    expect(source).toContain('isDeletedAccountState');
    expect(source).toContain('https://www.strava.com/oauth/revoke');
  });

  test('new reward-coin settlements cannot credit inactive users', () => {
    const source = read('api/_lib/reward-coin-engine.ts');
    expect(source).toContain('transaction.get(userRef)');
    expect(source).toContain('isActiveAccountState(userSnap.data())');
  });
});
