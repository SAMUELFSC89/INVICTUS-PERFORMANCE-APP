import { db, FieldValue } from './common.js';

export interface CalculatedSeason {
  seasonId: string;
  seasonStart: string;
  seasonEnd: string;
  status: 'ACTIVE' | 'WAITING';
}

/**
 * Calculates season details based on payment date as requested by the strict season policy.
 */
export function calculateSeasonDetails(purchaseDate: Date): CalculatedSeason {
  const day = purchaseDate.getDate();
  const year = purchaseDate.getFullYear();
  const month = purchaseDate.getMonth(); // 0-11
  
  if (day === 1) {
    const startsAt = new Date(year, month, 1, 0, 0, 0, 0);
    const endsAt = new Date(year, month, 14, 23, 59, 59, 999);
    const seasonId = `season_${year}_${String(month + 1).padStart(2, '0')}_A`;
    return {
      seasonId,
      seasonStart: startsAt.toISOString(),
      seasonEnd: endsAt.toISOString(),
      status: 'ACTIVE'
    };
  } else if (day >= 2 && day <= 14) {
    const startsAt = new Date(year, month, 15, 0, 0, 0, 0);
    const endsAt = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const seasonId = `season_${year}_${String(month + 1).padStart(2, '0')}_B`;
    return {
      seasonId,
      seasonStart: startsAt.toISOString(),
      seasonEnd: endsAt.toISOString(),
      status: 'WAITING'
    };
  } else if (day === 15) {
    const startsAt = new Date(year, month, 15, 0, 0, 0, 0);
    const endsAt = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const seasonId = `season_${year}_${String(month + 1).padStart(2, '0')}_B`;
    return {
      seasonId,
      seasonStart: startsAt.toISOString(),
      seasonEnd: endsAt.toISOString(),
      status: 'ACTIVE'
    };
  } else {
    // Day >= 16. Starts Dia 1 of next month.
    const nextMonthDate = new Date(year, month + 1, 1);
    const nYear = nextMonthDate.getFullYear();
    const nMonth = nextMonthDate.getMonth();
    
    const startsAt = new Date(nYear, nMonth, 1, 0, 0, 0, 0);
    const endsAt = new Date(nYear, nMonth, 14, 23, 59, 59, 999);
    const seasonId = `season_${nYear}_${String(nMonth + 1).padStart(2, '0')}_A`;
    return {
      seasonId,
      seasonStart: startsAt.toISOString(),
      seasonEnd: endsAt.toISOString(),
      status: 'WAITING'
    };
  }
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
  const amount = orderData.amount;

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
  const seasonDetails = calculateSeasonDetails(now);
  const startD = new Date(seasonDetails.seasonStart);
  const nextSeasonStartStr = `${String(startD.getDate()).padStart(2, '0')}/${String(startD.getMonth() + 1).padStart(2, '0')}/${startD.getFullYear()}`;
  
  const subscriptionTier = planId === 'invictus_performance' ? 'performance' : 'open';

  if (subscriptionTier === 'performance') {
    const registrationId = `${userId}_${seasonDetails.seasonId}`;
    await db.collection('season_registrations').doc(registrationId).set({
      userId,
      seasonId: seasonDetails.seasonId,
      seasonStart: seasonDetails.seasonStart,
      seasonEnd: seasonDetails.seasonEnd,
      registrationDate: now.toISOString(),
      status: seasonDetails.status
    });
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
    seasonStatus: subscriptionTier === 'performance' 
      ? (seasonDetails.status === 'ACTIVE' ? 'ACTIVE' : 'WAITING_NEXT_SEASON')
      : 'NOT_ELIGIBLE',
    nextSeasonStart: subscriptionTier === 'performance' ? nextSeasonStartStr : '',
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
    seasonStatus: 'INACTIVE',
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
