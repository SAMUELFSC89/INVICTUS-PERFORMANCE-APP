import { createHash } from 'node:crypto';
import { Championship, type PrizeRank } from '../../src/types/championships.js';
import { PAID_CHAMPIONSHIP_OFFERS } from '../../shared/paidChampionshipPolicy.js';

/**
 * Hard gate de capacidade do motor pago.
 * O settlement foi validado em CI/E2E e esta capacidade pode permanecer habilitada.
 * A abertura comercial continua fail-closed e depende explicitamente de
 * PAID_CHAMPIONSHIP_REGISTRATION_ENABLED=true, além de calendário, premiação,
 * edição e integrações financeiras válidas.
 */
export const PAID_CHAMPIONSHIP_SETTLEMENT_IMPLEMENTED = true;

function env(name: string): string {
  return String(process.env[name] || '').trim();
}

function parsePrizeDistribution(name: string): PrizeRank[] {
  const raw = env(name);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed
      .map((item: any) => ({
        rank: Math.floor(Number(item?.rank)),
        amount: Math.round(Number(item?.amount) * 100) / 100,
        percentage: Number(item?.percentage),
        label: String(item?.label || '').trim(),
      }))
      .filter((item) => Number.isInteger(item.rank) && item.rank > 0 && Number.isFinite(item.amount) && item.amount > 0)
      .sort((a, b) => a.rank - b.rank);

    if (new Set(valid.map((item) => item.rank)).size !== valid.length) return [];
    if (valid.some((item, index) => item.rank !== index + 1)) return [];

    const pool = valid.reduce((sum, item) => sum + item.amount, 0);
    return valid.map((item) => ({
      ...item,
      percentage: Number.isFinite(item.percentage) && item.percentage > 0
        ? item.percentage
        : pool > 0 ? Number(((item.amount / pool) * 100).toFixed(4)) : 0,
      label: item.label || `${item.rank}º lugar`,
    }));
  } catch {
    return [];
  }
}

function statusForPeriod(startAt: string, endAt: string, now = new Date()): Championship['status'] {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  const current = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'upcoming';
  if (current < start) return 'upcoming';
  if (current <= end) return 'active';
  return 'in_review';
}

function durationDays(startAt: string, endAt: string): number {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 30;
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}

