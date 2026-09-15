import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth, FieldValue } from '../_lib/common.js';
import { hasActiveAdminAuthority } from '../_lib/admin-authority.js';

/**
 * #325 (tarefa #125): migração única para o fim do modelo de dinheiro real
 * em Desafios Privados. api/_handlers/private-challenges.ts já para de criar
 * ou aceitar entrada em desafios com entryFee > 0 -- esta rota resolve o que
 * fica PARA TRÁS: desafios 'forming'/'active' criados antes da migração,
 * que já debitaram carteira de verdade e ficaram travados (não podem mais
 * ser preenchidos, mas também não foram estornados).
 *
 * Regra combinada com o usuário: estornar tudo e encerrar. Cada participante
 * recebe de volta o valor debitado (entryFee), o desafio vai para
 * 'cancelled' com uma nota de migração.
 *
 * Mesmas proteções do migrate-reset.ts: rota desligada por padrão (só liga
 * via env var), admin-only, e por cima disso -- dryRun=true por padrão, só
 * executa de verdade com ?dryRun=false explícito.
 *
 * Idempotência financeira: o documento determinístico de estorno é lido
 * DENTRO da mesma transação que incrementa o saldo. Duas execuções concorrentes
 * nunca podem creditar duas vezes o mesmo (challengeId, userId).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  if (process.env.ENABLE_MIGRATE_RESET !== 'true') {
    return res.status(404).json({ error: 'Rota não disponível.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const userSnap = await db.collection('users').doc(auth.uid).get();
  if (!userSnap.exists || !hasActiveAdminAuthority(userSnap.data())) {
    return res.status(403).json({ error: 'Só administradores ativos podem realizar esta ação.' });
  }

  // dryRun=true por padrão -- só grava de verdade com ?dryRun=false.
  const dryRun = String(req.query.dryRun ?? 'true').toLowerCase() !== 'false';

  try {
    const legacySnap = await db.collection('private_challenges')
      .where('status', 'in', ['forming', 'active'])
      .get();

    const affected: any[] = [];
    let totalRefunded = 0;

    for (const challengeDoc of legacySnap.docs) {
      const challenge = challengeDoc.data();
      const entryFee = Number(challenge.entryFee) || 0;
      if (entryFee <= 0) continue;

      const membersSnap = await db.collection('private_challenge_members')
        .where('challengeId', '==', challengeDoc.id)
        .get();

      const memberRefunds: any[] = [];
      let needsManualReconciliation = false;

      for (const memberDoc of membersSnap.docs) {
        const member = memberDoc.data();
        const userId = member.userId;
        if (!userId) {
          needsManualReconciliation = true;
          memberRefunds.push({ userId: null, amount: entryFee, status: 'invalid_member' });
          continue;
        }

        const refundTxId = `legacy_refund_${challengeDoc.id}_${userId}`;
        const refundTxRef = db.collection('walletTransactions').doc(refundTxId);

        if (dryRun) {
          const existing = await refundTxRef.get();
          if (existing.exists) {
            memberRefunds.push({ userId, amount: entryFee, status: 'already_refunded' });
            continue;
          }
          const userExists = (await db.collection('users').doc(userId).get()).exists;
          if (!userExists) {
            needsManualReconciliation = true;
            memberRefunds.push({ userId, amount: entryFee, status: 'user_missing' });
            continue;
          }
          memberRefunds.push({ userId, amount: entryFee, status: 'would_refund' });
          totalRefunded += entryFee;
          continue;
        }

        const userRef = db.collection('users').doc(userId);
        const settlement = await db.runTransaction(async (transaction) => {
          const [existingRefund, uSnap] = await Promise.all([
            transaction.get(refundTxRef),
            transaction.get(userRef),
          ]);

          if (existingRefund.exists) {
            const stored = existingRefund.data() || {};
            const matches = stored.userId === userId
              && stored.type === 'challenge_refund'
              && Number(stored.amount) === entryFee;
            if (!matches) {
              throw new Error(`Conflito no estorno legado ${refundTxId}; migração interrompida.`);
            }
            return { status: 'already_refunded' as const, credited: false };
          }

          if (!uSnap.exists) {
            return { status: 'user_missing' as const, credited: false };
          }

          const uData = uSnap.data() || {};
          const parsedBalance = Number(uData.walletBalance);
          const oldBalance = Number.isFinite(parsedBalance) ? parsedBalance : 0;
          const createdAt = new Date().toISOString();

          transaction.update(userRef, { walletBalance: FieldValue.increment(entryFee) });
          transaction.set(refundTxRef, {
            id: refundTxId,
            challengeId: challengeDoc.id,
            userId,
            type: 'challenge_refund',
            amount: entryFee,
            previousBalance: oldBalance,
            newBalance: oldBalance + entryFee,
            createdAt,
            status: 'approved',
            description: `Estorno (fim do modelo com dinheiro em Desafios Privados): ${challenge.title}`
          });

          return { status: 'refunded' as const, credited: true };
        });

        memberRefunds.push({ userId, amount: entryFee, status: settlement.status });
        if (settlement.credited) totalRefunded += entryFee;
        if (settlement.status === 'user_missing') needsManualReconciliation = true;
      }

      if (!dryRun) {
        if (needsManualReconciliation) {
          await challengeDoc.ref.set({
            updatedAt: new Date().toISOString(),
            legacyMigrationStatus: 'NEEDS_MANUAL_RECONCILIATION',
            legacyMigrationNote: 'Migração pausada: há participante sem conta localizável ou vínculo inválido. Nenhum estorno já conciliado será duplicado em nova execução.'
          }, { merge: true });
        } else {
          await challengeDoc.ref.update({
            status: 'cancelled',
            updatedAt: new Date().toISOString(),
            legacyMigrationStatus: 'REFUNDED_AND_CANCELLED',
            legacyMigrationNote: 'Cancelado e estornado automaticamente: Desafios Privados deixou de usar dinheiro real (#325).'
          });
        }
      }

      affected.push({
        challengeId: challengeDoc.id,
        title: challenge.title,
        entryFee,
        requiresManualReconciliation: needsManualReconciliation,
        members: memberRefunds
      });
    }

    return res.status(200).json({
      success: true,
      dryRun,
      challengesAffected: affected.length,
      totalRefunded,
      details: affected
    });
  } catch (error: any) {
    console.error('[Migration][legacy-private-challenges] Falhou:', error);
    return res.status(500).json({ error: error.message || 'Não foi possível executar a migração.' });
  }
}
