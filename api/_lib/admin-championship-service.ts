import { db } from './common.js';
import { listChampionships } from './championship-catalog.js';
import { paidChampionshipSettlementDocumentId } from './paid-championship-edition.js';
import { logEvent } from './observability.js';
import { publishAdminRealtimeSignalSafe } from './admin-realtime.js';

const SUPPORTED_IDS = new Set(['invictus_strength_v1', 'invictus_cardio_v1']);

function safeText(value: unknown, max = 180): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function iso(value: unknown, field: string): string {
  const raw = safeText(value, 80);
  const date = new Date(raw);
  if (!raw || !Number.isFinite(date.getTime())) throw new Error(`${field} precisa ser uma data válida.`);
  return date.toISOString();
}

function amount(value: unknown, field: string, min = 0, max = 1_000_000): number {
  const parsed = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${field} possui valor inválido.`);
  return parsed;
}

function normalizePrizes(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) throw new Error('Informe uma distribuição de premiação válida.');
  const prizes = value.map((item: any) => ({
    rank: Math.floor(Number(item?.rank)),
    amount: amount(item?.amount, 'Premiação', 0.01),
    label: safeText(item?.label, 80),
  })).sort((a, b) => a.rank - b.rank);
  if (new Set(prizes.map(item => item.rank)).size !== prizes.length) throw new Error('A premiação possui posições duplicadas.');
  prizes.forEach((item, index) => {
    if (item.rank !== index + 1) throw new Error('A premiação precisa usar posições contínuas a partir do 1º lugar.');
  });
  const total = prizes.reduce((sum, item) => sum + item.amount, 0);
  return prizes.map(item => ({ ...item, percentage: Number(((item.amount / total) * 100).toFixed(4)), label: item.label || `${item.rank}º lugar` }));
}

export function normalizeChampionshipDraft(input: Record<string, any>) {
  const championshipId = safeText(input.championshipId, 80);
  if (!SUPPORTED_IDS.has(championshipId)) throw new Error('Campeonato não suportado pelo motor oficial.');
  const modality = championshipId === 'invictus_cardio_v1' ? 'cardio' : 'musculacao';
  const startAt = iso(input.startAt, 'Início do campeonato');
  const endAt = iso(input.endAt, 'Fim do campeonato');
  const settlementAt = iso(input.settlementAt, 'Homologação');
  const registrationOpensAt = iso(input.registrationOpensAt, 'Abertura das inscrições');
  const registrationClosesAt = iso(input.registrationClosesAt, 'Fechamento das inscrições');
  if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error('O fim do campeonato deve ocorrer depois do início.');
  if (Date.parse(registrationClosesAt) <= Date.parse(registrationOpensAt)) throw new Error('O fechamento das inscrições deve ocorrer depois da abertura.');
  if (Date.parse(registrationClosesAt) > Date.parse(endAt)) throw new Error('As inscrições não podem encerrar depois do campeonato.');
  if (Date.parse(settlementAt) <= Date.parse(endAt)) throw new Error('A homologação precisa ocorrer depois do encerramento.');

  const allowedCardioTypes = modality === 'cardio'
    ? Array.from(new Set((Array.isArray(input.allowedCardioTypes) ? input.allowedCardioTypes : [])
      .map((value: unknown) => safeText(value, 40).toLowerCase())
      .filter(Boolean)))
    : [];
  if (modality === 'cardio' && allowedCardioTypes.length === 0) throw new Error('Publique pelo menos uma modalidade de cardio elegível.');

  const prizes = normalizePrizes(input.prizes);
  return {
    championshipId,
    modality,
    title: safeText(input.title, 140) || (modality === 'cardio' ? 'Campeonato Invictus de Cardio' : 'Campeonato Invictus de Musculação'),
    edition: safeText(input.edition, 100) || 'Nova edição',
    description: safeText(input.description, 1000),
    startAt,
    endAt,
    settlementAt,
    registrationOpensAt,
    registrationClosesAt,
    registrationPrice: amount(input.registrationPrice, 'Preço da inscrição', 0.01, 10_000),
    prizes,
    prizePool: Math.round(prizes.reduce((sum, prize) => sum + prize.amount, 0) * 100) / 100,
    allowedCardioTypes,
    antiFraudProfile: {
      minDurationMinutes: Math.max(1, Math.min(360, Math.floor(Number(input.antiFraudProfile?.minDurationMinutes) || (modality === 'cardio' ? 20 : 30)))),
      maxDurationMinutes: Math.max(1, Math.min(720, Math.floor(Number(input.antiFraudProfile?.maxDurationMinutes) || 90))),
      requireGeofence: modality === 'musculacao' ? input.antiFraudProfile?.requireGeofence !== false : false,
      requireContinuousGPS: modality === 'cardio' ? input.antiFraudProfile?.requireContinuousGPS !== false : false,
      maxRiskScore: Math.max(0, Math.min(100, Number(input.antiFraudProfile?.maxRiskScore) || 35)),
    },
    registrationEnabled: Boolean(input.registrationEnabled),
  };
}

async function stateForChampionship(runtime: any) {
  const [draftSnap, lockSnap] = await Promise.all([
    db.collection('championship_admin_drafts').doc(runtime.id).get(),
    db.collection('championship_edition_locks').doc(runtime.id).get(),
  ]);
  const lock = lockSnap.exists ? lockSnap.data() || {} : null;
  const activeEditionId = String(lock?.activeEditionId || runtime.editionId || '');
  const settlementSnap = activeEditionId
    ? await db.collection('championship_settlements').doc(paidChampionshipSettlementDocumentId(activeEditionId)).get()
    : null;
  const registrationSnap = activeEditionId
    ? await db.collection('championship_registrations').where('editionId', '==', activeEditionId).get()
    : null;
  const registrations = registrationSnap?.docs.map((doc: any) => doc.data() || {}) || [];
  return {
    runtime,
    draft: draftSnap.exists ? { id: draftSnap.id, ...draftSnap.data() } : null,
    lock,
    settlement: settlementSnap?.exists ? { id: settlementSnap.id, ...settlementSnap.data() } : null,
    registrations: {
      total: registrations.length,
      paid: registrations.filter((item: any) => item.status === 'paga' && item.paymentStatus === 'PAID').length,
      pending: registrations.filter((item: any) => item.status === 'pendente' || item.paymentStatus === 'PENDING').length,
      reconciliation: registrations.filter((item: any) => item.paymentStatus === 'RECONCILIATION_REQUIRED' || item.status === 'contestada').length,
    },
  };
}

export async function getChampionshipAdminState() {
  const championships = await Promise.all(listChampionships().map(stateForChampionship));
  return {
    championships,
    migration: {
      phase: 'DRAFT_CONTROL',
      liveRuntimeSource: 'environment + immutable edition locks',
      targetRuntimeSource: 'published championship configuration + immutable edition snapshots',
      publishEnabled: false,
      reason: 'Publicação permanece bloqueada até todos os consumidores de pagamento, scoring e settlement usarem a mesma configuração publicada. Isso evita split-brain financeiro/competitivo.',
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function saveChampionshipDraft(input: Record<string, any>, reviewerId: string) {
  const draft = normalizeChampionshipDraft(input);
  const ref = db.collection('championship_admin_drafts').doc(draft.championshipId);
  const now = new Date().toISOString();
  await ref.set({
    ...draft,
    status: 'DRAFT',
    updatedAt: now,
    updatedBy: reviewerId,
    createdAt: input.createdAt || now,
  }, { merge: true });
  await logEvent({
    severity: 'INFO',
    category: 'admin_reviews',
    message: `Rascunho da próxima edição ${draft.championshipId} atualizado pelo Admin.`,
    userId: reviewerId,
    route: '/api/admin-championships?action=save-draft',
    details: { championshipId: draft.championshipId, edition: draft.edition, registrationPrice: draft.registrationPrice, prizePool: draft.prizePool },
  });
  publishAdminRealtimeSignalSafe({ type: 'ADMIN_CONFIG_CHANGED', source: 'admin-championships:draft' });
  const snap = await ref.get();
  return { id: ref.id, ...snap.data() };
}

export async function deleteChampionshipDraft(championshipId: string, reviewerId: string) {
  const normalized = safeText(championshipId, 80);
  if (!SUPPORTED_IDS.has(normalized)) throw new Error('Campeonato inválido.');
  await db.collection('championship_admin_drafts').doc(normalized).delete();
  await logEvent({
    severity: 'INFO', category: 'admin_reviews',
    message: `Rascunho administrativo ${normalized} descartado.`, userId: reviewerId,
    route: '/api/admin-championships?action=delete-draft', details: { championshipId: normalized },
  });
  publishAdminRealtimeSignalSafe({ type: 'ADMIN_CONFIG_CHANGED', source: 'admin-championships:delete-draft' });
  return { success: true };
}
