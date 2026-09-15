import { db } from './common.js';
import { championshipPrizeAwardId } from './championship-prize-credit.js';

const RISK_PAYMENT_STATUSES = new Set([
  'REFUNDED',
  'RECONCILIATION_REQUIRED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
]);

export interface ChampionshipPrizeFinancialRisk {
  championshipId: string;
  registrationStatus: string;
  paymentStatus: string;
  paymentLifecycleEvent: string;
  awardAmount: number;
  rank: number;
  transactionId: string;
}

function registrationHasFinancialRisk(registration: Record<string, any>): boolean {
  const status = String(registration.status || '');
  const paymentStatus = String(registration.paymentStatus || '');
  const lifecycleEvent = String(registration.paymentLifecycleEvent || '');
  return status === 'reembolsada'
    || status === 'contestada'
    || RISK_PAYMENT_STATUSES.has(paymentStatus)
    || RISK_PAYMENT_STATUSES.has(lifecycleEvent);
}

async function readTarget(target: any, transaction?: any): Promise<any> {
  return transaction ? transaction.get(target) : target.get();
}

/**
 * Cruza o estado financeiro atual da inscrição com um award realmente
 * creditado. Uma inscrição reembolsada sem prêmio não bloqueia outros saldos.
 *
 * Quando `transaction` é fornecida, todas as leituras participam da mesma
 * transação Firestore do chamador. Isso permite que a autorização Asaas seja
 * serializada com webhooks concorrentes de chargeback/reembolso.
 */
export async function getChampionshipPrizeFinancialRisk(
  userId: string,
  transaction?: any,
): Promise<ChampionshipPrizeFinancialRisk | null> {
  if (!userId) return null;
  const query = db.collection('championship_registrations').where('userId', '==', userId);
  const registrationsSnap = await readTarget(query, transaction);
  const riskyRegistrations = registrationsSnap.docs
    .map((doc: any) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter(registrationHasFinancialRisk);

  for (const registration of riskyRegistrations) {
    const championshipId = String(registration.championshipId || '');
    if (!championshipId) continue;
    const awardRef = db.collection('championship_prize_awards').doc(championshipPrizeAwardId(championshipId, userId));
    const awardSnap = await readTarget(awardRef, transaction);
    if (!awardSnap.exists) continue;
    const award = awardSnap.data() || {};
    if (award.status !== 'CREDITED' || String(award.userId || '') !== userId || String(award.championshipId || '') !== championshipId) continue;
    return {
      championshipId,
      registrationStatus: String(registration.status || ''),
      paymentStatus: String(registration.paymentStatus || ''),
      paymentLifecycleEvent: String(registration.paymentLifecycleEvent || ''),
      awardAmount: Math.max(0, Number(award.amount) || 0),
      rank: Math.max(0, Number(award.rank) || 0),
      transactionId: String(award.transactionId || ''),
    };
  }

  return null;
}

export async function assertNoChampionshipPrizeFinancialRisk(userId: string, transaction?: any): Promise<void> {
  const risk = await getChampionshipPrizeFinancialRisk(userId, transaction);
  if (!risk) return;
  throw new Error(
    `Saque bloqueado: prêmio do campeonato ${risk.championshipId} está em conciliação financeira após reembolso/chargeback.`,
  );
}
