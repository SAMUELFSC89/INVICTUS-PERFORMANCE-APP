import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

function block(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Bloco nao encontrado: ${startMarker}`);
  return source.slice(start, end);
}

describe('competition payment lifecycle hardening', () => {
  test('season confirmation is transactional and validates amount, reference, ordering and account lifecycle', () => {
    const source = read('api/_lib/inscricao-service.ts');
    const confirmation = block(source, 'export async function confirmarInscricaoPorPagamento', '/**\n * Suspende imediatamente');

    expect(confirmation).toContain('db.runTransaction');
    expect(confirmation).toContain('transaction.get(docRef)');
    expect(confirmation).toContain('transaction.get(userRef)');
    expect(confirmation).toContain('paymentAmountMatches(dados.valor, valorPago)');
    expect(confirmation).toContain('receivedReference === expectedReference');
    expect(confirmation).toContain('isActiveAccountState(userSnap.data())');
    expect(confirmation).toContain('isStaleProviderEvent');
    expect(confirmation).toContain("paymentStatus: 'RECONCILIATION_REQUIRED'");
    expect(confirmation).toContain("status: 'contestada'");
    expect(confirmation).toContain("status: 'paga'");
  });

  test('season refund and chargeback events immediately remove paid eligibility and current profile enrollment', () => {
    const source = read('api/_lib/inscricao-service.ts');
    const lifecycle = source.slice(source.indexOf('export async function registrarEventoFinanceiroInscricaoTemporada'));

    for (const marker of [
      'PAYMENT_REFUNDED',
      'PAYMENT_PARTIALLY_REFUNDED',
      'PAYMENT_REFUND_IN_PROGRESS',
      'PAYMENT_CHARGEBACK_REQUESTED',
      'PAYMENT_CHARGEBACK_DISPUTE',
      'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
    ]) expect(source).toContain(marker);

    expect(lifecycle).toContain("status: StatusInscricao = refunded ? 'reembolsada' : 'contestada'");
    expect(lifecycle).toContain('isStaleProviderEvent');
    expect(lifecycle).toContain('profileRemovalPatch');
    expect(source).toContain("seasonStatus: 'NOT_ENROLLED'");
    expect(source).toContain('seasonInscritaId: FieldValue.delete()');
  });

  test('refund of an old season cannot clobber a newer season enrollment', () => {
    const source = read('api/_lib/inscricao-service.ts');
    expect(source).toContain("if (String(userData.seasonInscritaId || '') !== seasonId) return null");
  });

  test('championship payment confirmation uses the same financial integrity invariants', () => {
    const source = read('api/_lib/championship-inscription-service.ts');
    const confirmation = block(source, 'export async function confirmarInscricaoChampionshipPorPagamento', 'export async function encerrarCheckoutChampionship');

    expect(confirmation).toContain('db.runTransaction');
    expect(confirmation).toContain('transaction.get(userRef)');
    expect(confirmation).toContain('paymentAmountMatches(data.valor, valorPago)');
    expect(confirmation).toContain('isStaleProviderEvent');
    expect(confirmation).toContain('isActiveAccountState(userSnap.data())');
    expect(confirmation).toContain("paymentStatus: 'RECONCILIATION_REQUIRED'");
    expect(confirmation).toContain("status: 'contestada'");
    expect(confirmation).toContain("status: 'paga'");
  });

  test('checkout-paid callback cannot reopen refunded or contested championship registration', () => {
    const source = read('api/_lib/championship-inscription-service.ts');
    const confirmation = block(source, 'export async function confirmarInscricaoChampionshipPorCheckout', 'export async function confirmarInscricaoChampionshipPorPagamento');
    expect(confirmation).toContain("data.status === 'reembolsada'");
    expect(confirmation).toContain("data.status === 'contestada'");
    expect(confirmation).toContain('transaction.get(userRef)');
  });

  test('both Asaas webhook routes apply full refund/chargeback lifecycle and provider timestamps', () => {
    const central = read('api/_handlers/asaas-webhook.ts');
    const championship = read('api/_handlers/championships.ts');

    for (const source of [central, championship]) {
      expect(source).toContain('PAYMENT_PARTIALLY_REFUNDED');
      expect(source).toContain('PAYMENT_REFUND_IN_PROGRESS');
      expect(source).toContain('PAYMENT_CHARGEBACK_REQUESTED');
      expect(source).toContain('PAYMENT_CHARGEBACK_DISPUTE');
      expect(source).toContain('PAYMENT_AWAITING_CHARGEBACK_REVERSAL');
      expect(source).toContain('dateCreated');
    }
    expect(central).toContain('registrarEventoFinanceiroInscricaoTemporada');
    expect(central).toContain('registrarEventoFinanceiroChampionship');
    expect(championship).toContain('registrarEventoFinanceiroChampionship');
    expect(central).toContain("event === 'PAYMENT_REFUND_DENIED'");
    expect(championship).toContain("event === 'PAYMENT_REFUND_DENIED'");
  });

  test('paid season revenue remains sourced only from financially paid inscriptions', () => {
    const engine = read('api/_lib/season-prize-engine.ts');
    const revenue = block(engine, 'export async function computeSeasonRevenueByGym', 'export async function getSeasonParticipants');
    expect(revenue).toContain("where('status', '==', 'paga')");
  });
});
