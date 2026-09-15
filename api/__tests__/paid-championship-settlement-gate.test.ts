import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const catalog = readFileSync(resolve(process.cwd(), 'api/_lib/championship-catalog.ts'), 'utf8');
const settlement = readFileSync(resolve(process.cwd(), 'api/_lib/paid-championship-settlement.ts'), 'utf8');
const prizeCredit = readFileSync(resolve(process.cwd(), 'api/_lib/championship-prize-credit.ts'), 'utf8');

describe('Contrato — campeonato pago só abre com settlement final e edição publicada', () => {
  test('capacidade de settlement só fica habilitada junto do motor monetário auditável', () => {
    expect(catalog).toContain('export const PAID_CHAMPIONSHIP_SETTLEMENT_IMPLEMENTED = true;');
    expect(settlement).toContain('export async function finalizePaidChampionship');
    expect(settlement).toContain("status: 'LOCKED'");
    expect(prizeCredit).toContain('export async function creditChampionshipPrize');
    expect(prizeCredit).toContain("category: 'redeemable'");
    expect(prizeCredit).toContain("origin: 'championship'");
  });

  test('a liberação comercial continua separada e fail-closed por configuração', () => {
    const start = catalog.indexOf('function registrationReadiness');
    const end = catalog.indexOf('export function listChampionships', start);
    const block = catalog.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toContain("env('PAID_CHAMPIONSHIP_REGISTRATION_ENABLED').toLowerCase() !== 'true'");
    expect(block).toContain('if (!PAID_CHAMPIONSHIP_SETTLEMENT_IMPLEMENTED)');
    expect(block.indexOf('PAID_CHAMPIONSHIP_REGISTRATION_ENABLED')).toBeLessThan(block.indexOf('registrationStart'));
    expect(block).toContain('settlementAt <= competitionEnd');
    expect(block).toContain('championship.prizeDistribution.length');
    expect(block).toContain('championship.publishedConfigDigest');
  });

  test('o regulamento publica premiação, homologação, desempate e bloqueios financeiros', () => {
    const policy = readFileSync(resolve(process.cwd(), 'shared/paidChampionshipPolicy.ts'), 'utf8');
    expect(policy).toContain('A premiação, quantidade de posições premiadas, valores e data de homologação são publicados');
    expect(policy).toContain('maior número de atividades válidas');
    expect(policy).toContain('empate técnico em posição premiada');
    expect(policy).toContain('Inscrição em disputa ou conciliação bloqueia a homologação financeira');
  });
});
