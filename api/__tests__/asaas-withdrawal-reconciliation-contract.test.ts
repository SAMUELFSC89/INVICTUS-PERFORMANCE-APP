import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Asaas withdrawal settlement contract', () => {
  test('processing state is never reopened automatically after provider submission', () => {
    const source = read('api/_lib/withdrawal-engine.ts');
    const processStart = source.indexOf('static async processPayment');
    const webhookStart = source.indexOf('static async handleAsaasTransferWebhook');
    const processBlock = source.slice(processStart, webhookStart);

    expect(processBlock).toContain("status: 'processing'");
    expect(processBlock).toContain('reconciliationRequired: true');
    expect(processBlock).not.toContain("status: 'pending'");
    expect(processBlock).not.toContain("status: 'approved'");
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
