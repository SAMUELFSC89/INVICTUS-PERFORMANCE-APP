import { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'crypto';
import { cors, db } from '../_lib/common.js';

function normalizeWithdrawalReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reference = value.trim();
  if (!reference.startsWith('pix_req_') || reference.length > 500 || reference.includes('/')) return null;
  return reference;
}

/**
 * Webhook de AUTORIZACAO de saques do Asaas (Mecanismo de seguranca para
 * validacao de saques via Webhook). Diferente de /payments/asaas-webhook
 * (que so informa o status final apos o processamento), este endpoint e
 * chamado pelo Asaas ANTES de executar a transferencia. A resposta
 * (APPROVED ou REFUSED) decide se a operacao prossegue ou e cancelada,
 * substituindo a aprovacao manual por token dentro do painel da Asaas.
 *
 * So aprova automaticamente transferencias que correspondem a um saque
 * que o proprio sistema criou (via WithdrawalEngine.processPayment) e que
 * ja passou pelas checagens antifraude internas. Qualquer transferencia
 * desconhecida, ou que nao bata com os dados registrados, e recusada.
 *
 * Configurar em: Asaas > Menu do usuario > Integracoes > Mecanismos de seguranca
 * URL: https://<seu-dominio>/api/payments/asaas-authorize-withdrawal
 * Token de acesso (header asaas-access-token): mesmo valor de
 * ASAAS_AUTHORIZATION_TOKEN configurado como variavel de ambiente no Vercel
 * (gere uma string aleatoria longa, diferente do ASAAS_WEBHOOK_TOKEN).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  try {
    const headerToken = req.headers['asaas-access-token'];
    const incomingToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;
    const expectedToken = process.env.ASAAS_AUTHORIZATION_TOKEN?.trim();

    if (!expectedToken) {
      console.error('[Asaas Authorization] ASAAS_AUTHORIZATION_TOKEN nao configurado no servidor.');
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Configuracao ausente no servidor.' });
    }

    const tokenMatches = typeof incomingToken === 'string'
      && incomingToken.length === expectedToken.length
      && timingSafeEqual(Buffer.from(incomingToken), Buffer.from(expectedToken));

    if (!tokenMatches) {
      console.error('[Asaas Authorization] Token de acesso invalido recebido.');
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Token de autenticacao invalido.' });
    }

    const { type, transfer } = req.body || {};

    if (type !== 'TRANSFER' || !transfer || typeof transfer.id !== 'string' || !transfer.id.trim()) {
      console.log('[Asaas Authorization] Tipo de operacao nao suportado ou payload incompleto:', type);
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Tipo de operacao nao reconhecido pelo sistema.' });
    }

    const transferId = transfer.id.trim();
    const externalReference = normalizeWithdrawalReference(transfer.externalReference);
    const byProviderId = await db.collection('withdrawals')
      .where('providerTransferId', '==', transferId)
      .limit(1)
      .get();

    let withdrawalDoc: any = byProviderId.empty ? null : byProviderId.docs[0];
    if (!withdrawalDoc && externalReference) {
      const byReference = await db.collection('withdrawals').doc(externalReference).get();
      if (byReference.exists) withdrawalDoc = byReference;
    }

    if (!withdrawalDoc) {
      console.error('[Asaas Authorization] Nenhum saque interno encontrado para transferId/reference:', transferId, externalReference || '(ausente)');
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Transferencia nao corresponde a um saque registrado no sistema.' });
    }

    const withdrawal: any = withdrawalDoc.data() || {};
    const canonicalWithdrawalId = withdrawalDoc.id;

    if (externalReference && externalReference !== canonicalWithdrawalId) {
      console.error('[Asaas Authorization] externalReference divergente:', externalReference, 'esperado:', canonicalWithdrawalId);
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Referencia externa da transferencia nao confere.' });
    }

    if (withdrawal.providerTransferId && withdrawal.providerTransferId !== transferId) {
      console.error('[Asaas Authorization] Saque ja vinculado a outro transferId:', withdrawal.providerTransferId, 'recebido:', transferId);
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Saque ja esta vinculado a outra transferencia.' });
    }

    // O dinheiro continua bloqueado enquanto o Asaas processa a transferência.
    // "paid" só é gravado após o webhook final TRANSFER_DONE.
    if (withdrawal.status !== 'processing') {
      console.error('[Asaas Authorization] Saque', canonicalWithdrawalId, 'nao esta com status "processing" (atual:', withdrawal.status, ').');
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Saque nao esta no status esperado para pagamento.' });
    }

    if (withdrawal.antiFraudPassed !== true) {
      console.error('[Asaas Authorization] Saque', canonicalWithdrawalId, 'nao passou nas checagens antifraude internas.');
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Saque nao passou nas checagens antifraude internas.' });
    }

    // Financeiro fail-closed: valor ausente, string, NaN ou divergente deve
    // sempre ser recusado. O comportamento anterior aceitava payload sem valor.
    const transferValue = transfer.value;
    const amountMatches = typeof transferValue === 'number'
      && Number.isFinite(transferValue)
      && Number.isFinite(Number(withdrawal.amount))
      && Math.abs(transferValue - Number(withdrawal.amount)) < 0.01;
    if (!amountMatches) {
      console.error('[Asaas Authorization] Valor da transferencia (', transferValue, ') nao confere com o saque registrado (', withdrawal.amount, ').');
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Valor da transferencia nao confere com o saque registrado.' });
    }

    // Se a chamada POST /transfers foi aceita pelo Asaas antes de a resposta
    // chegar ao Invictus, o mecanismo de autorizacao ainda consegue recuperar
    // o vinculo pelo externalReference e persistir o transferId canonico.
    await withdrawalDoc.ref.set({
      paymentProvider: 'asaas',
      providerTransferId: transferId,
      providerExternalReference: externalReference || canonicalWithdrawalId,
      providerAuthorizationBoundAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    console.log('[Asaas Authorization] Saque', canonicalWithdrawalId, 'aprovado automaticamente para transferId:', transferId);
    return res.status(200).json({ status: 'APPROVED' });
  } catch (error: any) {
    console.error('[Asaas Authorization Error]', error);
    // Em caso de erro interno, e mais seguro recusar do que aprovar as cegas.
    return res.status(200).json({ status: 'REFUSED', refuseReason: 'Erro interno ao validar a operacao.' });
  }
}
