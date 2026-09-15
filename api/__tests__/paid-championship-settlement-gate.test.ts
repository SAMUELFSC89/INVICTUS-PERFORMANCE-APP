import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'api/_lib/championship-catalog.ts'), 'utf8');

describe('Contrato — campeonato pago não abre antes do settlement final existir', () => {
  test('capacidade de settlement permanece hard-coded como não implementada', () => {
    expect(source).toContain('export const PAID_CHAMPIONSHIP_SETTLEMENT_IMPLEMENTED = false;');
  });

  test('registrationReadiness bloqueia antes de calendário/prêmios quando settlement não existe', () => {
    const start = source.indexOf('function registrationReadiness');
    const end = source.indexOf('export function listChampionships', start);
    const block = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toContain('if (!PAID_CHAMPIONSHIP_SETTLEMENT_IMPLEMENTED)');
    expect(block).toContain('A homologação e entrega da premiação ainda não foram liberadas.');
    expect(block.indexOf('PAID_CHAMPIONSHIP_SETTLEMENT_IMPLEMENTED')).toBeLessThan(block.indexOf('registrationStart'));
  });

  test('o regulamento continua exigindo premiação publicada antes da abertura', () => {
    const policy = readFileSync(resolve(process.cwd(), 'shared/paidChampionshipPolicy.ts'), 'utf8');
    expect(policy).toContain('Nenhuma edição paga pode abrir sem esses dados.');
  });
});
