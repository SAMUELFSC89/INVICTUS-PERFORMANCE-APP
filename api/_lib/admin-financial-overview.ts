import { db } from './common.js';

type FinancialPoint = { key: string; label: string; revenue: number; payments: number };

function asDate(value: any): Date | null {
  if (!value) return null;
  const raw = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return raw instanceof Date && Number.isFinite(raw.getTime()) ? raw : null;
}

function asAmount(value: any): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    .format(date)
    .replace('.', '');
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayLabel(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(date);
}

function canonicalPaymentCategory(data: Record<string, any>): string {
  const explicit = String(data.planId || data.productId || data.productType || data.kind || data.source || '').trim();
  if (explicit) return explicit.slice(0, 80);
  const orderId = String(data.orderId || data.id || '').toLowerCase();
  if (orderId.includes('performance')) return 'performance';
  if (orderId.includes('open')) return 'open';
  if (orderId.includes('champ')) return 'championship';
  return 'outros';
}

async function approvedPaymentDocs(start: Date): Promise<any[]> {
  try {
    const snap = await db.collection('payment_orders')
      .where('status', '==', 'approved')
      .where('paidAt', '>=', start.toISOString())
      .orderBy('paidAt', 'asc')
      .limit(5000)
      .get();
    return snap.docs;
  } catch (error: any) {
    console.warn('[Admin Financial] Falling back to bounded payment scan:', error?.message || error);
    const snap = await db.collection('payment_orders').where('status', '==', 'approved').limit(5000).get();
    return snap.docs.filter((doc: any) => {
      const paidAt = asDate(doc.data()?.paidAt);
      return paidAt && paidAt >= start;
    });
  }
}

async function recentCollection(collectionName: string, limitCount = 2000): Promise<any[]> {
  try {
    const snap = await db.collection(collectionName).orderBy('createdAt', 'desc').limit(limitCount).get();
    return snap.docs;
  } catch {
    const snap = await db.collection(collectionName).limit(limitCount).get();
    return snap.docs;
  }
}

export async function getAdminFinancialOverview() {
  const now = new Date();
  const firstMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const firstDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));

  const months = new Map<string, FinancialPoint>();
  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    months.set(monthKey(date), { key: monthKey(date), label: monthLabel(date), revenue: 0, payments: 0 });
  }

  const days = new Map<string, FinancialPoint>();
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    days.set(dayKey(date), { key: dayKey(date), label: dayLabel(date), revenue: 0, payments: 0 });
  }

  const [paymentDocs, storeDocs, withdrawalDocs] = await Promise.all([
    approvedPaymentDocs(firstMonth),
    recentCollection('physicalOrders'),
    recentCollection('withdrawals'),
  ]);

  let grossRevenue = 0;
  let approvedPayments = 0;
  const byCategory = new Map<string, { category: string; revenue: number; payments: number }>();

  paymentDocs.forEach((doc: any) => {
    const data = doc.data() || {};
    const amount = asAmount(data.amount);
    const paidAt = asDate(data.paidAt);
    if (!amount || !paidAt || paidAt < firstMonth) return;

    grossRevenue += amount;
    approvedPayments += 1;

    const monthly = months.get(monthKey(paidAt));
    if (monthly) {
      monthly.revenue += amount;
      monthly.payments += 1;
    }
    const daily = days.get(dayKey(paidAt));
    if (daily && paidAt >= firstDay) {
      daily.revenue += amount;
      daily.payments += 1;
    }

    const category = canonicalPaymentCategory({ id: doc.id, ...data });
    const current = byCategory.get(category) || { category, revenue: 0, payments: 0 };
    current.revenue += amount;
    current.payments += 1;
    byCategory.set(category, current);
  });

  let storeRevenue = 0;
  let storeOrders = 0;
  const revenueStoreStatuses = new Set(['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED']);
  storeDocs.forEach((doc: any) => {
    const data = doc.data() || {};
    const createdAt = asDate(data.createdAt);
    if (!createdAt || createdAt < firstMonth || !revenueStoreStatuses.has(String(data.status || '').toUpperCase())) return;
    const amount = asAmount(data.totalCashAmount);
    if (amount > 0) storeRevenue += amount;
    storeOrders += 1;
  });

  let payoutsPaid = 0;
  let payoutsPaidCount = 0;
  let payoutsInFlow = 0;
  withdrawalDocs.forEach((doc: any) => {
    const data = doc.data() || {};
    const createdAt = asDate(data.createdAt);
    if (!createdAt || createdAt < firstMonth) return;
    const status = String(data.status || '').toLowerCase();
    const amount = asAmount(data.amount);
    if (status === 'paid') {
      payoutsPaid += amount;
      payoutsPaidCount += 1;
    }
    if (['pending', 'under_review', 'approved', 'processing'].includes(status)) payoutsInFlow += 1;
  });

  const currentMonth = months.get(monthKey(now));
  const previousMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const previousMonth = months.get(monthKey(previousMonthDate));
  const currentMonthRevenue = currentMonth?.revenue || 0;
  const previousMonthRevenue = previousMonth?.revenue || 0;
  const monthOverMonthPercent = previousMonthRevenue > 0
    ? ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100
    : null;

  return {
    generatedAt: now.toISOString(),
    window: { start: firstMonth.toISOString(), end: now.toISOString() },
    grossRevenue,
    approvedPayments,
    averageTicket: approvedPayments > 0 ? grossRevenue / approvedPayments : 0,
    currentMonthRevenue,
    previousMonthRevenue,
    monthOverMonthPercent,
    store: { revenue: storeRevenue, orders: storeOrders },
    payouts: { paidAmount: payoutsPaid, paidCount: payoutsPaidCount, inFlowCount: payoutsInFlow },
    monthly: Array.from(months.values()).map((point) => ({ ...point, revenue: Number(point.revenue.toFixed(2)) })),
    daily: Array.from(days.values()).map((point) => ({ ...point, revenue: Number(point.revenue.toFixed(2)) })),
    byCategory: Array.from(byCategory.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 12)
      .map((item) => ({ ...item, revenue: Number(item.revenue.toFixed(2)) })),
  };
}
