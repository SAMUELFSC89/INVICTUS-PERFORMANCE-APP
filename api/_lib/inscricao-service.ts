import { db, FieldValue } from './common.js';
import { AsaasClient } from './asaas-client.js';
import { getOrInitCurrentSeasonWindow, calcularProximaJanela } from './season-prize-engine.js';
import { lerConfiguracaoInscricao } from './season-settings.js';

export { lerConfiguracaoInscricao };

/**
 * Inscricao na temporada.
 *
 * A inscricao e a entrada na competicao, e e cobrada POR FORA das lojas, via
 * PIX. Isso nao e escolha de arquitetura: a regra das lojas proibe usar compra
 * dentro do app (IAP) para entrada em disputa de dinheiro real, e permite meio
 * de pagamento proprio.
 *
 * O plano Pro continua sendo vendido por IAP e NAO da direito a competir --
 * ele vende recursos (IA, saude, relatorios, integracoes).
 */

export type StatusInscricao = 'pendente' | 'paga' | 'cancelada';

/**
 * Em qual temporada a inscricao entra.
 *
 * Mesma regra da assinatura: com a temporada ja rodando, a inscricao vale para
 * a seguinte. Antes de ela abrir (janela de campanha), vale para ela mesma.
 */
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

/**
 * Espelha no perfil do usuario o estado da inscricao paga.
 *
 * Este e o UNICO lugar que decide seasonStatus. O app le esse campo para saber
 * se o atleta ja esta competindo ou se ainda espera a proxima temporada; quem
 * escreve e a inscricao, e nao a assinatura.
 */
export async function sincronizarStatusDeTemporada(userId: string, seasonId: string) {
  const atual = await getOrInitCurrentSeasonWindow();
  const agora = new Date();
  const competindoAgora =
    atual.seasonId === seasonId && atual.startDate.getTime() <= agora.getTime();

  const proxima = competindoAgora ? null : calcularProximaJanela(atual);

  await db.collection('users').doc(userId).set({
    seasonStatus: competindoAgora ? 'ACTIVE' : 'WAITING_NEXT_SEASON',
    seasonInscritaId: seasonId,
    nextSeasonStart: competindoAgora
      ? ''
      : dataBR(atual.seasonId === seasonId ? atual.startDate : (proxima as any).startDate),
    updatedAt: agora.toISOString(),
  }, { merge: true });

  return competindoAgora ? 'ACTIVE' : 'WAITING_NEXT_SEASON';
}

/**
 * Cria a cobranca PIX da inscricao e devolve o QR code para o app exibir.
 * Idempotente: se ja existe inscricao pendente para a mesma temporada,
 * devolve o QR code dela em vez de cobrar de novo.
 */
export async function criarInscricao(userId: string) {
  const config = await lerConfiguracaoInscricao();
  if (!config.abertas || config.valor === null) {
    throw new Error('As inscricoes nao estao abertas no momento.');
  }

  const perfilSnap = await db.collection('users').doc(userId).get();
  if (!perfilSnap.exists) throw new Error('Usuario nao encontrado.');
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

  // Vencimento em 1 dia: a inscricao e uma decisao de momento, e cobranca
  // pendente eterna so polui o painel.
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
    // Academia CONGELADA no ato da inscricao: trocar de academia depois nao
    // muda onde o atleta compete nesta temporada.
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
 * Idempotente: reprocessar o mesmo evento nao muda nada.
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

  if (dados.status === 'paga') {
    // Reprocessar o webhook nao deve mudar nada, mas ressincronizamos o perfil:
    // se a primeira tentativa gravou a inscricao e falhou depois, o atleta
    // ficaria pago e fora do ranking para sempre.
    await sincronizarStatusDeTemporada(dados.userId, dados.seasonId);
    return { encontrada: true, jaEstavaPaga: true, userId: dados.userId, seasonId: dados.seasonId };
  }

  await doc.ref.update({
    status: 'paga' as StatusInscricao,
    valorPago: typeof valorPago === 'number' ? valorPago : dados.valor,
    pagaEm: FieldValue.serverTimestamp(),
  });

  await sincronizarStatusDeTemporada(dados.userId, dados.seasonId);

  console.log(`[Inscricao] confirmada: ${dados.userId} na temporada ${dados.seasonId} (academia ${dados.gymId})`);
  return { encontrada: true, jaEstavaPaga: false, userId: dados.userId, seasonId: dados.seasonId };
}
