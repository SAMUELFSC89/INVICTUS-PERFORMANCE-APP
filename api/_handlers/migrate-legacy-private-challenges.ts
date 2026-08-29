import { VercelRequest, VercelResponse } from '@vercel/node';
import { db, cors, verifyAuth, FieldValue } from '../_lib/common.js';

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
 * executa de verdade com ?dryRun=false explícito. Idempotente: usa um ID
 * determinístico por (challengeId, userId) pro documento de estorno, então
 * rodar de novo não duplica reembolso.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  if (process.env.ENABLE_MIGRATE_RESET !== 'true') {
    return res.status(404).json({ error: 'Rota não disponível.' });
  }

  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const userSnap = await db.collection('users').doc(auth.uid).get();
  const userData = userSnap.data();
  const adminEmails = new Set(['samuelfsc89@gmail.com', 'mucafsc89@gmail.com']);
  if (userData?.role !== 'admin' && !adminEmails.has(String(auth.email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Só administradores podem realizar esta ação.' });
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
      if (entryFee <= 0) continue; // já é um desafio do modelo novo (sem dinheiro), não mexe

      const membersSnap = await db.collection('private_challenge_members')
        .where('challengeId', '==', challengeDoc.id)
        .get();

      const memberRefunds: any[] = [];

      for (const memberDoc of membersSnap.docs) {
        const member = memberDoc.data();
        const userId = member.userId;
        if (!userId) continue;

        // ID determinístico -- reexecutar a migração nunca duplica o estorno
        // do mesmo membro do mesmo desafio.
        const refundTxId = `legacy_refund_${challengeDoc.id}_${userId}`;
        const refundTxRef = db.collection('walletTransactions').doc(refundTxId);
        const existing = await refundTxRef.get();
        if (existing.exists) {
          memberRefunds.push({ userId, amount: entryFee, status: 'already_refunded' });
          continue;
        }

        memberRefunds.push({ userId, amount: entryFee, status: dryRun ? 'would_refund' : 'refunded' });

        if (!dryRun) {
          const userRef = db.collection('users').doc(userId);
          await db.runTransaction(async (transaction) => {
            const uSnap = await transaction.get(userRef);
            if (!uSnap.exists) return;
            const uData = uSnap.data() || {};
            const oldBalance = uData.walletBalance !== undefined ? Number(uData.walletBalance) : 0;

            transaction.update(userRef, { walletBalance: FieldValue.increment(entryFee) });
            transaction.set(refundTxRef, {
              id: refundTxId,
              userId,
              type: 'challenge_refund',
              amount: entryFee,
              previousBalance: oldBalance,
              newBalance: oldBalance + entryFee,
              createdAt: new Date().toISOString(),
              status: 'approved',
              description: `Estorno (fim do modelo com dinheiro em Desafios Privados): ${challenge.title}`
            });
          });
        }

        totalRefunded += entryFee;
      }

      if (!dryRun) {
        await challengeDoc.ref.update({
          status: 'cancelled',
          updatedAt: new Date().toISOString(),
          legacyMigrationNote: 'Cancelado e estornado automaticamente: Desafios Privados deixou de usar dinheiro real (#325).'
        });
      }

      affected.push({
        challengeId: challengeDoc.id,
        title: challenge.title,
        entryFee,
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
