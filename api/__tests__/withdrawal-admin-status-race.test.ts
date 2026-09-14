import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('withdrawal admin status race hardening', () => {
  test('admin path uses the atomic status helper instead of legacy split update/refund', () => {
    const service = read('api/_services/admin/admin-service.ts');
    expect(service).toContain("import { updateWithdrawalStatusSafely } from '../../_lib/withdrawal-admin-status.js'");
    expect(service).toContain('updateWithdrawalStatusSafely(withdrawalId, status as any, reviewerId, reason)');
    expect(service).not.toContain('WithdrawalEngine.updateWithdrawalStatus(withdrawalId');
  });

  test('status decision, wallet refund and ledger are committed in one Firestore transaction', () => {
    const source = read('api/_lib/withdrawal-admin-status.ts');
    expect(source).toContain('db.runTransaction');
    expect(source).toContain('REVIEWABLE_STATUSES.has(previousStatus)');
    expect(source).toContain("doc(`tx_res_refund_${withdrawalId}`)");
    expect(source).toContain('tx.set(walletRef');
    expect(source).toContain('tx.create(refundTxRef');
    expect(source).toContain('tx.set(withdrawalRef, patch');
  });

  test('processing and paid states cannot be overwritten by an admin refund', () => {
    const source = read('api/_lib/withdrawal-admin-status.ts');
    expect(source).toContain("const REVIEWABLE_STATUSES = new Set<WithdrawalStatus>(['pending', 'under_review', 'approved'])");
    expect(source).toContain("Saque em estado '${previousStatus}' não pode mais ser alterado manualmente.");
  });
});
