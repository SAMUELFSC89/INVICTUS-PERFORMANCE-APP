import { db, FieldValue } from './common.js';
import { getOrInitCurrentSeasonWindow, calcularProximaJanela } from './season-prize-engine.js';

export interface CalculatedSeason {
  seasonId: string;
  seasonStart: string;
  seasonEnd: string;
  status: 'ACTIVE' | 'WAITING';
}

/**
 * Calculates season details based on payment date as requested by the strict season policy.
 */
/**
 * Em qual temporada a assinatura entra.
 *
 * REGRA: quem assina com a temporada JA EM ANDAMENTO entra na seguinte. Quem
 * assina antes de ela abrir (janela de campanha) entra nela mesma.
 *
 * Este calculo usa a MESMA janela de temporada do motor de premiacao
 * (season-prize-engine) e da tela do app -- 30 dias comecando numa segunda.
 * Antes havia aqui um calendario quinzenal proprio, com IDs em outro formato,
 * que nunca casava com o que o motor procurava na hora de pagar.
 */
export async function calculateSeasonDetails(purchaseDate: Date): Promise<CalculatedSeason> {
  const atual = await getOrInitCurrentSeasonWindow();
  const jaComecou = atual.startDate.getTime() <= purchaseDate.getTime();
  const janela = jaComecou ? calcularProximaJanela(atual) : atual;

  return {
    seasonId: janela.seasonId,
    seasonStart: janela.startDate.toISOString(),
    seasonEnd: janela.endDate.toISOString(),
    status: jaComecou ? 'WAITING' : 'ACTIVE',
  };
}

/**
 * Registers audit history inside payment_audit_logs.
 */
export async function logPaymentAudit(log: {
  userId: string;
  orderId: string;
  paymentId: string;
  previousStatus: string;
  newStatus: string;
  eventSource: string;
  action: 'checkout_created' | 'webhook_received' | 'payment_approved' | 'payment_pending' | 'payment_rejected' | 'pro_granted' | 'pro_revoked' | 'suspicious_frontend_attempt';
  reason: string;
}) {
  try {
    const logId = db.collection('payment_audit_logs').doc().id;
    await db.collection('payment_audit_logs').doc(logId).set({
      ...log,
      createdAt: new Date().toISOString()
    });
    console.log(`[Audit Log] Saved log event '${log.action}' for orderId: ${log.orderId}`);
  } catch (err) {
    console.error('[Audit Log Error] Failed to write payment audit log:', err);
  }
}

/**
 * Unique authorative backend function to grant Pro access to a user.
 * Enforces all integrity rules and avoids duplications.
 */
export async function grantProAccessAfterApprovedPayment(orderId: string, paymentId: string, eventSource: string) {
  const now = new Date();
  
  // 1. Fetch internal payment order
  const orderRef = db.collection('payment_orders').doc(orderId);
  const orderSnap = await orderRef.get();
  
  if (!orderSnap.exists) {
    throw new Error(`Pedido ${orderId} não foi encontrado no banco de dados.`);
  }
  
  const orderData = orderSnap.data()!;
  
  // Check duplication / state locking
  if (orderData.status === 'approved') {
    console.log(`[Grant Pro Skip] Order ${orderId} is already approved. Skipping provision.`);
    return { success: true, alreadyGranted: true };
  }

  const userId = orderData.userId;
  const planId = orderData.planId;

  console.log(`[Grant Pro Access] Processing approval for user ${userId}, order ${orderId}, payment ${paymentId}`);

  // 2. Perform DB update for the payment order to approved
  const previousStatus = orderData.status || 'pending';
  await orderRef.update({
    status: 'approved',
    paymentId,
    rawStatus: 'approved',
    paidAt: now.toISOString(),
    updatedAt: now.toISOString()
  });

  // Log payment approval in history logs
  await logPaymentAudit({
    userId,
    orderId,
    paymentId,
    previousStatus,
    newStatus: 'approved',
    eventSource,
    action: 'payment_approved',
    reason: `Pagamento com ID ${paymentId} confirmado via ${eventSource}.`
  });

  // 3. Create or update user entitlements
  const entitlementId = `${userId}_${planId}`;
  const durationDays = planId === 'invictus_annual' ? 365 : 30;
  const endsAt = new Date();
  endsAt.setDate(now.getDate() + durationDays);

  const entitlementRef = db.collection('user_entitlements').doc(entitlementId);
  await entitlementRef.set({
    userId,
    planId,
    status: 'active',
    sourceOrderId: orderId,
    purchasedAt: now.toISOString(),
    startsAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    expiresAt: endsAt.toISOString(),
    createdAt: orderData.createdAt || now.toISOString(),
    updatedAt: now.toISOString()
  }, { merge: true });

  // 4. Calculate elegant Season details
  const seasonDetails = await calculateSeasonDetails(now);
  const subscriptionTier = planId === 'invictus_performance' ? 'performance' : 'open';

  if (subscriptionTier === 'performance') {
    // NOTA: a assinatura NAO inscreve mais ninguem em temporada. Quem compete
    // e quem paga a INSCRICAO (ver api/_lib/inscricao-service.ts), cobrada por
    // PIX fora das lojas. O plano Pro vende recursos, nao entrada na disputa.
    //
    // A colecao season_registrations deixou de ser lida pelo motor de
    // premiacao, que agora usa season_inscriptions. Mantemos o registro apenas
    // como historico de que a assinatura comecou nesta janela.
    const registrationId = `${userId}_${seasonDetails.seasonId}`;
    await db.collection('season_registrations').doc(registrationId).set({
      userId,
      seasonId: seasonDetails.seasonId,
      seasonStart: seasonDetails.seasonStart,
      seasonEnd: seasonDetails.seasonEnd,
      registrationDate: now.toISOString(),
      status: seasonDetails.status,
      origem: 'assinatura',
    }, { merge: true });
  }

  // 5. Synchronize User profile database settings on the backend (safe from client updates)
  const currentPlan = subscriptionTier;
  const subscriptionStatus = subscriptionTier === 'performance' ? 'active_premium' : 'active_basic';
  const paymentStatus = 'approved';
  const customerId = orderData.customerId || userId;
  const subscriptionId = orderData.subscriptionId || '';
  const activatedAt = now.toISOString();
  const nextBillingDate = endsAt.toISOString();
  const expiresAt = endsAt.toISOString();

  await db.collection('users').doc(userId).set({
    isSubscribed: true,
    status: 'PRO_ATIVO',
    subscriptionTier,
    currentPlan,
    subscriptionStatus,
    paymentStatus,
    customerId,
    subscriptionId,
    orderId,
    chargeId: paymentId,
    activatedAt,
    nextBillingDate,
    expiresAt,
    plano: subscriptionTier === 'performance' ? 'performance' : 'basico',
    assinatura: 'ativa',
    statusPagamento: 'aprovado',
    premium: subscriptionTier === 'performance',
    performance: subscriptionTier === 'performance',
    // seasonStatus e nextSeasonStart NAO sao escritos aqui de proposito.
    // Quem compete e quem pagou a INSCRICAO da temporada; a assinatura vende
    // recursos. Ver sincronizarStatusDeTemporada em inscricao-service.ts.
    updatedAt: now.toISOString(),
    isPro: true,
    plan: 'pro',
    proStatus: 'active',
    proActivatedAt: FieldValue.serverTimestamp(),
    proPaymentId: paymentId
  }, { merge: true });

  // Record final pro access grant log
  await logPaymentAudit({
    userId,
    orderId,
    paymentId,
    previousStatus,
    newStatus: 'approved',
    eventSource,
    action: 'pro_granted',
    reason: `Acesso PRO liberado com sucesso. Plano: ${planId}. Temporada: ${seasonDetails.seasonId} (${seasonDetails.status}).`
  });

  console.log(`[Grant Pro Access] Pro access granted successfully for user: ${userId}`);
  return { success: true, alreadyGranted: false };
}

