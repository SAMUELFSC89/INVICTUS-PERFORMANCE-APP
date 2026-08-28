import { db, FieldValue } from './common.js';
import { AsaasClient } from './asaas-client.js';
import { getChampionship, isRegistrationOpen } from './championship-catalog.js';

/**
 * Inscricao em campeonato (Arena/Run Elite), espelhando o padrao ja
 * comprovado em producao para a inscricao de temporada
 * (api/_lib/inscricao-service.ts). Mesma logica: cobranca PIX via Asaas,
 * FORA das lojas (regra de IAP nao se aplica a competicao de dinheiro real),
 * idempotente e com o Firestore como unica fonte de verdade -- ate agora
 * (2026-08) essa tela inteira rodava sobre localStorage no cliente + um
 * Map em memoria no servidor (perdido a cada cold start), sem cobranca real
 * nenhuma. Ver ChampionshipCheckoutAsaas.tsx (removido) e
 * AUDITORIA-CORE-INVICTUS.md.
 */

export type StatusInscricaoChampionship = 'pendente' | 'paga' | 'cancelada' | 'reembolsada';

function idInscricaoChampionship(userId: string, championshipId: string) {
  return `${userId}_${championshipId}`;
}

/**
 * Registra o aceite auditado do regulamento vigente. Precisa existir e bater
 * com o regulamento oficial do catalogo antes de qualquer cobranca ser
 * emitida (criarInscricaoChampionship confere isso).
 */
export async function registrarAceiteRegulamento(params: {
  userId: string;
  championshipId: string;
  regulationVersion: string;
  regulationHash: string;
  ip: string;
  userAgent?: string;
  locale?: string;
  platform?: string;
}) {
  const champ = getChampionship(params.championshipId);
  if (!champ) {
    throw new Error('Campeonato nao encontrado.');
  }
  if (params.regulationVersion !== champ.regulationVersion || params.regulationHash !== champ.regulationHash) {
    throw new Error('O regulamento submetido esta desatualizado ou com hash divergente do oficial vigente.');
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
    createdAt: FieldValue.serverTimestamp(),
  });

  return { acceptanceId, regulationVersion: champ.regulationVersion, regulationHash: champ.regulationHash, acceptedAt };
}

/**
 * Cria a cobranca PIX da inscricao no campeonato e devolve o QR code.
 * Idempotente: inscricao pendente existente reaproveita a mesma cobranca.
 */
export async function criarInscricaoChampionship(userId: string, championshipId: string, acceptanceId: string) {
  const champ = getChampionship(championshipId);
  if (!champ) {
    throw new Error('Campeonato nao encontrado.');
  }
  if (!isRegistrationOpen(champ)) {
    throw new Error('As inscricoes para este campeonato estao encerradas.');
  }
  if (!acceptanceId) {
    throw new Error('E obrigatorio aceitar o regulamento antes de se inscrever.');
  }

  const acceptanceSnap = await db.collection('championship_acceptances').doc(acceptanceId).get();
  if (!acceptanceSnap.exists) {
    throw new Error('Aceite do regulamento nao encontrado. Aceite o regulamento antes de se inscrever.');
  }
  const acceptance: any = acceptanceSnap.data();
  if (acceptance.userId !== userId || acceptance.championshipId !== championshipId) {
    throw new Error('O aceite do regulamento nao corresponde a este usuario ou campeonato.');
  }
  if (acceptance.regulationVersion !== champ.regulationVersion || acceptance.regulationHash !== champ.regulationHash) {
    throw new Error('O regulamento foi atualizado. Aceite a versao vigente antes de se inscrever.');
  }

  const perfilSnap = await db.collection('users').doc(userId).get();
  if (!perfilSnap.exists) throw new Error('Usuario nao encontrado.');
  const perfil: any = perfilSnap.data();
  if (!perfil.cpf) {
    throw new Error('Complete seu CPF no perfil para emitir a cobranca da inscricao.');
  }

  const ref = db.collection('championship_registrations').doc(idInscricaoChampionship(userId, championshipId));
  const existente = await ref.get();

  if (existente.exists) {
    const dados: any = existente.data();
    if (dados.status === 'paga') {
      throw new Error('Voce ja esta inscrito neste campeonato.');
    }
    if (dados.status === 'pendente' && dados.asaasPaymentId) {
      const qr = await AsaasClient.obterQrCodePix(dados.asaasPaymentId);
      return { championshipId, valor: dados.valor, jaExistia: true, qrCode: qr, asaasPaymentId: dados.asaasPaymentId };
    }
  }

  const clienteId = await AsaasClient.criarOuObterCliente({
    nome: perfil.name || perfil.displayName || 'Atleta Invictus',
    cpf: perfil.cpf,
    email: perfil.email,
    referenciaExterna: userId,
  });

  // Vencimento em 1 dia, mesmo criterio da inscricao de temporada: e uma
  // decisao de momento, cobranca pendente eterna so polui o painel.
  const vencimento = new Date();
  vencimento.setDate(vencimento.getDate() + 1);

  const cobranca = await AsaasClient.criarCobrancaPix({
    clienteId,
    valor: champ.registrationPrice,
    descricao: `Inscricao ${champ.title}`,
    referenciaExterna: idInscricaoChampionship(userId, championshipId),
    vencimento: vencimento.toISOString().slice(0, 10),
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
    asaasPaymentId: cobranca.id,
    asaasCustomerId: clienteId,
    externalPaymentReference: idInscricaoChampionship(userId, championshipId),
    criadaEm: FieldValue.serverTimestamp(),
  }, { merge: true });

  const qr = await AsaasClient.obterQrCodePix(cobranca.id);
  return { championshipId, valor: champ.registrationPrice, jaExistia: false, qrCode: qr, asaasPaymentId: cobranca.id };
}

/**
 * Confirma a inscricao a partir do webhook do Asaas. Idempotente.
 */
export async function confirmarInscricaoChampionshipPorPagamento(asaasPaymentId: string, valorPago?: number) {
  const busca = await db.collection('championship_registrations')
    .where('asaasPaymentId', '==', asaasPaymentId)
    .limit(1)
    .get();

  if (busca.empty) {
    console.warn('[Championship] pagamento sem inscricao correspondente:', asaasPaymentId);
    return { encontrada: false };
  }

  const doc = busca.docs[0];
  const dados: any = doc.data();

  if (dados.status === 'paga') {
    return { encontrada: true, jaEstavaPaga: true, userId: dados.userId, championshipId: dados.championshipId };
  }

  await doc.ref.update({
    status: 'paga' as StatusInscricaoChampionship,
    paymentStatus: 'PAID',
    valorPago: typeof valorPago === 'number' ? valorPago : dados.valor,
    pagaEm: FieldValue.serverTimestamp(),
  });

  console.log(`[Championship] inscricao confirmada: ${dados.userId} em ${dados.championshipId}`);
  return { encontrada: true, jaEstavaPaga: false, userId: dados.userId, championshipId: dados.championshipId };
}

/** Reembolso/chargeback: marca a inscricao como reembolsada (nao remove o registro, para auditoria). */
export async function marcarInscricaoChampionshipComoReembolsada(asaasPaymentId: string) {
  const busca = await db.collection('championship_registrations')
    .where('asaasPaymentId', '==', asaasPaymentId)
    .limit(1)
    .get();
  if (busca.empty) return { encontrada: false };

  const doc = busca.docs[0];
  await doc.ref.update({
    status: 'reembolsada' as StatusInscricaoChampionship,
    paymentStatus: 'REFUNDED',
    reembolsadaEm: FieldValue.serverTimestamp(),
  });
  const dados: any = doc.data();
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
