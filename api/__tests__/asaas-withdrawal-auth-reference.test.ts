import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(process.cwd(), 'api/_handlers/asaas-withdrawal-authorization.ts'), 'utf8');

describe('Asaas withdrawal authorization reference binding', () => {
  test('uses provider id first and externalReference only as the canonical recovery key', () => {
    expect(source).toContain(".where('providerTransferId', '==', transferId)");
    expect(source).toContain("db.collection('withdrawals').doc(externalReference).get()");
    expect(source).toContain('externalReference !== canonicalWithdrawalId');
  });

  test('binds the recovered provider id without settling wallet funds', () => {
    expect(source).toContain('providerTransferId: transferId');
    expect(source).toContain('providerExternalReference: externalReference || canonicalWithdrawalId');
    expect(source).not.toContain("status: 'paid'");
  });
});
