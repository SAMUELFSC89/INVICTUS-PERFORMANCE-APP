import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(process.cwd(), 'api/_lib/withdrawal-engine.ts'), 'utf8');

describe('Asaas withdrawal monotonic state', () => {
  test('provider response cannot regress a webhook terminal state to processing', () => {
    expect(source).toContain("fresh.status === 'paid' || fresh.status === 'rejected'");
    expect(source).toContain("return { conflict: false, terminal: true, reconciliation: false }");
    expect(source).toContain('if (binding.terminal)');
  });

  test('deterministic provider rejection reopens the withdrawal but ambiguous failures stay in reconciliation', () => {
    const processStart = source.indexOf('static async processPayment');
    const reconcileStart = source.indexOf('static async reconcileProviderSubmission', processStart);
    expect(processStart).toBeGreaterThan(-1);
    const processBlock = source.slice(processStart, reconcileStart);
    expect(processBlock).toContain('err instanceof AsaasRequestError && err.deterministic');
    expect(processBlock).toContain("status: 'approved'");
    expect(processBlock).toContain("providerStatus: 'REJECTED_BEFORE_CREATION'");
    expect(processBlock).toContain("reconciliationReason: 'PROVIDER_SUBMISSION_UNCERTAIN'");
    expect(processBlock).toContain('reconciliationRequired: true');
  });

  test('existing reconciliation is not silently cleared by a late provider response', () => {
    expect(source).toContain('fresh.reconciliationRequired === true');
    expect(source).toContain("reconciliationReason: 'PROVIDER_RESPONSE_AFTER_UNEXPECTED_STATE'");
  });

  test('legacy updateWithdrawalStatus delegates to the atomic status helper', () => {
    expect(source).toContain("import { updateWithdrawalStatusSafely } from './withdrawal-admin-status.js'");
    expect(source).toContain('return updateWithdrawalStatusSafely(withdrawalId, newStatus, reviewerId, adminNote)');
  });
});
