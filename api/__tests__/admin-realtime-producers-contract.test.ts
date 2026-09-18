import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('admin realtime producer contracts', () => {
  test('central event catalog exposes championship lifecycle events', () => {
    const realtime = source('api/_lib/admin-realtime.ts');
    expect(realtime).toContain("'CHAMPIONSHIP_REGISTRATION_PENDING'");
    expect(realtime).toContain("'CHAMPIONSHIP_REGISTRATION_CONFIRMED'");
    expect(realtime).toContain("'CHAMPIONSHIP_PAYMENT_RECONCILIATION_REQUIRED'");
    expect(realtime).toContain("'CHAMPIONSHIP_SCORE_CHANGED'");
    expect(realtime).toContain("'CHAMPIONSHIP_SETTLEMENT_CHANGED'");
  });

  test('checkout and championship-specific webhook publish registration changes', () => {
    const handler = source('api/_handlers/championships.ts');
    expect(handler).toContain("type: 'CHAMPIONSHIP_REGISTRATION_PENDING'");
    expect(handler).toContain("source: 'championships:create-payment'");
    expect(handler).toContain("type: 'CHAMPIONSHIP_REGISTRATION_CONFIRMED'");
    expect(handler).toContain("type: 'CHAMPIONSHIP_PAYMENT_RECONCILIATION_REQUIRED'");
    expect(handler).toContain("source: 'championship-webhook:checkout-cancelled'");
    expect(handler).toContain("source: 'championship-webhook:checkout-expired'");
  });

  test('automatic scoring and review invalidation publish ranking changes', () => {
    const scoring = source('api/_lib/championship-scoring-service.ts');
    expect(scoring).toContain("type: 'CHAMPIONSHIP_SCORE_CHANGED'");
    expect(scoring).toContain("source: 'championship-score:community'");
    expect(scoring).toContain("source: 'championship-score:paid'");
    expect(scoring).toContain("source: 'championship-score:review-sync'");
  });

  test('community and paid settlement publish settlement changes', () => {
    const scoring = source('api/_lib/championship-scoring-service.ts');
    const cron = source('api/_handlers/gym-championship-payout-cron.ts');
    expect(scoring).toContain("type: 'CHAMPIONSHIP_SETTLEMENT_CHANGED'");
    expect(scoring).toContain("source: 'championship-settlement:community'");
    expect(cron).toContain("type: 'CHAMPIONSHIP_SETTLEMENT_CHANGED'");
    expect(cron).toContain("source: 'championship-settlement:cron'");
    expect(cron).toContain('paid.finalized.length > 0 || paid.blocked.length > 0');
  });
});
