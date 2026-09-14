import { db } from './common.js';
import { PIXWithdrawal, WithdrawalStatus } from '../../src/types.js';
import { notificationService } from '../_services/notification-service.js';

const REVIEWABLE_STATUSES = new Set<WithdrawalStatus>(['pending', 'under_review', 'approved']);
const ADMIN_TARGET_STATUSES = new Set<WithdrawalStatus>(['pending', 'under_review', 'approved', 'cancelled', 'rejected']);

/**
 * Atualiza o estado administrativo do saque sem permitir que uma decisão
 * manual concorra com uma transferência já submetida ao Asaas. Para
 * cancelamento/rejeição, status + estorno do hold + ledger são uma única
 * transação Firestore.
 */
export async function updateWithdrawalStatusSafely(
  withdrawalId: string,
  newStatus: WithdrawalStatus,
  reviewerId?: string,
  adminNote?: string
): Promise<PIXWithdrawal> {
  if (!db) throw new Error('Database not initialized');
  if (!ADMIN_TARGET_STATUSES.has(newStatus)) throw new Error('Status de saque inválido para atualização administrativa.');

  const withdrawalRef = db.collection('withdrawals').doc(withdrawalId);
  let changed = false;

  const result = await db.runTransaction(async (tx: any): Promise<PIXWithdrawal> => {
    const withdrawalSnap = await tx.get(withdrawalRef);
    if (!withdrawalSnap.exists) throw new Error('Solicitação de saque não encontrada.');

    const withdrawal = withdrawalSnap.data() as PIXWithdrawal & Record<string, any>;
    const previousStatus = withdrawal.status;
    if (previousStatus === newStatus) return withdrawal as PIXWithdrawal;

    // Uma vez que processPayment marcou processing, apenas o webhook/reconciliação
    // pode finalizar. Um admin nunca pode sobrescrever esse estado e liberar o
    // hold enquanto o PIX pode estar em trânsito no provedor.
    if (!REVIEWABLE_STATUSES.has(previousStatus)) {
      throw new Error(`Saque em estado '${previousStatus}' não pode mais ser alterado manualmente.`);
    }

    const updatedAt = new Date().toISOString();
    const patch: Record<string, unknown> = {
      status: newStatus,
      updatedAt,
      ...(adminNote ? { adminNote } : {}),
      ...(reviewerId ? { reviewerId } : {}),
    };

    if (newStatus === 'cancelled' || newStatus === 'rejected') {
      const amount = Number(withdrawal.amount);
      if (!withdrawal.userId || !Number.isFinite(amount) || amount <= 0) {
        throw new Error('Dados financeiros do saque estão inválidos para estorno.');
      }

      const walletRef = db.collection('wallets').doc(withdrawal.userId);
      const refundTxRef = db.collection('iv_transactions').doc(`tx_res_refund_${withdrawalId}`);
      const [walletSnap, existingRefund] = await Promise.all([
        tx.get(walletRef),
        tx.get(refundTxRef),
      ]);

      if (!walletSnap.exists) throw new Error('Carteira não encontrada para estornar o saque.');

      if (existingRefund.exists) {
        const refund = existingRefund.data() || {};
        if (refund.userId !== withdrawal.userId
          || Math.abs(Number(refund.amount) - amount) >= 0.01
          || refund.origin !== 'withdrawal_refund') {
          throw new Error('Ledger de estorno existente não corresponde ao saque. Operação exige conciliação.');
        }
      } else {
        const wallet = walletSnap.data() || {};
        const blocked = Number(wallet.blockedBalance) || 0;
        const redeemable = Number(wallet.redeemableBalance) || 0;
        const ecosystem = Number(wallet.ecosystemBalance) || 0;
        const promotional = Number(wallet.promotionalBalance) || 0;
        if (blocked < amount) {
          throw new Error('Saldo bloqueado inconsistente para estornar este saque. Operação exige conciliação.');
        }

        const nextBlocked = blocked - amount;
        const nextRedeemable = redeemable + amount;
        tx.set(walletRef, {
          blockedBalance: nextBlocked,
          redeemableBalance: nextRedeemable,
          totalBalance: nextRedeemable + ecosystem + promotional,
          updatedAt,
        }, { merge: true });
        tx.create(refundTxRef, {
          id: refundTxRef.id,
          userId: withdrawal.userId,
          amount,
          category: 'redeemable',
          type: 'credit',
          origin: 'withdrawal_refund',
          destination: 'Carteira (Estorno)',
          description: 'Estorno de saque PIX cancelado/recusado',
          createdAt: updatedAt,
        });
      }
    }

    tx.set(withdrawalRef, patch, { merge: true });
    changed = true;
    return { ...withdrawal, ...patch } as PIXWithdrawal;
  });

  if (changed && (newStatus === 'cancelled' || newStatus === 'rejected')) {
    notificationService.notify({
      userId: result.userId,
      type: 'payment',
      title: 'Saque não aprovado',
      message: adminNote || (`Seu saque de R$ ${Number(result.amount).toFixed(2)} foi ${newStatus === 'rejected' ? 'rejeitado' : 'cancelado'}. O valor foi devolvido ao seu saldo.`),
      actionUrl: '/wallet',
    }).catch((error) => console.error('[WithdrawalAdminStatus] Falha ao notificar estorno:', error));
  }

  return result;
}