function digestPublishedConfig(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function championshipEditionId(championshipId: string, publishedConfigDigest: string): string {
  const safeChampionshipId = String(championshipId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const digest = String(publishedConfigDigest || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  return `${safeChampionshipId}_${digest.slice(0, 24)}`;
}

function buildChampionship(
  id: keyof typeof PAID_CHAMPIONSHIP_OFFERS,
  envPrefix: 'CHAMPIONSHIP_STRENGTH' | 'CHAMPIONSHIP_CARDIO',
): Championship {
  const offer = PAID_CHAMPIONSHIP_OFFERS[id];
  const edition = env(`${envPrefix}_EDITION`) || 'Edição de lançamento';
  const startAt = env(`${envPrefix}_START_AT`);
  const endAt = env(`${envPrefix}_END_AT`);
  const settlementAt = env(`${envPrefix}_SETTLEMENT_AT`);
  const registrationOpensAt = env(`${envPrefix}_REGISTRATION_OPENS_AT`);
  const registrationClosesAt = env(`${envPrefix}_REGISTRATION_CLOSES_AT`);
  const prizes = parsePrizeDistribution(`${envPrefix}_PRIZES_JSON`);
  const prizePool = Math.round(prizes.reduce((sum, prize) => sum + prize.amount, 0) * 100) / 100;
  const allowedCardioTypes = env('CHAMPIONSHIP_CARDIO_ALLOWED_TYPES')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .sort();
  const antiFraudProfile = {
    minDurationMinutes: 20,
    maxDurationMinutes: 90,
    requireGeofence: offer.modality === 'musculacao',
    requireContinuousGPS: offer.modality === 'cardio',
    maxRiskScore: 35,
    ...(offer.modality === 'cardio' ? { allowedCardioTypes } : {}),
  };

  const publishedConfigDigest = digestPublishedConfig({
    id: offer.id,
    edition,
    startAt,
    endAt,
    settlementAt,
    registrationOpensAt,
    registrationClosesAt,
    registrationPrice: offer.entryPrice,
    prizes,
    antiFraudProfile,
  });
  const editionId = championshipEditionId(offer.id, publishedConfigDigest);

  return {
    id: offer.id,
    editionId,
    type: offer.modality === 'cardio' ? 'run_elite_corrida' : 'arena_musculacao',
    title: offer.title,
    edition,
    subtitle: offer.modality === 'cardio' ? 'Desempenho real no cardio' : 'Desempenho real na musculação',
    description: offer.performanceDescription,
    categoryLabel: offer.modality === 'cardio' ? 'CARDIO' : 'MUSCULAÇÃO',
    accentColor: offer.modality === 'cardio' ? 'teal' : 'gold',
    durationDays: durationDays(startAt, endAt),
    startAt,
    endAt,
    settlementAt,
    publishedConfigDigest,
    registrationPrice: offer.entryPrice,
    registrationOpensAt,
    registrationClosesAt,
    participantCount: 0,
    grossRevenue: 0,
    netEligibleRevenue: 0,
    prizePool,
    prizeDistribution: prizes,
    status: statusForPeriod(startAt, endAt),
    regulationVersion: offer.regulationVersion,
    regulationHash: `${offer.regulationHash}-${publishedConfigDigest.slice(0, 16)}`,
    antiFraudProfile,
  };
}

export const CHAMPIONSHIPS: Championship[] = [
  buildChampionship('invictus_strength_v1', 'CHAMPIONSHIP_STRENGTH'),
  buildChampionship('invictus_cardio_v1', 'CHAMPIONSHIP_CARDIO'),
];

function registrationReadiness(championship: Championship, now = new Date()): { open: boolean; reason: string } {
  if (env('PAID_CHAMPIONSHIP_REGISTRATION_ENABLED').toLowerCase() !== 'true') {
    return { open: false, reason: 'A edição ainda não foi liberada para inscrições.' };
  }
  if (!PAID_CHAMPIONSHIP_SETTLEMENT_IMPLEMENTED) {
    return { open: false, reason: 'A homologação e entrega da premiação ainda não foram liberadas.' };
  }
  const registrationStart = Date.parse(championship.registrationOpensAt || '');
  const registrationEnd = Date.parse(championship.registrationClosesAt || '');
  const competitionStart = Date.parse(championship.startAt);
  const competitionEnd = Date.parse(championship.endAt);
  const settlementAt = Date.parse(championship.settlementAt || '');
  if (![registrationStart, registrationEnd, competitionStart, competitionEnd, settlementAt].every(Number.isFinite)) {
    return { open: false, reason: 'O calendário oficial e a data de homologação ainda não foram publicados.' };
  }
  if (registrationEnd <= registrationStart || competitionEnd <= competitionStart || registrationEnd > competitionEnd || settlementAt <= competitionEnd) {
    return { open: false, reason: 'O calendário da edição precisa ser revisado.' };
  }
  if (!championship.prizeDistribution.length || championship.prizePool <= 0) {
    return { open: false, reason: 'A premiação oficial ainda não foi publicada ou possui posições inválidas.' };
  }
  if (!championship.publishedConfigDigest || !championship.editionId || championship.regulationHash.length < 20) {
    return { open: false, reason: 'A configuração publicada da edição ainda não foi congelada.' };
  }
  if (championship.type === 'run_elite_corrida' && !(championship.antiFraudProfile.allowedCardioTypes || []).length) {
    return { open: false, reason: 'As modalidades de cardio elegíveis ainda não foram publicadas.' };
  }
  const current = now.getTime();
  if (current < registrationStart) return { open: false, reason: 'As inscrições ainda não abriram.' };
  if (current > registrationEnd) return { open: false, reason: 'As inscrições desta edição estão encerradas.' };
  return { open: true, reason: '' };
}

export function listChampionships(now = new Date()): Championship[] {
  return CHAMPIONSHIPS.map((championship) => {
    const readiness = registrationReadiness(championship, now);
    return {
      ...championship,
      status: statusForPeriod(championship.startAt, championship.endAt, now),
      registrationOpen: readiness.open,
      registrationReadinessReason: readiness.reason,
    };
  });
}

export function getChampionship(id: string): Championship | undefined {
  const championship = CHAMPIONSHIPS.find((candidate) => candidate.id === id);
  if (!championship) return undefined;
  const readiness = registrationReadiness(championship);
  return {
    ...championship,
    status: statusForPeriod(championship.startAt, championship.endAt),
    registrationOpen: readiness.open,
    registrationReadinessReason: readiness.reason,
  };
}

export function isRegistrationOpen(championship: Championship, now: Date = new Date()): boolean {
  return registrationReadiness(championship, now).open;
}

export function matchActiveChampionshipsForActivity(params: {
  activityType: string;
  cardioType?: string;
  isIndoorCardio?: boolean;
  when: Date;
}): Championship[] {
  const activityType = String(params.activityType || '').trim().toLowerCase();
  const cardioType = String(params.cardioType || '').trim().toLowerCase();
  const whenMs = params.when.getTime();
  if (!Number.isFinite(whenMs)) return [];

  return CHAMPIONSHIPS.filter((championship) => {
    const startMs = Date.parse(championship.startAt);
    const endMs = Date.parse(championship.endAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || whenMs < startMs || whenMs > endMs) return false;

    const expectsCardio = championship.type === 'run_elite_corrida';
    if (expectsCardio !== (activityType === 'cardio')) return false;

    if (expectsCardio) {
      const allowed = (championship.antiFraudProfile?.allowedCardioTypes || [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
      if (allowed.length === 0 || !cardioType || !allowed.includes(cardioType)) return false;
    }

    return true;
  });
}
