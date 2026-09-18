import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('web admin backoffice contracts', () => {
  test('financial overview stays behind authenticated active-admin authority', () => {
    const endpoint = source('api/admin-financial-overview.ts');
    expect(endpoint).toContain('authMiddleware');
    expect(endpoint).toContain('hasActiveAdminAuthority');
    expect(endpoint).toContain("methodMiddleware(req, res, ['GET'])");
    expect(endpoint).toContain('getAdminFinancialOverview');
  });

  test('revenue series uses canonical paid sources and paid timestamps', () => {
    const finance = source('api/_lib/admin-financial-overview.ts');
    expect(finance).toContain("db.collection('payment_orders')");
    expect(finance).toContain(".where('status', '==', 'approved')");
    expect(finance).toContain(".where('paidAt', '>=', start.toISOString())");
    expect(finance).toContain("db.collection('championship_registrations')");
    expect(finance).toContain(".where('paymentStatus', '==', 'PAID')");
    expect(finance).toContain(".where('status', '==', 'paga')");
    expect(finance).toContain('data.pagaEm');
    expect(finance).toContain('grossRevenue');
    expect(finance).toContain('championships:');
    expect(finance).toContain('monthly:');
    expect(finance).toContain('daily:');
    expect(finance).toContain('byCategory:');
  });

  test('power lift manual review remains server-authoritative and auditable', () => {
    const handler = source('api/_handlers/admin.ts');
    const helper = source('api/_lib/powerlift-admin.ts');
    expect(handler).toContain('hasActiveAdminAuthority');
    expect(handler).toContain("case 'list-powerlift-reviews'");
    expect(handler).toContain("case 'get-powerlift-review-video'");
    expect(handler).toContain("case 'review-powerlift-record'");
    expect(helper).toContain("record.videoStatus !== 'manual_review'");
    expect(helper).toContain('getSignedUrl');
    expect(helper).toContain('power_audit_logs');
    expect(helper).toContain('admin_reviews');
  });
});
