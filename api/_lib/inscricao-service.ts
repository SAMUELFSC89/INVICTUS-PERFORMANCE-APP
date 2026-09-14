import { db, FieldValue } from './common.js';
import { AsaasClient } from './asaas-client.js';
import { getOrInitCurrentSeasonWindow, calcularProximaJanela } from './season-prize-engine.js';
import { lerConfiguracaoInscricao } from './season-settings.js';
import { isActiveAccountState } from './account-state.js';

export { lerConfiguracaoInscricao };

export type StatusInscricao = 'pendente' | 'paga' | 'cancelada' | 'reembolsada' | 'contestada';

export type SeasonPaymentRiskEvent =
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_PARTIALLY_REFUNDED'
  | 'PAYMENT_REFUND_IN_PROGRESS'
  | 'PAYMENT_RECEIVED_IN_CASH_UNDONE'
  | 'PAYMENT_CHARGEBACK_REQUESTED'
  | 'PAYMENT_CHARGEBACK_DISPUTE'
  | 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL';

export async function temporadaDaInscricao(agora: Date = new Date()) {
  const atual = await getOrInitCurrentSeasonWindow();
  const jaComecou = atual.startDate.getTime() <= agora.getTime();
  return {
    janela: jaComecou ? calcularProximaJanela(atual) : atual,
    jaComecou,
  };
}

function idInscricao(userId: string, seasonId: string) {
  return `${userId}_${seasonId}`;
}

function dataBR(d: Date) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function numericPaymentValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}

function paymentAmountMatches(expected: unknown, received: unknown): boolean {
  const expectedValue = numericPaymentValue(expected);
  const receivedValue = numericPaymentValue(received);
  return expectedValue !== null && receivedValue !== null && Math.abs(expectedValue - receivedValue) < 0.01;
}

