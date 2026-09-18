export type PowerLiftExercise = 'supino' | 'agachamento' | 'terra';
export type PowerLiftSex = 'male' | 'female';
export type PowerLiftTier = 'UNRANKED' | 'FERRO' | 'BRONZE' | 'PRATA' | 'OURO' | 'PLATINA' | 'DIAMANTE';

export type PowerLiftSetInput = {
  weight: number;
  reps: number;
};

export type PowerLiftSeasonWindow = {
  id: string;
  number: number;
  startsAt: string;
  endsAt: string;
  daysRemaining: number;
};

export const POWER_LIFT_MAX_SETS = 3;
export const POWER_LIFT_MAX_COUNTED_REPS = 5;
export const POWER_LIFT_SEASON_DAYS = 30;

// Marco inicial da primeira temporada do novo Power Lift. Todas as temporadas
// seguintes são blocos exatos de 30 dias, sem depender do tamanho do mês.
const POWER_LIFT_SEASON_EPOCH = Date.parse('2026-09-18T03:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const SEASON_MS = POWER_LIFT_SEASON_DAYS * DAY_MS;

export const POWER_LIFT_TIER_ORDER: PowerLiftTier[] = [
  'UNRANKED',
  'FERRO',
  'BRONZE',
  'PRATA',
  'OURO',
  'PLATINA',
  'DIAMANTE',
];

export function resolvePowerLiftSeason(now = new Date()): PowerLiftSeasonWindow {
  const elapsed = Math.max(0, now.getTime() - POWER_LIFT_SEASON_EPOCH);
  const index = Math.floor(elapsed / SEASON_MS);
  const startsAtMs = POWER_LIFT_SEASON_EPOCH + index * SEASON_MS;
  const endsAtMs = startsAtMs + SEASON_MS;
  const number = index + 1;
  return {
    id: `powerlift_s${String(number).padStart(3, '0')}`,
    number,
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
    daysRemaining: Math.max(0, Math.ceil((endsAtMs - now.getTime()) / DAY_MS)),
  };
}

export function countedReps(reps: number): number {
  if (!Number.isFinite(reps)) return 0;
  return Math.max(0, Math.min(POWER_LIFT_MAX_COUNTED_REPS, Math.floor(reps)));
}

export function setPowerVolume(set: PowerLiftSetInput): number {
  const weight = Number(set.weight);
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  return Math.round(weight * countedReps(Number(set.reps)) * 100) / 100;
}

export function calculatePowerVolume(sets: PowerLiftSetInput[]): number {
  return Math.round(
    sets
      .slice(0, POWER_LIFT_MAX_SETS)
      .reduce((sum, set) => sum + setPowerVolume(set), 0) * 100,
  ) / 100;
}

export function heaviestSetWeight(sets: PowerLiftSetInput[]): number {
  return sets
    .slice(0, POWER_LIFT_MAX_SETS)
    .reduce((best, set) => Math.max(best, Number.isFinite(Number(set.weight)) ? Number(set.weight) : 0), 0);
}

export function nextPowerLiftTier(tier: PowerLiftTier): PowerLiftTier | null {
  const index = POWER_LIFT_TIER_ORDER.indexOf(tier);
  if (index < 0 || index >= POWER_LIFT_TIER_ORDER.length - 1) return null;
  return POWER_LIFT_TIER_ORDER[index + 1];
}

export function canEnterEliteRanking(tier: PowerLiftTier): boolean {
  return tier === 'DIAMANTE';
}

export function canEnterGeneralRanking(tiers: Record<PowerLiftExercise, PowerLiftTier>): boolean {
  return canEnterEliteRanking(tiers.supino)
    && canEnterEliteRanking(tiers.agachamento)
    && canEnterEliteRanking(tiers.terra);
}

export function powerLiftDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function normalizeCompetitionSex(value: unknown): PowerLiftSex | null {
  return value === 'female' || value === 'male' ? value : null;
}
