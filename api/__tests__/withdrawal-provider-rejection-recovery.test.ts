import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('admin withdrawal provider recovery', () => {
  test('admin exposes a guarded reconciliation action for processing withdrawals without provider id', () => {
    const handler = read('api/_handlers/admin.ts');
    const service = read('api/_services/admin/admin-service.ts');
    const payouts = read('src/pages/AdminPayouts.tsx');
    const client = read('api/_lib/asaas-client.ts');

    expect(handler).toContain("case 'reconcile-withdrawal-provider'");
    expect(service).toContain('reconcileWithdrawalProviderSubmission');
    expect(payouts).toContain("requestAdmin('reconcile-withdrawal-provider'");
    expect(payouts).toContain('item.reconciliationRequired && !item.providerTransferId');
    expect(client).toContain('findTransferByExternalReference');
    expect(client).toContain("query.set('dateCreated[ge]', sinceDate)");
  });

  test('approved withdrawal can be cancelled to release the held balance after a rejected destination key', () => {
    const payouts = read('src/pages/AdminPayouts.tsx');
    const statusHelper = read('api/_lib/withdrawal-admin-status.ts');

    expect(payouts).toContain("updateStatus(item, 'cancelled')");
    expect(statusHelper).toContain("newStatus === 'cancelled' || newStatus === 'rejected'");
    expect(statusHelper).toContain('withdrawal_refund');
  });

  test('wallet tells operators when Asaas is in Sandbox', () => {
    const financial = read('api/_handlers/financial.ts');
    const wallet = read('src/pages/PrizeWallet.tsx');

    expect(financial).toContain("paymentEnvironment: isStrictAsaasSandbox() ? 'sandbox' : 'production'");
    expect(wallet).toContain('Ambiente Asaas Sandbox');
    expect(wallet).toContain('chave PIX de homologação');
  });
});
