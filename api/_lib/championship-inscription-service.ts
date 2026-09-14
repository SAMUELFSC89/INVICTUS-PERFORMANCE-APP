import { randomUUID } from 'node:crypto';
import { db, FieldValue } from './common.js';
import { AsaasClient } from './asaas-client.js';
import { getChampionship, isRegistrationOpen } from './championship-catalog.js';
import { COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION } from '../../shared/competitiveHeartRatePolicy.js';
import { isActiveAccountState } from './account-state.js';

export type StatusInscricaoChampionship = 'pendente' | 'paga' | 'cancelada' | 'reembolsada';
export type ChampionshipCheckoutSurface = 'ios_native' | 'web';

const CHECKOUT_CREATION_LEASE_MS = 90_000;

function idInscricaoChampionship(userId: string, championshipId: string) {
  return `${userId}_${championshipId}`;
}

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

async function getActiveProfile(userId: string) {
  const snap = await db.collection('users').doc(userId).get();
  return snap.exists && isActiveAccountState(snap.data()) ? snap : null;
}

async function markInactivePaymentForReconciliation(doc: any, sourceId: string) {
  const data: any = doc.data();
  await doc.ref.set({
    paymentStatus: 'RECONCILIATION_REQUIRED',
    paymentReconciliationReason: 'ACCOUNT_INACTIVE_AT_PAYMENT_CONFIRMATION',
    paymentReconciliationSourceId: sourceId || null,
    paymentReconciliationObservedAt: new Date().toISOString(),
  }, { merge: true });
  return {
    encontrada: true,
    contaInativa: true,
    requerReconciliacao: true,
    userId: data.userId,
    championshipId: data.championshipId,
  };
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

  const acceptanceId = `acc_${params.userId}_${params.championshipId}_${Date.now()}`;
  const acceptedAt = new Date().toISOString();
  await db.collection('championship_acceptances').doc(acceptanceId).set({
    acceptanceId,
    userId: params.userId,
    championshipId: params.championshipId,
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
  return { acceptanceId, regulationVersion: champ.regulationVersion, regulationHash: champ.regulationHash, acceptedAt };
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
  if (acceptance.userId !== userId || acceptance.championshipId !== championshipId) {
    throw new Error('O aceite do regulamento nao corresponde a este usuario ou campeonato.');
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

  const registrationId = idInscricaoChampionship(userId, championshipId);
  const ref = db.collection('championship_registrations').doc(registrationId);
  const leaseToken = randomUUID();
  const now = Date.now();

  const reservation = await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(ref);
    const current: any = snap.exists ? snap.data() || {} : {};
    if (current.status === 'paga' && current.paymentStatus === 'PAID') throw new Error('Voce ja esta inscrito neste campeonato.');
    if (current.status === 'pendente' && current.asaasCheckoutId) return { existing: true, data: current };
    if (current.checkoutCreationStatus === 'UNCERTAIN') {
      throw new Error('O checkout anterior esta em conciliacao. Nao criaremos outra cobranca ate concluir a verificacao.');
    }
    if (current.checkoutCreationStatus === 'CREATING') {
      const leaseUntil = Number(current.checkoutCreationLeaseUntil || 0);
      if (leaseUntil > now) throw new Error('O checkout ja esta sendo criado. Aguarde a conclusao da solicitacao atual.');
      // Se o processo morreu depois que o Asaas criou o checkout e antes de
      // gravarmos seu ID, nao existe forma segura de saber localmente se houve
      // criacao. Fail-closed: lease expirado NUNCA autoriza nova cobranca.
      throw new Error('A tentativa anterior de checkout ficou sem confirmacao e exige conciliacao antes de uma nova cobranca.');
    }

    transaction.set(ref, {
      userId,
      championshipId,
      championshipTitle: champ.title,
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
      nomeItem: `Inscrição — ${champ.title}`,
      descricao: `Taxa de inscrição avulsa em ${champ.title}. Competição esportiva por desempenho físico.`,
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

  return { championshipId, valor: champ.registrationPrice, jaExistia: false, checkoutId: checkout.id, checkoutUrl: checkout.link };
}

async function localizarPorCampo(field: 'asaasPaymentId' | 'asaasCheckoutId', id: string) {
  if (!id) return null;
  const query = await db.collection('championship_registrations').where(field, '==', id).limit(1).get();
  return query.empty ? null : query.docs[0];
}

export async function confirmarInscricaoChampionshipPorCheckout(asaasCheckoutId: string) {
  const doc = await localizarPorCampo('asaasCheckoutId', asaasCheckoutId);
  if (!doc) {
    console.warn('[Championship] checkout pago sem inscricao correspondente:', asaasCheckoutId);
    return { encontrada: false };
  }
  const data: any = doc.data();
  if (!await getActiveProfile(String(data.userId || ''))) return markInactivePaymentForReconciliation(doc, asaasCheckoutId);
  if (data.status === 'paga' && data.paymentStatus === 'PAID') {
    return { encontrada: true, jaEstavaPaga: true, userId: data.userId, championshipId: data.championshipId };
  }
  await doc.ref.update({
    status: 'paga' as StatusInscricaoChampionship,
    paymentStatus: 'PAID',
    valorPago: data.valor,
    pagaEm: FieldValue.serverTimestamp(),
  });
  return { encontrada: true, jaEstavaPaga: false, userId: data.userId, championshipId: data.championshipId };
}

export async function confirmarInscricaoChampionshipPorPagamento(asaasPaymentId: string, valorPago?: number, asaasCheckoutId?: string) {
  const doc = await localizarPorCampo('asaasPaymentId', asaasPaymentId)
    || (asaasCheckoutId ? await localizarPorCampo('asaasCheckoutId', asaasCheckoutId) : null);
  if (!doc) return { encontrada: false };
  const data: any = doc.data();
  if (!await getActiveProfile(String(data.userId || ''))) return markInactivePaymentForReconciliation(doc, asaasPaymentId || asaasCheckoutId || '');
  if (data.status === 'paga' && data.paymentStatus === 'PAID') {
    return { encontrada: true, jaEstavaPaga: true, userId: data.userId, championshipId: data.championshipId };
  }
  await doc.ref.update({
    status: 'paga' as StatusInscricaoChampionship,
    paymentStatus: 'PAID',
    ...(asaasPaymentId ? { asaasPaymentId } : {}),
    valorPago: typeof valorPago === 'number' ? valorPago : data.valor,
    pagaEm: FieldValue.serverTimestamp(),
  });
  return { encontrada: true, jaEstavaPaga: false, userId: data.userId, championshipId: data.championshipId };
}

export async function encerrarCheckoutChampionship(asaasCheckoutId: string, reason: 'cancelled' | 'expired') {
  const doc = await localizarPorCampo('asaasCheckoutId', asaasCheckoutId);
  if (!doc) return { encontrada: false };
  const data: any = doc.data();
  if (data.status === 'paga') return { encontrada: true, preservadaComoPaga: true };
  await doc.ref.update({
    status: 'cancelada' as StatusInscricaoChampionship,
    paymentStatus: 'FAILED',
    checkoutFinalStatus: reason,
    checkoutFinalizadoEm: FieldValue.serverTimestamp(),
    checkoutCreationStatus: 'CLOSED',
    asaasCheckoutId: FieldValue.delete(),
    asaasCheckoutUrl: FieldValue.delete(),
  });
  return { encontrada: true, userId: data.userId, championshipId: data.championshipId };
}

export async function marcarInscricaoChampionshipComoReembolsada(asaasPaymentId: string, asaasCheckoutId?: string) {
  const doc = await localizarPorCampo('asaasPaymentId', asaasPaymentId)
    || (asaasCheckoutId ? await localizarPorCampo('asaasCheckoutId', asaasCheckoutId) : null);
  if (!doc) return { encontrada: false };
  const data: any = doc.data();
  await doc.ref.update({
    status: 'reembolsada' as StatusInscricaoChampionship,
    paymentStatus: 'REFUNDED',
    reembolsadaEm: FieldValue.serverTimestamp(),
  });
  return { encontrada: true, userId: data.userId, championshipId: data.championshipId };
}

export async function getUserRegistration(userId: string, championshipId: string) {
  const doc = await db.collection('championship_registrations').doc(idInscricaoChampionship(userId, championshipId)).get();
  return doc.exists ? (doc.data() as any) : null;
}

export async function getUserRegistrations(userId: string) {
  const snap = await db.collection('championship_registrations').where('userId', '==', userId).get();
  return snap.docs.map((doc) => doc.data() as any);
}

export async function isUserActiveInChampionship(userId: string, championshipId: string): Promise<boolean> {
  if (!await getActiveProfile(userId)) return false;
  const registration = await getUserRegistration(userId, championshipId);
  return Boolean(registration && registration.status === 'paga' && registration.paymentStatus === 'PAID');
}
