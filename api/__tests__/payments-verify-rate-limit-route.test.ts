import fs from 'node:fs';
import path from 'node:path';

function read(file: string) {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

describe('purchase verification distributed guard', () => {
  test('routes the public purchase verification URL through the guarded function before the generic API rewrite', () => {
    const vercel = read('vercel.json');
    const guarded = vercel.indexOf('"source": "/api/payments/verify-purchase"');
    const generic = vercel.indexOf('"source": "/api/(.*)"');
    expect(guarded).toBeGreaterThanOrEqual(0);
    expect(generic).toBeGreaterThan(guarded);
    expect(vercel).toContain('"destination": "/api/payments-verify-purchase-guarded"');
  });

  test('authenticates before using uid as rate-limit subject and keeps the canonical billing handler', () => {
    const source = read('api/payments-verify-purchase-guarded.ts');
    expect(source.indexOf('const auth = await verifyAuth(req)')).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("scope: 'payments_verify_purchase_daily'")).toBeGreaterThan(source.indexOf('const auth = await verifyAuth(req)'));
    expect(source).toContain('maxRequests: 40');
    expect(source).toContain("scope: 'payments_verify_purchase_burst'");
    expect(source).toContain('maxRequests: 8');
    expect(source).toContain('return paymentsVerifyPurchaseHandler(req, res)');
  });
});
