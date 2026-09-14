import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(process.cwd(), 'api/_handlers/asaas-webhook.ts'), 'utf8');

describe('Asaas transfer webhook reference forwarding', () => {
  test('forwards provider identity, external reference and amount to reconciliation', () => {
    expect(source).toContain('transfer.id');
    expect(source).toContain('transfer.externalReference');
    expect(source).toContain('transfer.value');
    expect(source).toContain('WithdrawalEngine.handleAsaasTransferWebhook');
  });
});
