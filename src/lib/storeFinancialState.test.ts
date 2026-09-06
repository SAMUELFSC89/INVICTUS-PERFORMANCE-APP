import { copyTextToClipboard } from './clipboard';
import { getStoreFinancialState } from './storeFinancialState';

const pendingPixOrder = {
  status: 'PENDING_PAYMENT' as const,
  paymentMethod: 'MONEY' as const,
  totalCashAmount: 129.9,
  totalCoinAmount: 0,
  paymentStatus: 'AWAITING_PAYMENT',
  coinReservationStatus: 'NONE' as const,
  cancellationStatus: 'NONE' as const,
  refundStatus: 'NONE' as const,
  financialReviewRequired: false,
  financialActionRequired: null,
  financialOperationError: null,
};

describe('store financial state', () => {
  it('allows the canonical PIX only while the pending order is financially clear', () => {
    const state = getStoreFinancialState(pendingPixOrder);

    expect(state.canShowPix).toBe(true);
    expect(state.canResumePix).toBe(true);
    expect(state.canCancelPendingOrder).toBe(true);
  });

  it.each([
    [{ cancellationStatus: 'REQUESTED' as const }, 'cancelamento'],
    [{ cancellationStatus: 'RECONCILIATION_PENDING' as any }, 'cancelamento'],
    [{ paymentStatus: 'CANCELLATION_REQUESTED' }, 'cancelamento'],
    [{ refundStatus: 'REQUESTED' as const }, 'estorno'],
    [{ refundStatus: 'IN_PROGRESS' as const }, 'estorno'],
    [{ refundStatus: 'RECONCILIATION_PENDING' as any }, 'estorno'],
    [{ refundStatus: 'PARTIAL' as const }, 'revisão'],
    [{ paymentStatus: 'CHARGEBACK_REQUESTED' }, 'contestação'],
    [{ paymentStatus: 'OVERDUE' }, 'venceu'],
    [{ paymentStatus: 'AMOUNT_MISMATCH' }, 'revisão'],
    [{ financialReviewRequired: true }, 'revisão'],
    [{ financialActionRequired: 'RETURN_REVIEW' }, 'revisão'],
  ])('blocks PIX for unresolved financial state %#', (change, expectedMessage) => {
    const state = getStoreFinancialState({ ...pendingPixOrder, ...change });

    expect(state.canShowPix).toBe(false);
    expect(state.canResumePix).toBe(false);
    expect(state.canCancelPendingOrder).toBe(false);
    expect(state.buyerMessage?.toLocaleLowerCase('pt-BR')).toContain(expectedMessage);
  });

  it('allows fulfillment only after cash and Coins are both settled', () => {
    const paid = {
      ...pendingPixOrder,
      status: 'PAID' as const,
      paymentMethod: 'COINS_PLUS_MONEY' as const,
      totalCoinAmount: 500,
      paymentStatus: 'PAID',
      coinReservationStatus: 'CONSUMED' as const,
    };

    expect(getStoreFinancialState(paid).blocksFulfillment).toBe(false);
    expect(getStoreFinancialState({ ...paid, paymentStatus: undefined }).blocksFulfillment).toBe(true);
    expect(getStoreFinancialState({ ...paid, coinReservationStatus: 'HELD' }).blocksFulfillment).toBe(true);
  });

  it('fails closed when a Coins order has no confirmed payment state', () => {
    const state = getStoreFinancialState({
      ...pendingPixOrder,
      status: 'PROCESSING',
      paymentMethod: 'COINS',
      totalCashAmount: 0,
      totalCoinAmount: 500,
      paymentStatus: undefined,
      coinReservationStatus: 'CONSUMED',
    });

    expect(state.blocksFulfillment).toBe(true);
    expect(state.fulfillmentBlockReason).toContain('Pagamento não confirmado');
  });

  it('allows retrying the same intent after an isolated payment creation failure', () => {
    const state = getStoreFinancialState({ ...pendingPixOrder, paymentStatus: 'FAILED' });

    expect(state.canResumePix).toBe(true);
    expect(state.canShowPix).toBe(true);
    expect(state.blocksFulfillment).toBe(true);
    expect(state.buyerMessage).toContain('mesmo pedido');
  });

  it.each([
    { financialReviewRequired: true },
    { paymentStatus: 'CHARGEBACK_REQUESTED' },
    { refundStatus: 'PARTIAL' as const },
    { cancellationStatus: 'REQUESTED' as const },
    { refundStatus: 'IN_PROGRESS' as const },
    { financialOperationError: 'resultado incerto' },
  ])('blocks fulfillment for financial exception %#', change => {
    const state = getStoreFinancialState({
      ...pendingPixOrder,
      status: 'PAID',
      paymentStatus: 'PAID',
      ...change,
    });

    expect(state.blocksFulfillment).toBe(true);
    expect(state.fulfillmentBlockReason).toBeTruthy();
  });
});

describe('copyTextToClipboard', () => {
  it('reports success only after writeText resolves', async () => {
    let resolveWrite: (() => void) | undefined;
    const writeText = jest.fn(() => new Promise<void>(resolve => { resolveWrite = resolve; }));
    const resultPromise = copyTextToClipboard('pix', { writeText });
    let settled = false;
    void resultPromise.then(() => { settled = true; });

    await Promise.resolve();
    expect(settled).toBe(false);
    resolveWrite?.();

    await expect(resultPromise).resolves.toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith('pix');
  });

  it('returns instructions when the Clipboard API is unavailable', async () => {
    const result = await copyTextToClipboard('pix', null);

    expect(result.ok).toBe(false);
    if ('message' in result) expect(result.message).toContain('copie manualmente');
  });

  it('captures clipboard rejection without leaking it', async () => {
    const writeText = jest.fn().mockRejectedValue(new Error('denied'));

    await expect(copyTextToClipboard('pix', { writeText })).resolves.toMatchObject({ ok: false });
  });
});
