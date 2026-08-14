import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, db } from '../_lib/common.js';

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
    const incomingToken = req.headers['asaas-access-token'];
    const expectedToken = process.env.ASAAS_AUTHORIZATION_TOKEN;

    if (!expectedToken) {
      console.error('[Asaas Authorization] ASAAS_AUTHORIZATION_TOKEN nao configurado no servidor.');
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Configuracao ausente no servidor.' });
    }

    if (incomingToken !== expectedToken) {
      console.error('[Asaas Authorization] Token de acesso invalido recebido.');
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Token de autenticacao invalido.' });
    }

    const { type, transfer } = req.body || {};

    if (type !== 'TRANSFER' || !transfer || !transfer.id) {
      console.log('[Asaas Authorization] Tipo de operacao nao suportado ou payload incompleto:', type);
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Tipo de operacao nao reconhecido pelo sistema.' });
    }

    const snapshot = await db.collection('withdrawals')
      .where('providerTransferId', '==', transfer.id)
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.error('[Asaas Authorization] Nenhum saque interno encontrado para transferId:', transfer.id);
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Transferencia nao corresponde a um saque registrado no sistema.' });
    }

    const withdrawal: any = snapshot.docs[0].data();

    if (withdrawal.status !== 'paid') {
      console.error('[Asaas Authorization] Saque', withdrawal.id, 'nao esta com status "paid" (atual:', withdrawal.status, ').');
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Saque nao esta no status esperado para pagamento.' });
    }

    if (withdrawal.antiFraudPassed !== true) {
      console.error('[Asaas Authorization] Saque', withdrawal.id, 'nao passou nas checagens antifraude internas.');
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Saque nao passou nas checagens antifraude internas.' });
    }

    const amountMatches = typeof transfer.value !== 'number' || Math.abs(transfer.value - withdrawal.amount) < 0.01;
    if (!amountMatches) {
      console.error('[Asaas Authorization] Valor da transferencia (', transfer.value, ') nao confere com o saque registrado (', withdrawal.amount, ').');
      return res.status(200).json({ status: 'REFUSED', refuseReason: 'Valor da transferencia nao confere com o saque registrado.' });
    }

    console.log('[Asaas Authorization] Saque', withdrawal.id, 'aprovado automaticamente para transferId:', transfer.id);
    return res.status(200).json({ status: 'APPROVED' });
  } catch (error: any) {
    console.error('[Asaas Authorization Error]', error);
    // Em caso de erro interno, e mais seguro recusar do que aprovar as cegas.
    return res.status(200).json({ status: 'REFUSED', refuseReason: 'Erro interno ao validar a operacao.' });
  }
}
