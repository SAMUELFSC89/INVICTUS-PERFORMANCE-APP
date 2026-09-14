import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(process.cwd(), 'api/_lib/withdrawal-engine.ts'), 'utf8');

describe('Asaas withdrawal monotonic state', () => {
  test('provider response cannot regress a webhook terminal state to processing', () => {
    expect(source).toContain("fresh.status === 'paid' || fresh.status === 'rejected'");
    expect(source).toContain("return { conflict: false, terminal: true, reconciliation: false }");
    expect(source).toContain('if (binding.terminal)');
  });

  test('catch path never forces status back to processing', () => {
    const catchMarker = 'Nunca force status=processing aqui';
    const catchStart = source.indexOf(catchMarker);
    const webhookStart = source.indexOf('static async handleAsaasTransferWebhook', catchStart);
    expect(catchStart).toBeGreaterThan(-1);
    const catchBlock = source.slice(catchStart, webhookStart);
    expect(catchBlock).not.toContain("status: 'processing'");
    expect(catchBlock).toContain('reconciliationRequired: true');
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