/**
 * Universal backend function to revoke Pro access of a user.
 */
export async function revokeProAccess(orderId: string, paymentId: string, newStatus: string, eventSource: string, reasonDetails: string) {
  const now = new Date();
  
  const orderRef = db.collection('payment_orders').doc(orderId);
  const orderSnap = await orderRef.get();
  
  if (!orderSnap.exists) {
    throw new Error(`Pedido ${orderId} não foi encontrado no banco de dados para revogação.`);
  }
  
  const orderData = orderSnap.data()!;
  const userId = orderData.userId;
  const previousStatus = orderData.status || 'pending';

  console.warn(`[Revoke Pro Access] Revoking user ${userId} PRO access since order transitioned to ${newStatus}`);

  // 1. Update order status in DB
  let riskFlags = orderData.riskFlags || [];
  if (newStatus === 'charged_back') {
    riskFlags.push('chargeback_detected', 'account_review_triggered');
  }

  await orderRef.update({
    status: newStatus,
    paymentId,
    rawStatus: newStatus,
    riskFlags,
    updatedAt: now.toISOString()
  });

  // 2. Suspend user entitlements
  const entitlementId = `${userId}_${orderData.planId}`;
  await db.collection('user_entitlements').doc(entitlementId).set({
    status: 'suspended',
    updatedAt: now.toISOString()
  }, { merge: true });

  // 3. Mark user back to FREE/INACTIVE in their user profile
  await db.collection('users').doc(userId).set({
    isSubscribed: false,
    status: 'FREE',
    subscriptionStatus: 'inactive',
    paymentStatus: newStatus,
    currentPlan: 'Nenhum',
    expiresAt: now.toISOString(),
    // Cancelar ou estornar a assinatura NAO tira o atleta da temporada que ele
    // ja pagou. A inscricao e uma compra separada, por temporada.
    plano: 'Nenhum',
    assinatura: 'Inativa',
    statusPagamento: newStatus,
    premium: false,
    performance: false,
    updatedAt: now.toISOString()
  }, { merge: true });

  // Apply extra infractions if chargeback occurs
  if (newStatus === 'charged_back') {
    try {
      await db.collection('users').doc(userId).set({
        isUnderReview: true,
        updatedAt: now.toISOString()
      }, { merge: true });
    } catch (profileErr) {
      console.warn('[Revoke Pro Error] Could not flag user profile infractions:', profileErr);
    }
  }

  // 4. Log audit record of revocation
  await logPaymentAudit({
    userId,
    orderId,
    paymentId,
    previousStatus,
    newStatus,
    eventSource,
    action: 'pro_revoked',
    reason: `Acesso PRO revogado devido ao status ${newStatus}. Motivo: ${reasonDetails}.`
  });

  return { success: true };
}
