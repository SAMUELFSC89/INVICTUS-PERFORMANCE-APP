import { randomUUID } from 'node:crypto';
import { db, FieldValue } from './common.js';
import { AsaasClient } from './asaas-client.js';
import { getChampionship, isRegistrationOpen } from './championship-catalog.js';
import {
  lockPaidChampionshipEdition,
  paidChampionshipRegistrationId,
  paidChampionshipSettlementDocumentId,
} from './paid-championship-edition.js';
import { COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION } from '../../shared/competitiveHeartRatePolicy.js';
import { isActiveAccountState } from './account-state.js';

export type StatusInscricaoChampionship = 'pendente' | 'paga' | 'cancelada' | 'reembolsada' | 'contestada';
export type ChampionshipCheckoutSurface = 'ios_native' | 'web';
export type ChampionshipPaymentRiskEvent =
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_PARTIALLY_REFUNDED'
  | 'PAYMENT_REFUND_IN_PROGRESS'
  | 'PAYMENT_RECEIVED_IN_CASH_UNDONE'
  | 'PAYMENT_CHARGEBACK_REQUESTED'
  | 'PAYMENT_CHARGEBACK_DISPUTE'
  | 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL';

const CHECKOUT_CREATION_LEASE_MS = 90_000;

function publicAppOrigin(): string {
  const configured = String(process.env.PUBLIC_APP_URL || process.env.APP_BASE_URL || '').trim();
  if (configured && /^https:\/\//i.test(configured)) return configured.replace(/\/$/, '');
  return 'https://invictusperformance.app.br';
}

function checkoutReturnUrl(status: 'success' | 'cancelled' | 'expired', championshipId: string): string {
  const query = new URLSearchParams({ status, championshipId }).toString();
  return `${publicAppOrigin()}/championship-checkout-return.html?${query}`;
}

function checkoutLinkFromId(id: string): string {
  const env = String(process.env.ASAAS_ENVIRONMENT || '').trim().toLowerCase();
  const host = env === 'production' ? 'https://asaas.com' : 'https://sandbox.asaas.com';
  return `${host}/checkoutSession/show?id=${encodeURIComponent(id)}`;
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

async function getActiveProfile(userId: string) {
  const snap = await db.collection('users').doc(userId).get();
  return snap.exists && isActiveAccountState(snap.data()) ? snap : null;
}

function settlementRefForRegistration(data: any) {
  const editionId = String(data?.editionId || '').trim();
  return editionId
    ? db.collection('championship_settlements').doc(paidChampionshipSettlementDocumentId(editionId))
    : null;
}

export async function registrarAceiteRegulamento(params: {
  userId: string;
  championshipId: string;
  regulationVersion: string;
  regulationHash: string;
  ip: string;
  userAgent?: string;
  locale?: string;
  platform?: string;
  hrAcknowledgementId: string;
  hrAcknowledgementVersion: string;
}) {
  const champ = getChampionship(params.championshipId);
  if (!champ) throw new Error('Campeonato nao encontrado.');
  if (!await getActiveProfile(params.userId)) throw new Error('Conta inativa nao pode participar de campeonato.');
  if (params.regulationVersion !== champ.regulationVersion || params.regulationHash !== champ.regulationHash) {
    throw new Error('O regulamento submetido esta desatualizado ou com hash divergente do oficial vigente.');
  }
  if (!params.hrAcknowledgementId || params.hrAcknowledgementVersion !== COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION) {
    throw new Error('O aceite vigente sobre frequência cardíaca é obrigatório antes da inscrição.');
  }

  const acceptanceId = `acc_${params.userId}_${champ.editionId}_${Date.now()}`;
  const acceptedAt = new Date().toISOString();
  await db.collection('championship_acceptances').doc(acceptanceId).set({
    acceptanceId,
    userId: params.userId,
    championshipId: params.championshipId,
    editionId: champ.editionId,
    regulationVersion: champ.regulationVersion,
    regulationHash: champ.regulationHash,
    acceptedAt,
    ip: params.ip,
    userAgent: params.userAgent || null,
    locale: params.locale || 'pt-BR',
    platform: params.platform || 'web',
    hrAcknowledgementId: params.hrAcknowledgementId,
    hrAcknowledgementVersion: params.hrAcknowledgementVersion,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { acceptanceId, editionId: champ.editionId, regulationVersion: champ.regulationVersion, regulationHash: champ.regulationHash, acceptedAt };
}

export async function criarInscricaoChampionship(
  userId: string,
  championshipId: string,
  acceptanceId: string,
  checkoutSurface?: ChampionshipCheckoutSurface,
) {
  const champ = getChampionship(championshipId);
  if (!champ) throw new Error('Campeonato nao encontrado.');
  if (!isRegistrationOpen(champ)) throw new Error(champ.registrationReadinessReason || 'As inscricoes para este campeonato nao estao abertas.');
  if (!acceptanceId) throw new Error('E obrigatorio aceitar o regulamento antes de se inscrever.');
  if (checkoutSurface && !['ios_native', 'web'].includes(checkoutSurface)) throw new Error('Superficie de checkout nao autorizada.');

  const acceptanceSnap = await db.collection('championship_acceptances').doc(acceptanceId).get();
  if (!acceptanceSnap.exists) throw new Error('Aceite do regulamento nao encontrado. Aceite o regulamento antes de se inscrever.');
  const acceptance: any = acceptanceSnap.data();
  if (acceptance.userId !== userId || acceptance.championshipId !== championshipId || acceptance.editionId !== champ.editionId) {
    throw new Error('O aceite do regulamento nao corresponde a este usuario, campeonato ou edição.');
  }
  if (acceptance.regulationVersion !== champ.regulationVersion || acceptance.regulationHash !== champ.regulationHash) {
    throw new Error('O regulamento foi atualizado. Aceite a versao vigente antes de se inscrever.');
  }
  if (!acceptance.hrAcknowledgementId || acceptance.hrAcknowledgementVersion !== COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION) {
    throw new Error('O aviso de frequência cardíaca foi atualizado. Aceite a versão vigente antes de se inscrever.');
  }

  const resolvedCheckoutSurface: ChampionshipCheckoutSurface = checkoutSurface
    || (acceptance.platform === 'web' ? 'web' : 'ios_native');
  const profileSnap = await getActiveProfile(userId);
  if (!profileSnap) throw new Error('Usuario nao encontrado ou conta inativa.');
  const profile: any = profileSnap.data();
  if (!profile.cpf) throw new Error('Complete seu CPF no perfil para emitir o checkout da inscricao.');

  // Antes da primeira cobrança, persiste o snapshot material da edição e
  // impede que envs diferentes substituam uma edição ainda não homologada.
  await lockPaidChampionshipEdition(champ);

  const registrationId = paidChampionshipRegistrationId(userId, champ.editionId);
  const ref = db.collection('championship_registrations').doc(registrationId);
  const leaseToken = randomUUID();
  const now = Date.now();

  const reservation = await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(ref);
    const current: any = snap.exists ? snap.data() || {} : {};
    if (current.status === 'paga' && current.paymentStatus === 'PAID') throw new Error('Voce ja esta inscrito nesta edição do campeonato.');
    if (current.status === 'reembolsada' || current.status === 'contestada') {
      throw new Error('Esta inscricao possui historico financeiro encerrado ou em disputa. Uma nova cobranca exige conciliacao antes de reutilizar o registro.');
    }
    if (current.status === 'pendente' && current.asaasCheckoutId) return { existing: true, data: current };
    if (current.paymentStatus === 'RECONCILIATION_REQUIRED') {
      throw new Error('A cobranca anterior exige conciliacao antes de uma nova tentativa.');
    }
    if (current.checkoutCreationStatus === 'UNCERTAIN') {
      throw new Error('O checkout anterior esta em conciliacao. Nao criaremos outra cobranca ate concluir a verificacao.');
    }
    if (current.checkoutCreationStatus === 'CREATING') {
      const leaseUntil = Number(current.checkoutCreationLeaseUntil || 0);
      if (leaseUntil > now) throw new Error('O checkout ja esta sendo criado. Aguarde a conclusao da solicitacao atual.');
      throw new Error('A tentativa anterior de checkout ficou sem confirmacao e exige conciliacao antes de uma nova cobranca.');
    }

    transaction.set(ref, {
      id: registrationId,
      userId,
      championshipId,
      editionId: champ.editionId,
      championshipTitle: champ.title,
      edition: champ.edition,
      valor: champ.registrationPrice,
      status: 'pendente' as StatusInscricaoChampionship,
      paymentStatus: 'PENDING',
      regulationVersion: champ.regulationVersion,
      regulationHash: champ.regulationHash,
      regulationAcceptedAt: acceptance.acceptedAt,
      acceptanceId,
      checkoutSurface: resolvedCheckoutSurface,
      externalPaymentReference: registrationId,
      checkoutCreationStatus: 'CREATING',
      checkoutCreationLeaseToken: leaseToken,
      checkoutCreationLeaseUntil: now + CHECKOUT_CREATION_LEASE_MS,
      checkoutCreationStartedAt: new Date(now).toISOString(),
      criadaEm: current.criadaEm || FieldValue.serverTimestamp(),
    }, { merge: true });
    return { existing: false, data: null };
  });

  if (reservation.existing) {
    const data: any = reservation.data;
    return {
      championshipId,
      editionId: champ.editionId,
      valor: data.valor,
      jaExistia: true,
      checkoutId: data.asaasCheckoutId,
      checkoutUrl: data.asaasCheckoutUrl || checkoutLinkFromId(data.asaasCheckoutId),
    };
  }

  let checkout: Awaited<ReturnType<typeof AsaasClient.criarCheckoutHospedado>>;
  try {
    checkout = await AsaasClient.criarCheckoutHospedado({
      valor: champ.registrationPrice,
      nomeItem: `Inscrição — ${champ.title} · ${champ.edition}`,
      descricao: `Taxa de inscrição avulsa em ${champ.title} (${champ.edition}). Competição esportiva por desempenho físico.`,
      referenciaExterna: registrationId,
      nomeCliente: profile.name || profile.displayName || 'Atleta Invictus',
      cpf: profile.cpf,
      email: profile.email,
      successUrl: checkoutReturnUrl('success', championshipId),
      cancelUrl: checkoutReturnUrl('cancelled', championshipId),
      expiredUrl: checkoutReturnUrl('expired', championshipId),
      minutosExpiracao: 60,
    });
  } catch {
    await db.runTransaction(async (transaction: any) => {
      const snap = await transaction.get(ref);
      if (!snap.exists || snap.data()?.checkoutCreationLeaseToken !== leaseToken) return;
      transaction.set(ref, {
        checkoutCreationStatus: 'UNCERTAIN',
        checkoutCreationLeaseUntil: 0,
        checkoutCreationFailedAt: new Date().toISOString(),
        checkoutReconciliationReason: 'ASAAS_CREATE_RESULT_UNKNOWN',
      }, { merge: true });
    });
    throw new Error('Nao foi possivel confirmar a criacao do checkout. A tentativa entrou em conciliacao e nao sera duplicada.');
  }

  await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(ref);
    if (!snap.exists || snap.data()?.checkoutCreationLeaseToken !== leaseToken) {
      throw new Error('A reserva de criacao do checkout expirou durante a conciliacao.');
    }
    transaction.set(ref, {
      asaasCheckoutId: checkout.id,
      asaasCheckoutUrl: checkout.link,
      checkoutCreationStatus: 'READY',
      checkoutCreationLeaseToken: FieldValue.delete(),
      checkoutCreationLeaseUntil: FieldValue.delete(),
      checkoutReconciliationReason: FieldValue.delete(),
      checkoutCriadoEm: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return { championshipId, editionId: champ.editionId, valor: champ.registrationPrice, jaExistia: false, checkoutId: checkout.id, checkoutUrl: checkout.link };
}

async function localizarPorCampo(field: 'asaasPaymentId' | 'asaasCheckoutId', id: string) {
  if (!id) return null;
  const query = await db.collection('championship_registrations').where(field, '==', id).limit(1).get();
  return query.empty ? null : query.docs[0];
}

async function localizarPorReferenciaExterna(value: unknown) {
  const reference = normalizedReference(value);
  if (!reference || reference.includes('/') || reference.length > 200) return null;
  const snap = await db.collection('championship_registrations').doc(reference).get();
  return snap.exists ? snap : null;
}

async function paymentConfirmationContext(transaction: any, data: any) {
  const userRef = db.collection('users').doc(String(data.userId || ''));
  const settlementRef = settlementRefForRegistration(data);
  const [userSnap, settlementSnap] = await Promise.all([
    transaction.get(userRef),
    settlementRef ? transaction.get(settlementRef) : Promise.resolve(null),
  ]);
  return { userSnap, settlementSnap };
}

function finalizedSettlement(settlementSnap: any): boolean {
  return Boolean(settlementSnap?.exists && settlementSnap.data()?.status === 'FINALIZED');
}

export async function confirmarInscricaoChampionshipPorCheckout(asaasCheckoutId: string) {
  const doc = await localizarPorCampo('asaasCheckoutId', asaasCheckoutId);
  if (!doc) {
    console.warn('[Championship] checkout pago sem inscricao correspondente:', asaasCheckoutId);
    return { encontrada: false };
  }

  return db.runTransaction(async (transaction: any) => {
    const registrationSnap = await transaction.get(doc.ref);
    if (!registrationSnap.exists) return { encontrada: false };
    const data: any = registrationSnap.data() || {};
    if (String(data.asaasCheckoutId || '') !== asaasCheckoutId) {
      throw new Error('Checkout Asaas nao corresponde mais a inscricao localizada.');
    }

    if (data.status === 'reembolsada' || data.status === 'contestada' || data.paymentStatus === 'RECONCILIATION_REQUIRED') {
      return {
        encontrada: true,
        requerReconciliacao: true,
        userId: data.userId,
        championshipId: data.championshipId,
        editionId: data.editionId,
      };
    }

    const { userSnap, settlementSnap } = await paymentConfirmationContext(transaction, data);
    if (finalizedSettlement(settlementSnap)) {
      transaction.set(doc.ref, {
        status: 'contestada' as StatusInscricaoChampionship,
        paymentStatus: 'RECONCILIATION_REQUIRED',
        paymentReconciliationReason: 'PAYMENT_CONFIRMED_AFTER_EDITION_FINALIZED',
        paymentReconciliationSourceId: asaasCheckoutId,
        paymentReconciliationObservedAt: new Date().toISOString(),
      }, { merge: true });
      return { encontrada: true, requerReconciliacao: true, motivo: 'PAYMENT_CONFIRMED_AFTER_EDITION_FINALIZED', userId: data.userId, championshipId: data.championshipId, editionId: data.editionId };
    }
    if (!userSnap.exists || !isActiveAccountState(userSnap.data())) {
      transaction.set(doc.ref, {
        paymentStatus: 'RECONCILIATION_REQUIRED',
        paymentReconciliationReason: 'ACCOUNT_INACTIVE_AT_PAYMENT_CONFIRMATION',
        paymentReconciliationSourceId: asaasCheckoutId,
        paymentReconciliationObservedAt: new Date().toISOString(),
      }, { merge: true });
      return {
        encontrada: true,
        contaInativa: true,
        requerReconciliacao: true,
        userId: data.userId,
        championshipId: data.championshipId,
        editionId: data.editionId,
      };
    }

    const jaEstavaPaga = data.status === 'paga' && data.paymentStatus === 'PAID';
    transaction.set(doc.ref, {
      status: 'paga' as StatusInscricaoChampionship,
      paymentStatus: 'PAID',
      valorPago: numericPaymentValue(data.valor),
      pagaEm: jaEstavaPaga ? (data.pagaEm || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
      paymentLifecycleEvent: 'CHECKOUT_PAID',
      paymentLifecycleObservedAt: data.paymentLifecycleObservedAt || new Date().toISOString(),
    }, { merge: true });
    return { encontrada: true, jaEstavaPaga, userId: data.userId, championshipId: data.championshipId, editionId: data.editionId };
  });
}

export async function confirmarInscricaoChampionshipPorPagamento(
  asaasPaymentId: string,
  valorPago?: number,
  asaasCheckoutId?: string,
  externalReference?: unknown,
  providerEventAt?: unknown,
) {
  const doc = await localizarPorCampo('asaasPaymentId', asaasPaymentId)
    || (asaasCheckoutId ? await localizarPorCampo('asaasCheckoutId', asaasCheckoutId) : null)
    || await localizarPorReferenciaExterna(externalReference);
  if (!doc) return { encontrada: false };

  const receivedReference = normalizedReference(externalReference);
  const incomingEventAt = normalizedProviderEventAt(providerEventAt);
  const observedAt = incomingEventAt || new Date().toISOString();

  return db.runTransaction(async (transaction: any) => {
    const registrationSnap = await transaction.get(doc.ref);
    if (!registrationSnap.exists) return { encontrada: false };
    const data: any = registrationSnap.data() || {};

    if (incomingEventAt && isStaleProviderEvent(data.paymentLifecycleObservedAt, incomingEventAt)) {
      return { encontrada: true, ignoradoComoAntigo: true, userId: data.userId, championshipId: data.championshipId, editionId: data.editionId };
    }

    const paymentBindingValid = data.asaasPaymentId
      ? String(data.asaasPaymentId) === asaasPaymentId
      : Boolean(asaasCheckoutId && String(data.asaasCheckoutId || '') === asaasCheckoutId);
    const referenceValid = receivedReference === doc.id
      || (!receivedReference && (
        String(data.asaasPaymentId || '') === asaasPaymentId
        || (asaasCheckoutId && String(data.asaasCheckoutId || '') === asaasCheckoutId)
      ));
    const amountValid = paymentAmountMatches(data.valor, valorPago);
    const orderingValid = Boolean(incomingEventAt);

    const { userSnap, settlementSnap } = await paymentConfirmationContext(transaction, data);

    if (!paymentBindingValid || !referenceValid || !amountValid || !orderingValid) {
      const reason = !paymentBindingValid
        ? 'PAYMENT_ID_OR_CHECKOUT_BINDING_MISSING'
        : !referenceValid
          ? 'PAYMENT_EXTERNAL_REFERENCE_MISMATCH'
          : !amountValid
            ? 'PAYMENT_AMOUNT_MISMATCH_OR_MISSING'
            : 'PAYMENT_EVENT_TIMESTAMP_MISSING';
      transaction.set(doc.ref, {
        status: 'contestada' as StatusInscricaoChampionship,
        paymentStatus: 'RECONCILIATION_REQUIRED',
        paymentReconciliationReason: reason,
        paymentReconciliationSourceId: asaasPaymentId || asaasCheckoutId || null,
        paymentReconciliationObservedAt: observedAt,
        observedExternalReference: receivedReference,
        valorPago: numericPaymentValue(valorPago),
        paymentLifecycleObservedAt: observedAt,
      }, { merge: true });
      return { encontrada: true, requerReconciliacao: true, motivo: reason, userId: data.userId, championshipId: data.championshipId, editionId: data.editionId };
    }

    if (finalizedSettlement(settlementSnap)) {
      transaction.set(doc.ref, {
        status: 'contestada' as StatusInscricaoChampionship,
        paymentStatus: 'RECONCILIATION_REQUIRED',
        paymentReconciliationReason: 'PAYMENT_CONFIRMED_AFTER_EDITION_FINALIZED',
        paymentReconciliationSourceId: asaasPaymentId || asaasCheckoutId || null,
        paymentReconciliationObservedAt: observedAt,
        valorPago: numericPaymentValue(valorPago),
        paymentLifecycleObservedAt: observedAt,
      }, { merge: true });
      return { encontrada: true, requerReconciliacao: true, motivo: 'PAYMENT_CONFIRMED_AFTER_EDITION_FINALIZED', userId: data.userId, championshipId: data.championshipId, editionId: data.editionId };
    }

    if (!userSnap.exists || !isActiveAccountState(userSnap.data())) {
      transaction.set(doc.ref, {
        paymentStatus: 'RECONCILIATION_REQUIRED',
        paymentReconciliationReason: 'ACCOUNT_INACTIVE_AT_PAYMENT_CONFIRMATION',
        paymentReconciliationSourceId: asaasPaymentId || asaasCheckoutId || null,
        paymentReconciliationObservedAt: observedAt,
        valorPago: numericPaymentValue(valorPago),
        paymentLifecycleObservedAt: observedAt,
      }, { merge: true });
      return {
        encontrada: true,
        contaInativa: true,
        requerReconciliacao: true,
        userId: data.userId,
        championshipId: data.championshipId,
        editionId: data.editionId,
      };
    }

    const jaEstavaPaga = data.status === 'paga' && data.paymentStatus === 'PAID';
    transaction.set(doc.ref, {
      status: 'paga' as StatusInscricaoChampionship,
      paymentStatus: 'PAID',
      asaasPaymentId,
      externalPaymentReference: doc.id,
      valorPago: numericPaymentValue(valorPago),
      pagaEm: jaEstavaPaga ? (data.pagaEm || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
      paymentReconciliationReason: FieldValue.delete(),
      paymentReconciliationSourceId: FieldValue.delete(),
      paymentReconciliationObservedAt: FieldValue.delete(),
      observedExternalReference: FieldValue.delete(),
      paymentLifecycleEvent: 'PAYMENT_CONFIRMED_OR_RECEIVED',
      paymentLifecycleObservedAt: incomingEventAt,
    }, { merge: true });
    return { encontrada: true, jaEstavaPaga, userId: data.userId, championshipId: data.championshipId, editionId: data.editionId };
  });
}

export async function encerrarCheckoutChampionship(asaasCheckoutId: string, reason: 'cancelled' | 'expired') {
  const doc = await localizarPorCampo('asaasCheckoutId', asaasCheckoutId);
  if (!doc) return { encontrada: false };
  const data: any = doc.data();
  if (data.status === 'paga' || data.status === 'reembolsada' || data.status === 'contestada') {
    return { encontrada: true, preservadaComoEstadoFinanceiro: true };
  }
  await doc.ref.update({
    status: 'cancelada' as StatusInscricaoChampionship,
    paymentStatus: 'FAILED',
    checkoutFinalStatus: reason,
    checkoutFinalizadoEm: FieldValue.serverTimestamp(),
    checkoutCreationStatus: 'CLOSED',
    asaasCheckoutId: FieldValue.delete(),
    asaasCheckoutUrl: FieldValue.delete(),
  });
  return { encontrada: true, userId: data.userId, championshipId: data.championshipId, editionId: data.editionId };
}

export async function registrarEventoFinanceiroChampionship(
  asaasPaymentId: string,
  event: ChampionshipPaymentRiskEvent,
  asaasCheckoutId?: string,
  externalReference?: unknown,
  valorObservado?: unknown,
  providerEventAt?: unknown,
) {
  const doc = await localizarPorCampo('asaasPaymentId', asaasPaymentId)
    || (asaasCheckoutId ? await localizarPorCampo('asaasCheckoutId', asaasCheckoutId) : null)
    || await localizarPorReferenciaExterna(externalReference);
  if (!doc) return { encontrada: false };

  const receivedReference = normalizedReference(externalReference);
  const incomingEventAt = normalizedProviderEventAt(providerEventAt);
  const observedAt = incomingEventAt || new Date().toISOString();

  return db.runTransaction(async (transaction: any) => {
    const registrationSnap = await transaction.get(doc.ref);
    if (!registrationSnap.exists) return { encontrada: false };
    const data: any = registrationSnap.data() || {};

    if (incomingEventAt && isStaleProviderEvent(data.paymentLifecycleObservedAt, incomingEventAt)) {
      return { encontrada: true, ignoradoComoAntigo: true, userId: data.userId, championshipId: data.championshipId, editionId: data.editionId };
    }

    const canonicalBinding = receivedReference === doc.id
      || String(data.asaasPaymentId || '') === asaasPaymentId
      || Boolean(asaasCheckoutId && String(data.asaasCheckoutId || '') === asaasCheckoutId);
    if (!canonicalBinding) {
      transaction.set(doc.ref, {
        status: 'contestada' as StatusInscricaoChampionship,
        paymentStatus: 'RECONCILIATION_REQUIRED',
        paymentReconciliationReason: 'PAYMENT_EXTERNAL_REFERENCE_MISMATCH',
        paymentReconciliationObservedAt: observedAt,
        observedExternalReference: receivedReference,
        paymentLifecycleEvent: event,
        paymentLifecycleObservedAt: observedAt,
      }, { merge: true });
      return { encontrada: true, requerReconciliacao: true, userId: data.userId, championshipId: data.championshipId, editionId: data.editionId };
    }

    const refunded = event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_RECEIVED_IN_CASH_UNDONE';
    const missingTimestamp = !incomingEventAt;
    const status: StatusInscricaoChampionship = refunded ? 'reembolsada' : 'contestada';
    transaction.set(doc.ref, {
      status,
      paymentStatus: missingTimestamp ? 'RECONCILIATION_REQUIRED' : (refunded ? 'REFUNDED' : event),
      externalPaymentReference: doc.id,
      paymentLifecycleEvent: event,
      paymentLifecycleObservedAt: observedAt,
      valorEventoFinanceiro: numericPaymentValue(valorObservado),
      ...(refunded ? { reembolsadaEm: FieldValue.serverTimestamp() } : { contestedAt: FieldValue.serverTimestamp() }),
      ...((missingTimestamp || event === 'PAYMENT_PARTIALLY_REFUNDED' || event === 'PAYMENT_REFUND_IN_PROGRESS')
        ? {
            paymentReconciliationReason: missingTimestamp ? 'PAYMENT_EVENT_TIMESTAMP_MISSING' : event,
            paymentReconciliationObservedAt: observedAt,
          }
        : {
            paymentReconciliationReason: FieldValue.delete(),
            paymentReconciliationObservedAt: FieldValue.delete(),
          }),
    }, { merge: true });

    return { encontrada: true, userId: data.userId, championshipId: data.championshipId, editionId: data.editionId, status, event };
  });
}

export async function marcarInscricaoChampionshipComoReembolsada(asaasPaymentId: string, asaasCheckoutId?: string) {
  return registrarEventoFinanceiroChampionship(
    asaasPaymentId,
    'PAYMENT_REFUNDED',
    asaasCheckoutId,
    undefined,
    undefined,
    undefined,
  );
}

export async function getUserRegistration(userId: string, championshipId: string) {
  const champ = getChampionship(championshipId);
  if (!champ) return null;
  const currentRef = db.collection('championship_registrations').doc(paidChampionshipRegistrationId(userId, champ.editionId));
  const current = await currentRef.get();
  if (current.exists) return current.data() as any;

  // Compatibilidade pré-lançamento com o ID antigo. Só aceita se o regulamento
  // coincidir com a edição atual, impedindo vazamento entre edições.
  const legacy = await db.collection('championship_registrations').doc(`${userId}_${championshipId}`).get();
  if (!legacy.exists) return null;
  const data: any = legacy.data() || {};
  return data.regulationHash === champ.regulationHash ? data : null;
}

export async function getUserRegistrations(userId: string) {
  const snap = await db.collection('championship_registrations').where('userId', '==', userId).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }));
}

export async function isUserActiveInChampionship(userId: string, championshipId: string): Promise<boolean> {
  if (!await getActiveProfile(userId)) return false;
  const registration = await getUserRegistration(userId, championshipId);
  return Boolean(registration && registration.status === 'paga' && registration.paymentStatus === 'PAID');
}
