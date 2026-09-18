import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Asaas withdrawal settlement contract', () => {
  test('only deterministic pre-creation rejection may reopen automatically', () => {
    const source = read('api/_lib/withdrawal-engine.ts');
    const processStart = source.indexOf('static async processPayment');
    const reconcileStart = source.indexOf('static async reconcileProviderSubmission', processStart);
    const processBlock = source.slice(processStart, reconcileStart);

    expect(processBlock).toContain("status: 'processing'");
    expect(processBlock).toContain('err instanceof AsaasRequestError && err.deterministic');
    expect(processBlock).toContain("status: 'approved'");
    expect(processBlock).toContain("providerStatus: 'REJECTED_BEFORE_CREATION'");
    expect(processBlock).toContain("reconciliationReason: 'PROVIDER_SUBMISSION_UNCERTAIN'");
    expect(processBlock).not.toContain("status: 'pending'");
  });

  test('operator reconciliation queries Asaas before reopening an uncertain withdrawal', () => {
    const source = read('api/_lib/withdrawal-engine.ts');
    expect(source).toContain('AsaasClient.findTransferByExternalReference');
    expect(source).toContain("providerStatus: 'NOT_FOUND_AFTER_RECONCILIATION'");
    expect(source).toContain('providerRecoveredBy: reviewerId');
  });

  test('terminal provider events require exact amount before wallet settlement', () => {
    const source = read('api/_lib/withdrawal-engine.ts');
    expect(source).toContain("const numericProviderValue = typeof providerValue === 'number' ? providerValue : Number.NaN");
    expect(source).toContain('Math.abs(numericProviderValue - internalAmount) >= 0.01');
    expect(source).toContain("reconciliationReason: 'PROVIDER_AMOUNT_MISMATCH_OR_MISSING'");
    expect(source).toContain("return { outcome: 'reconciliation', withdrawal }");
  });

  test('provider binding conflict fails closed instead of rebinding the withdrawal', () => {
    const source = read('api/_lib/withdrawal-engine.ts');
    expect(source).toContain('withdrawal.providerTransferId !== canonicalTransferId');
    expect(source).toContain("reconciliationReason: 'PROVIDER_TRANSFER_ID_CONFLICT'");
    expect(source).toContain('conflictingProviderTransferId: canonicalTransferId');
  });

  test('contradictory terminal provider events are held for reconciliation', () => {
    const source = read('api/_lib/withdrawal-engine.ts');
    expect(source).toContain("reconciliationReason: 'PROVIDER_TERMINAL_STATE_CONFLICT'");
    expect(source).toContain("succeeded && withdrawal.status === 'rejected'");
    expect(source).toContain("failed && withdrawal.status === 'paid'");
  });

  test('wallet anomalies are persisted as reconciliation instead of silently settling', () => {
    const source = read('api/_lib/withdrawal-engine.ts');
    expect(source).toContain("reconciliationReason: 'WALLET_NOT_FOUND'");
    expect(source).toContain("reconciliationReason: 'BLOCKED_BALANCE_INCONSISTENT'");
  });
});
