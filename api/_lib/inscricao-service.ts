import { db, FieldValue } from './common.js';
import { AsaasClient } from './asaas-client.js';
import { getOrInitCurrentSeasonWindow, calcularProximaJanela } from './season-prize-engine.js';
import { lerConfiguracaoInscricao } from './season-settings.js';
import { isActiveAccountState } from './account-state.js';

export { lerConfiguracaoInscricao };

export type StatusInscricao = 'pendente' | 'paga' | 'cancelada';

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

async function activeProfile(userId: string) {
  const snap = await db.collection('users').doc(userId).get();
  return snap.exists && isActiveAccountState(snap.data()) ? snap : null;
}

/**
 * Espelha no perfil do usuario o estado da inscricao paga.
 * Conta inativa nunca pode ser reativada por webhook atrasado.
 */
export async function sincronizarStatusDeTemporada(userId: string, seasonId: string) {
  const perfil = await activeProfile(userId);
  if (!perfil) throw new Error('Conta inativa nao pode ser sincronizada na temporada.');

  const atual = await getOrInitCurrentSeasonWindow();
  const agora = new Date();
  const competindoAgora = atual.seasonId === seasonId && atual.startDate.getTime() <= agora.getTime();
  const proxima = competindoAgora ? null : calcularProximaJanela(atual);

  await perfil.ref.set({
    seasonStatus: competindoAgora ? 'ACTIVE' : 'WAITING_NEXT_SEASON',
    seasonInscritaId: seasonId,
    nextSeasonStart: competindoAgora
      ? ''
      : dataBR(atual.seasonId === seasonId ? atual.startDate : (proxima as any).startDate),
    updatedAt: agora.toISOString(),
  }, { merge: true });

  return competindoAgora ? 'ACTIVE' : 'WAITING_NEXT_SEASON';
}

/** Cria a cobranca PIX da inscricao e devolve o QR code para o app exibir. */
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
  const ref = db.collection('season_inscriptions').doc(idInscricao(userId, janela.seasonId));
  const existente = await ref.get();

  if (existente.exists) {
    const dados: any = existente.data();
    if (dados.status === 'paga') {
      throw new Error('Voce ja esta inscrito nesta temporada.');
    }
    if (dados.status === 'pendente' && dados.asaasPaymentId) {
      const qr = await AsaasClient.obterQrCodePix(dados.asaasPaymentId);
      return { seasonId: janela.seasonId, valor: dados.valor, jaExistia: true, qrCode: qr };
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
    referenciaExterna: idInscricao(userId, janela.seasonId),
    vencimento: vencimento.toISOString().slice(0, 10),
  });

  await ref.set({
    userId,
    seasonId: janela.seasonId,
    gymId: perfil.gymId,
    valor: config.valor,
    status: 'pendente' as StatusInscricao,
    asaasPaymentId: cobranca.id,
    asaasCustomerId: clienteId,
    criadaEm: FieldValue.serverTimestamp(),
  }, { merge: true });

  const qr = await AsaasClient.obterQrCodePix(cobranca.id);
  return { seasonId: janela.seasonId, valor: config.valor, jaExistia: false, qrCode: qr };
}

/**
 * Confirma a inscricao a partir do webhook do Asaas.
 * Idempotente e fail-closed para contas excluidas/bloqueadas: o pagamento fica
 * marcado para reconciliacao operacional e nunca reativa seasonStatus.
 */
export async function confirmarInscricaoPorPagamento(asaasPaymentId: string, valorPago?: number) {
  const busca = await db.collection('season_inscriptions')
    .where('asaasPaymentId', '==', asaasPaymentId)
    .limit(1)
    .get();

  if (busca.empty) {
    console.warn('[Inscricao] pagamento sem inscricao correspondente:', asaasPaymentId);
    return { encontrada: false };
  }

  const doc = busca.docs[0];
  const dados: any = doc.data();
  const perfil = await activeProfile(String(dados.userId || ''));
  if (!perfil) {
    await doc.ref.set({
      paymentStatus: 'RECONCILIATION_REQUIRED',
      reconciliationReason: 'ACCOUNT_INACTIVE_AT_PAYMENT_CONFIRMATION',
      reconciliationObservedAt: new Date().toISOString(),
      valorPago: typeof valorPago === 'number' ? valorPago : dados.valor,
    }, { merge: true });
    console.warn(`[Inscricao] pagamento ${asaasPaymentId} pertence a conta inativa ${dados.userId}; nenhuma ativacao foi aplicada.`);
    return {
      encontrada: true,
      contaInativa: true,
      requerReconciliacao: true,
      userId: dados.userId,
      seasonId: dados.seasonId,
    };
  }

  if (dados.status === 'paga') {
    await sincronizarStatusDeTemporada(dados.userId, dados.seasonId);
    return { encontrada: true, jaEstavaPaga: true, userId: dados.userId, seasonId: dados.seasonId };
  }

  await doc.ref.update({
    status: 'paga' as StatusInscricao,
    paymentStatus: 'PAID',
    valorPago: typeof valorPago === 'number' ? valorPago : dados.valor,
    pagaEm: FieldValue.serverTimestamp(),
  });

  await sincronizarStatusDeTemporada(dados.userId, dados.seasonId);

  console.log(`[Inscricao] confirmada: ${dados.userId} na temporada ${dados.seasonId} (academia ${dados.gymId})`);
  return { encontrada: true, jaEstavaPaga: false, userId: dados.userId, seasonId: dados.seasonId };
}
