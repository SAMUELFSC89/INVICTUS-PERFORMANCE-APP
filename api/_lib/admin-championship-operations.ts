import { db } from './common.js';
import { getRuntimeChampionship } from './championship-catalog.js';
import { getChampionshipLeaderboard } from './championship-scoring-service.js';
import { finalizePaidChampionship } from './paid-championship-settlement.js';
import { logEvent } from './observability.js';
import { publishAdminRealtimeSignalSafe } from './admin-realtime.js';

function safeLimit(value: unknown, fallback = 100, max = 250): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, parsed)) : fallback;
}

function safeId(value: unknown): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error('championshipId inválido.');
  }
  return normalized;
}

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof (value as any)?.toMillis === 'function') return Number((value as any).toMillis()) || 0;
  if (typeof (value as any)?._seconds === 'number') return Number((value as any)._seconds) * 1000;
  if (typeof (value as any)?.seconds === 'number') return Number((value as any).seconds) * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoText(value: unknown): string | null {
  const ms = toMillis(value);
  return ms > 0 ? new Date(ms).toISOString() : null;
}

export async function listChampionshipAdminRegistrations(championshipIdInput: unknown, limitInput?: unknown) {
  const championshipId = safeId(championshipIdInput);
  const championship = await getRuntimeChampionship(championshipId);
  if (!championship?.editionId) throw new Error('Edição ativa não encontrada.');
  const limit = safeLimit(limitInput);

  const snapshot = await db.collection('championship_registrations')
    .where('editionId', '==', championship.editionId)
    .limit(limit)
    .get();

  const registrations = snapshot.docs
    .map((document: any) => {
      const data = document.data() || {};
      return {
        id: document.id,
        userId: String(data.userId || ''),
        userName: String(data.userName || data.displayName || 'Atleta Invictus'),
        userPhoto: data.userPhoto || null,
        status: String(data.status || ''),
        paymentStatus: String(data.paymentStatus || ''),
        amount: Number(data.amount || 0),
        paymentMethod: data.paymentMethod || null,
        checkoutSurface: data.checkoutSurface || null,
        createdAt: isoText(data.createdAt) || data.createdAt || null,
        paidAt: isoText(data.paidAt) || data.paidAt || null,
        reconciliationRequired: data.paymentStatus === 'RECONCILIATION_REQUIRED' || data.status === 'contestada',
        externalPaymentReference: data.externalPaymentReference || null,
        asaasPaymentId: data.asaasPaymentId || null,
      };
    })
    .sort((a: any, b: any) => toMillis(b.createdAt) - toMillis(a.createdAt));

  return {
    championshipId: championship.id,
    editionId: championship.editionId,
    title: championship.title,
    registrations,
    returned: registrations.length,
    limit,
  };
}

export async function getChampionshipAdminLeaderboard(championshipIdInput: unknown, limitInput?: unknown) {
  const championshipId = safeId(championshipIdInput);
  const championship = await getRuntimeChampionship(championshipId);
  if (!championship?.editionId) throw new Error('Edição ativa não encontrada.');
  const limit = safeLimit(limitInput, 100, 250);
  const leaderboard = await getChampionshipLeaderboard(championship.id, limit);
  return {
    championshipId: championship.id,
    editionId: championship.editionId,
    title: championship.title,
    status: championship.status,
    leaderboard,
    returned: leaderboard.length,
  };
}

export async function homologateChampionshipAsAdmin(championshipIdInput: unknown, reviewerId: string) {
  const championshipId = safeId(championshipIdInput);
  const championship = await getRuntimeChampionship(championshipId);
  if (!championship?.editionId) throw new Error('Edição ativa não encontrada.');

  const settlementAt = Date.parse(String(championship.settlementAt || ''));
  if (!Number.isFinite(settlementAt)) throw new Error('A edição não possui data válida de homologação.');
  if (Date.now() < settlementAt) {
    throw new Error(`A homologação só pode ocorrer a partir de ${new Date(settlementAt).toISOString()}.`);
  }

  const settlement = await finalizePaidChampionship(championship.id, new Date());
  await logEvent({
    severity: 'HIGH_RISK',
    category: 'admin_reviews',
    message: `Administrador executou homologação manual da edição ${championship.editionId}.`,
    userId: reviewerId,
    route: '/api/admin-championships?action=homologate',
    details: {
      championshipId: championship.id,
      editionId: championship.editionId,
      settlementStatus: settlement?.status || null,
      totalPaid: Number(settlement?.totalPaid || 0),
      winners: Array.isArray(settlement?.winnerAssignments) ? settlement.winnerAssignments.length : 0,
    },
  });
  publishAdminRealtimeSignalSafe({ type: 'ADMIN_CONFIG_CHANGED', source: 'admin-championships:homologate' });
  return { success: true, championshipId: championship.id, editionId: championship.editionId, settlement };
}