function normalizedReference(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizedProviderEventAt(value: unknown): string | null {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function isStaleProviderEvent(current: unknown, incoming: string): boolean {
  const currentMs = Date.parse(String(current || ''));
  const incomingMs = Date.parse(incoming);
  return Number.isFinite(currentMs) && Number.isFinite(incomingMs) && incomingMs < currentMs;
}

async function activeProfile(userId: string) {
  const snap = await db.collection('users').doc(userId).get();
  return snap.exists && isActiveAccountState(snap.data()) ? snap : null;
}

async function seasonProfilePatch(seasonId: string): Promise<Record<string, unknown> | null> {
  const atual = await getOrInitCurrentSeasonWindow();
  const agora = new Date();
  if (atual.seasonId === seasonId) {
    const competindoAgora = atual.startDate.getTime() <= agora.getTime() && atual.endDate.getTime() > agora.getTime();
    return {
      seasonStatus: competindoAgora ? 'ACTIVE' : 'WAITING_NEXT_SEASON',
      seasonInscritaId: seasonId,
      nextSeasonStart: competindoAgora ? '' : dataBR(atual.startDate),
      updatedAt: agora.toISOString(),
    };
  }

  const proxima = calcularProximaJanela(atual);
  if (proxima.seasonId === seasonId) {
    return {
      seasonStatus: 'WAITING_NEXT_SEASON',
      seasonInscritaId: seasonId,
      nextSeasonStart: dataBR(proxima.startDate),
      updatedAt: agora.toISOString(),
    };
  }

  return null;
}

function profileRemovalPatch(userData: Record<string, any>, seasonId: string, now: string): Record<string, unknown> | null {
  if (String(userData.seasonInscritaId || '') !== seasonId) return null;
  return {
    seasonStatus: 'NOT_ENROLLED',
    seasonInscritaId: FieldValue.delete(),
    nextSeasonStart: '',
    updatedAt: now,
  };
}

export async function sincronizarStatusDeTemporada(userId: string, seasonId: string) {
  const patch = await seasonProfilePatch(seasonId);
  if (!patch) return 'NOT_CURRENT';

  const userRef = db.collection('users').doc(userId);
  await db.runTransaction(async (transaction: any) => {
    const perfil = await transaction.get(userRef);
    if (!perfil.exists || !isActiveAccountState(perfil.data())) {
      throw new Error('Conta inativa nao pode ser sincronizada na temporada.');
    }
    transaction.set(userRef, patch, { merge: true });
  });

  return patch.seasonStatus as string;
}

export async function criarInscricao(userId: string) {
  const config = await lerConfiguracaoInscricao();
  if (!config.abertas || config.valor === null) {
    throw new Error('As inscricoes nao estao abertas no momento.');
  }

  const perfilSnap = await activeProfile(userId);
  if (!perfilSnap) throw new Error('Usuario nao encontrado ou conta inativa.');
  const perfil: any = perfilSnap.data();

  if (!perfil.gymId) {
    throw new Error('Defina sua academia no perfil antes de se inscrever na temporada.');
  }
  if (!perfil.cpf) {
    throw new Error('Complete seu CPF no perfil para emitir a cobranca da inscricao.');
  }

  const { janela } = await temporadaDaInscricao();
  const inscriptionId = idInscricao(userId, janela.seasonId);
  const ref = db.collection('season_inscriptions').doc(inscriptionId);
  const existente = await ref.get();

  if (existente.exists) {
    const dados: any = existente.data();
    if (dados.status === 'paga') {
      throw new Error('Voce ja esta inscrito nesta temporada.');
    }
    if (dados.status === 'reembolsada' || dados.status === 'contestada') {
      throw new Error('Esta inscricao possui historico financeiro encerrado ou em disputa. Uma nova cobranca exige conciliacao antes de reutilizar o registro.');
    }
    if (dados.status === 'pendente' && dados.asaasPaymentId) {
      const qr = await AsaasClient.obterQrCodePix(dados.asaasPaymentId);
      return { seasonId: janela.seasonId, valor: dados.valor, jaExistia: true, qrCode: qr };
    }
    if (dados.paymentStatus === 'RECONCILIATION_REQUIRED') {
      throw new Error('A cobranca anterior desta temporada exige conciliacao antes de uma nova tentativa.');
    }
  }

  const clienteId = await AsaasClient.criarOuObterCliente({
    nome: perfil.name || perfil.displayName || 'Atleta Invictus',
    cpf: perfil.cpf,
    email: perfil.email,
    referenciaExterna: userId,
  });

  const vencimento = new Date();
  vencimento.setDate(vencimento.getDate() + 1);

  const cobranca = await AsaasClient.criarCobrancaPix({
    clienteId,
    valor: config.valor,
    descricao: `Inscricao Liga Invictus - temporada ${janela.seasonId}`,
    referenciaExterna: inscriptionId,
    vencimento: vencimento.toISOString().slice(0, 10),
  });

  await ref.set({
    userId,
    seasonId: janela.seasonId,
    gymId: perfil.gymId,
    valor: config.valor,
    status: 'pendente' as StatusInscricao,
    paymentStatus: 'PENDING',
    externalPaymentReference: inscriptionId,
    asaasPaymentId: cobranca.id,
    asaasCustomerId: clienteId,
    criadaEm: FieldValue.serverTimestamp(),
  }, { merge: true });

  const qr = await AsaasClient.obterQrCodePix(cobranca.id);
  return { seasonId: janela.seasonId, valor: config.valor, jaExistia: false, qrCode: qr };
}

export async function confirmarInscricaoPorPagamento(
  asaasPaymentId: string,
  valorPago?: number,
  externalReference?: unknown,
  providerEventAt?: unknown,
) {
  const busca = await db.collection('season_inscriptions')
    .where('asaasPaymentId', '==', asaasPaymentId)
    .limit(1)
    .get();

  if (busca.empty) {
    console.warn('[Inscricao] pagamento sem inscricao correspondente:', asaasPaymentId);
    return { encontrada: false };
  }

  const doc = busca.docs[0];
  const docRef = doc.ref;
  const expectedReference = doc.id;
  const profilePatch = await seasonProfilePatch(String(doc.data()?.seasonId || ''));
  const receivedReference = normalizedReference(externalReference);
  const incomingEventAt = normalizedProviderEventAt(providerEventAt);
  const observedAt = incomingEventAt || new Date().toISOString();

  return db.runTransaction(async (transaction: any) => {
    const inscriptionSnap = await transaction.get(docRef);
    if (!inscriptionSnap.exists) return { encontrada: false };
    const dados: any = inscriptionSnap.data() || {};
    if (String(dados.asaasPaymentId || '') !== asaasPaymentId) {
      throw new Error('Pagamento Asaas nao corresponde mais a inscricao localizada.');
    }

    const userRef = db.collection('users').doc(String(dados.userId || ''));
    const userSnap = await transaction.get(userRef);

    if (incomingEventAt && isStaleProviderEvent(dados.paymentLifecycleObservedAt, incomingEventAt)) {
      return {
        encontrada: true,
        ignoradoComoAntigo: true,
        userId: dados.userId,
        seasonId: dados.seasonId,
      };
    }

    const referenceValid = receivedReference === expectedReference;
    const amountValid = paymentAmountMatches(dados.valor, valorPago);
    const orderingValid = Boolean(incomingEventAt);

    if (!referenceValid || !amountValid || !orderingValid) {
      const reason = !referenceValid
        ? 'PAYMENT_EXTERNAL_REFERENCE_MISMATCH'
        : !amountValid
          ? 'PAYMENT_AMOUNT_MISMATCH_OR_MISSING'
          : 'PAYMENT_EVENT_TIMESTAMP_MISSING';
      transaction.set(docRef, {
        status: 'contestada' as StatusInscricao,
        paymentStatus: 'RECONCILIATION_REQUIRED',
        reconciliationReason: reason,
        reconciliationObservedAt: observedAt,
        observedExternalReference: receivedReference,
        valorPago: numericPaymentValue(valorPago),
        paymentLifecycleObservedAt: observedAt,
      }, { merge: true });
      if (userSnap.exists) {
        const removal = profileRemovalPatch(userSnap.data() || {}, String(dados.seasonId || ''), observedAt);
        if (removal) transaction.set(userRef, removal, { merge: true });
      }
      return {
        encontrada: true,
        requerReconciliacao: true,
        motivo: reason,
        userId: dados.userId,
        seasonId: dados.seasonId,
      };
    }

    if (!userSnap.exists || !isActiveAccountState(userSnap.data())) {
      transaction.set(docRef, {
        paymentStatus: 'RECONCILIATION_REQUIRED',
        reconciliationReason: 'ACCOUNT_INACTIVE_AT_PAYMENT_CONFIRMATION',
        reconciliationObservedAt: observedAt,
        valorPago: numericPaymentValue(valorPago),
        paymentLifecycleObservedAt: observedAt,
      }, { merge: true });
      return {
        encontrada: true,
        contaInativa: true,
        requerReconciliacao: true,
        userId: dados.userId,
        seasonId: dados.seasonId,
      };
    }

    const jaEstavaPaga = dados.status === 'paga' && dados.paymentStatus === 'PAID';
    transaction.set(docRef, {
      status: 'paga' as StatusInscricao,
      paymentStatus: 'PAID',
      externalPaymentReference: expectedReference,
      valorPago: numericPaymentValue(valorPago),
      pagaEm: jaEstavaPaga ? (dados.pagaEm || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
      reconciliationReason: FieldValue.delete(),
      reconciliationObservedAt: FieldValue.delete(),
      observedExternalReference: FieldValue.delete(),
      paymentLifecycleEvent: 'PAYMENT_CONFIRMED_OR_RECEIVED',
      paymentLifecycleObservedAt: incomingEventAt,
    }, { merge: true });
    if (profilePatch) transaction.set(userRef, profilePatch, { merge: true });

    return {
      encontrada: true,
      jaEstavaPaga,
      userId: dados.userId,
      seasonId: dados.seasonId,
    };
  });
}

export async function registrarEventoFinanceiroInscricaoTemporada(
  asaasPaymentId: string,
  event: SeasonPaymentRiskEvent,
  externalReference?: unknown,
  valorObservado?: unknown,
  providerEventAt?: unknown,
) {
  const busca = await db.collection('season_inscriptions')
    .where('asaasPaymentId', '==', asaasPaymentId)
    .limit(1)
    .get();
  if (busca.empty) return { encontrada: false };

  const doc = busca.docs[0];
  const docRef = doc.ref;
  const expectedReference = doc.id;
  const receivedReference = normalizedReference(externalReference);
  const incomingEventAt = normalizedProviderEventAt(providerEventAt);
  const now = incomingEventAt || new Date().toISOString();

  return db.runTransaction(async (transaction: any) => {
    const inscriptionSnap = await transaction.get(docRef);
    if (!inscriptionSnap.exists) return { encontrada: false };
    const dados: any = inscriptionSnap.data() || {};
    if (String(dados.asaasPaymentId || '') !== asaasPaymentId) {
      throw new Error('Evento financeiro nao corresponde mais ao pagamento da inscricao.');
    }

    if (incomingEventAt && isStaleProviderEvent(dados.paymentLifecycleObservedAt, incomingEventAt)) {
      return { encontrada: true, ignoradoComoAntigo: true, userId: dados.userId, seasonId: dados.seasonId };
    }

    const userRef = db.collection('users').doc(String(dados.userId || ''));
    const userSnap = await transaction.get(userRef);
    if (!incomingEventAt || receivedReference !== expectedReference) {
      const reason = !incomingEventAt ? 'PAYMENT_EVENT_TIMESTAMP_MISSING' : 'PAYMENT_EXTERNAL_REFERENCE_MISMATCH';
      transaction.set(docRef, {
        status: 'contestada' as StatusInscricao,
        paymentStatus: 'RECONCILIATION_REQUIRED',
        reconciliationReason: reason,
        reconciliationObservedAt: now,
        observedExternalReference: receivedReference,
        paymentLifecycleEvent: event,
        paymentLifecycleObservedAt: now,
      }, { merge: true });
      if (userSnap.exists) {
        const removal = profileRemovalPatch(userSnap.data() || {}, String(dados.seasonId || ''), now);
        if (removal) transaction.set(userRef, removal, { merge: true });
      }
      return { encontrada: true, requerReconciliacao: true, userId: dados.userId, seasonId: dados.seasonId };
    }

    const refunded = event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_RECEIVED_IN_CASH_UNDONE';
    const status: StatusInscricao = refunded ? 'reembolsada' : 'contestada';
    transaction.set(docRef, {
      status,
      paymentStatus: refunded ? 'REFUNDED' : event,
      externalPaymentReference: expectedReference,
      paymentLifecycleEvent: event,
      paymentLifecycleObservedAt: incomingEventAt,
      valorEventoFinanceiro: numericPaymentValue(valorObservado),
      ...(refunded ? { reembolsadaEm: FieldValue.serverTimestamp() } : { contestedAt: FieldValue.serverTimestamp() }),
      ...(event === 'PAYMENT_PARTIALLY_REFUNDED' || event === 'PAYMENT_REFUND_IN_PROGRESS'
        ? { reconciliationReason: event, reconciliationObservedAt: incomingEventAt }
        : { reconciliationReason: FieldValue.delete(), reconciliationObservedAt: FieldValue.delete() }),
    }, { merge: true });

    if (userSnap.exists) {
      const removal = profileRemovalPatch(userSnap.data() || {}, String(dados.seasonId || ''), incomingEventAt);
      if (removal) transaction.set(userRef, removal, { merge: true });
    }

    return {
      encontrada: true,
      userId: dados.userId,
      seasonId: dados.seasonId,
      status,
      event,
    };
  });
}
