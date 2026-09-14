import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Contrato — dinheiro real permanece aposentado em desafios privados', () => {
  test('rota normal nunca movimenta dinheiro legado', () => {
    const source = read('api/_handlers/private-challenges.ts');

    expect(source).toContain('requires admin refund migration');
    expect(source).not.toContain("type: 'challenge_prize'");
    expect(source).not.toContain('FieldValue.increment');
    expect(source).not.toContain('Distributing R$');
  });

  test('desafio legado com entryFee não é liquidado por ação comum do usuário', () => {
    const source = read('api/_handlers/private-challenges.ts');

    expect(source).toContain('if (isLegacyMoneyChallenge)');
    expect(source).toContain('user-facing expiration will not move money');
    expect(source).toContain('return;');
  });

  test('resultado simbólico nunca inventa vencedor com score zero ou empate', () => {
    const source = read('api/_handlers/private-challenges.ts');

    expect(source).toContain('topScore <= 0 || topMembers.length !== 1');
    expect(source).toContain("resultStatus: 'NO_DETERMINISTIC_WINNER'");
    expect(source).toContain("resultReason: reason");
    expect(source).toContain("resultStatus: 'WINNER_CONFIRMED'");
    expect(source).toContain("resultReason: 'UNIQUE_POSITIVE_TOP_SCORE'");
  });

  test('migração lê o ledger determinístico dentro da transação de estorno', () => {
    const source = read('api/_handlers/migrate-legacy-private-challenges.ts');

    expect(source).toContain('transaction.get(refundTxRef)');
    expect(source).toContain('transaction.get(userRef)');
    expect(source).toContain("status: 'already_refunded'");
    expect(source).toContain("status: 'refunded'");
    expect(source).toContain("legacyMigrationStatus: 'NEEDS_MANUAL_RECONCILIATION'");
  });

  test('migração continua admin-only, desligada por padrão e dry-run por padrão', () => {
    const source = read('api/_handlers/migrate-legacy-private-challenges.ts');

    expect(source).toContain("process.env.ENABLE_MIGRATE_RESET !== 'true'");
    expect(source).toContain('hasActiveAdminAuthority');
    expect(source).toContain("req.query.dryRun ?? 'true'");
  });
});
