import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Contrato — temporada paga legada permanece aposentada', () => {
  test('Vercel não agenda mais o payout automático legado', () => {
    const config = read('vercel.json');
    expect(config).not.toContain('/api/season-payout-cron');
    expect(config).toContain('/api/gym-championship-payout-cron');
  });

  test('endpoint de payout legado não executa mais settlement', () => {
    const handler = read('api/_handlers/season-payout-cron.ts');
    expect(handler).toContain("code: 'PAID_SEASON_PAYOUT_DISABLED'");
    expect(handler).toContain('res.status(410)');
    expect(handler).not.toContain('runDailySeasonCheck');
    expect(handler).not.toContain('distributeSeasonPrizes');
  });

  test('status de premiação legado também é tombstone autenticado', () => {
    const handler = read('api/_handlers/season-prize.ts');
    expect(handler).toContain('verifyAuth(req)');
    expect(handler).toContain("code: 'PAID_SEASON_DISABLED'");
    expect(handler).toContain('res.status(410)');
    expect(handler).not.toContain('getSeasonParticipantsByGym');
  });

  test('dados históricos e motor permanecem disponíveis para conciliação administrativa', () => {
    const engine = read('api/_lib/season-prize-engine.ts');
    expect(engine).toContain("db.collection('season_payouts')");
    expect(engine).toContain('creditSeasonPrize');
  });
});
