import { db, FieldValue } from './common.js';
import { AsaasClient } from './asaas-client.js';
import { getChampionship, isRegistrationOpen } from './championship-catalog.js';
import { COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION } from '../../shared/competitiveHeartRatePolicy.js';

export type StatusInscricaoChampionship = 'pendente' | 'paga' | 'cancelada' | 'reembolsada';
export type ChampionshipCheckoutSurface = 'ios_native' | 'web';

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

/**
 * Cria checkout Asaas avulso para a taxa de inscrição. O checkout é uma
 * página hospedada pelo Asaas; o callback só devolve o atleta ao Invictus e
 * nunca ativa a inscrição. Somente CHECKOUT_PAID recebido pelo webhook muda
 * o status para pago.
 */
export async function criarInscricaoChampionship(
  userId: string,
  championshipId: string,
  acceptanceId: string,
  checkoutSurface: ChampionshipCheckoutSurface = 'ios_native',
) {
  const champ = getChampionship(championshipId);
  if (!champ) throw new Error('Campeonato nao encontrado.');
  if (!isRegistrationOpen(champ)) {
    throw new Error(champ.registrationReadinessReason || 'As inscricoes para este campeonato nao estao abertas.');
  }
  if (!acceptanceId) throw new Error('E obrigatorio aceitar o regulamento antes de se inscrever.');
  if (!['ios_native', 'web'].includes(checkoutSurface)) throw new Error('Superficie de checkout nao autorizada.');

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

  const perfilSnap = await db.collection('users').doc(userId).get();
  if (!perfilSnap.exists) throw new Error('Usuario nao encontrado.');
  const perfil: any = perfilSnap.data();
  if (!perfil.cpf) throw new Error('Complete seu CPF no perfil para emitir o checkout da inscricao.');

  const registrationId = idInscricaoChampionship(userId, championshipId);
  const ref = db.collection('championship_registrations').doc(registrationId);
  const existente = await ref.get();
  if (existente.exists) {
    const dados: any = existente.data();
    if (dados.status === 'paga' && dados.paymentStatus === 'PAID') throw new Error('Voce ja esta inscrito neste campeonato.');
    if (dados.status === 'pendente' && dados.asaasCheckoutId) {
      return {
        championshipId,
        valor: dados.valor,
        jaExistia: true,
        checkoutId: dados.asaasCheckoutId,
        checkoutUrl: dados.asaasCheckoutUrl || checkoutLinkFromId(dados.asaasCheckoutId),
      };
    }
  }

  const checkout = await AsaasClient.criarCheckoutHospedado({
    valor: champ.registrationPrice,
    nomeItem: `Inscrição — ${champ.title}`,
    descricao: `Taxa de inscrição avulsa em ${champ.title}. Competição esportiva por desempenho físico.`,
    referenciaExterna: registrationId,
    nomeCliente: perfil.name || perfil.displayName || 'Atleta Invictus',
    cpf: perfil.cpf,
    email: perfil.email,
    successUrl: checkoutReturnUrl('success', championshipId),
    cancelUrl: checkoutReturnUrl('cancelled', championshipId),
    expiredUrl: checkoutReturnUrl('expired', championshipId),
    minutosExpiracao: 60,
  });

  await ref.set({
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
    asaasCheckoutId: checkout.id,
    asaasCheckoutUrl: checkout.link,
    checkoutSurface,
    externalPaymentReference: registrationId,
    criadaEm: FieldValue.serverTimestamp(),
    checkoutCriadoEm: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    championshipId,
    valor: champ.registrationPrice,
    jaExistia: false,
    checkoutId: checkout.id,
    checkoutUrl: checkout.link,
  };
}

async function localizarPorCampo(campo: 'asaasPaymentId' | 'asaasCheckoutId', id: string) {
  if (!id) return null;
  const busca = await db.collection('championship_registrations').where(campo, '==', id).limit(1).get();
  return busca.empty ? null : busca.docs[0];
}

export async function confirmarInscricaoChampionshipPorCheckout(asaasCheckoutId: string) {
  const doc = await localizarPorCampo('asaasCheckoutId', asaasCheckoutId);
  if (!doc) {
    console.warn('[Championship] checkout pago sem inscricao correspondente:', asaasCheckoutId);
    return { encontrada: false };
  }
  const dados: any = doc.data();
  if (dados.status === 'paga' && dados.paymentStatus === 'PAID') {
    return { encontrada: true, jaEstavaPaga: true, userId: dados.userId, championshipId: dados.championshipId };
  }
  await doc.ref.update({
    status: 'paga' as StatusInscricaoChampionship,
    paymentStatus: 'PAID',
    valorPago: dados.valor,
    pagaEm: FieldValue.serverTimestamp(),
  });
  return { encontrada: true, jaEstavaPaga: false, userId: dados.userId, championshipId: dados.championshipId };
}

/** Compatibilidade com cobranças PIX antigas e eventos PAYMENT_* do Asaas. */
export async function confirmarInscricaoChampionshipPorPagamento(asaasPaymentId: string, valorPago?: number, asaasCheckoutId?: string) {
  const doc = await localizarPorCampo('asaasPaymentId', asaasPaymentId)
    || (asaasCheckoutId ? await localizarPorCampo('asaasCheckoutId', asaasCheckoutId) : null);
  if (!doc) return { encontrada: false };
  const dados: any = doc.data();
  if (dados.status === 'paga' && dados.paymentStatus === 'PAID') {
    return { encontrada: true, jaEstavaPaga: true, userId: dados.userId, championshipId: dados.championshipId };
  }
  await doc.ref.update({
    status: 'paga' as StatusInscricaoChampionship,
    paymentStatus: 'PAID',
    ...(asaasPaymentId ? { asaasPaymentId } : {}),
    valorPago: typeof valorPago === 'number' ? valorPago : dados.valor,
    pagaEm: FieldValue.serverTimestamp(),
  });
  return { encontrada: true, jaEstavaPaga: false, userId: dados.userId, championshipId: dados.championshipId };
}

export async function encerrarCheckoutChampionship(asaasCheckoutId: string, motivo: 'cancelled' | 'expired') {
  const doc = await localizarPorCampo('asaasCheckoutId', asaasCheckoutId);
  if (!doc) return { encontrada: false };
  const dados: any = doc.data();
  if (dados.status === 'paga') return { encontrada: true, preservadaComoPaga: true };
  await doc.ref.update({
    status: 'cancelada' as StatusInscricaoChampionship,
    paymentStatus: 'FAILED',
    checkoutFinalStatus: motivo,
    checkoutFinalizadoEm: FieldValue.serverTimestamp(),
    // Permite nova tentativa criar outro checkout em vez de reaproveitar URL morta.
    asaasCheckoutId: FieldValue.delete(),
    asaasCheckoutUrl: FieldValue.delete(),
  });
  return { encontrada: true, userId: dados.userId, championshipId: dados.championshipId };
}

export async function marcarInscricaoChampionshipComoReembolsada(asaasPaymentId: string, asaasCheckoutId?: string) {
  const doc = await localizarPorCampo('asaasPaymentId', asaasPaymentId)
    || (asaasCheckoutId ? await localizarPorCampo('asaasCheckoutId', asaasCheckoutId) : null);
  if (!doc) return { encontrada: false };
  const dados: any = doc.data();
  await doc.ref.update({
    status: 'reembolsada' as StatusInscricaoChampionship,
    paymentStatus: 'REFUNDED',
    reembolsadaEm: FieldValue.serverTimestamp(),
  });
  return { encontrada: true, userId: dados.userId, championshipId: dados.championshipId };
}

export async function getUserRegistration(userId: string, championshipId: string) {
  const doc = await db.collection('championship_registrations').doc(idInscricaoChampionship(userId, championshipId)).get();
  return doc.exists ? (doc.data() as any) : null;
}

export async function getUserRegistrations(userId: string) {
  const snap = await db.collection('championship_registrations').where('userId', '==', userId).get();
  return snap.docs.map((d) => d.data() as any);
}

export async function isUserActiveInChampionship(userId: string, championshipId: string): Promise<boolean> {
  const reg = await getUserRegistration(userId, championshipId);
  return !!reg && reg.status === 'paga' && reg.paymentStatus === 'PAID';
}
