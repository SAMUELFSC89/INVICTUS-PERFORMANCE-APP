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

export type PowerLiftScoredSet = PowerLiftSetInput & {
  countedReps: number;
  eligible: boolean;
  volume: number;
};

export const POWER_LIFT_MAX_SETS = 3;
export const POWER_LIFT_MAX_COUNTED_REPS = 10;
export const POWER_LIFT_MIN_SET_LOAD_RATIO = 0.70;
export const POWER_LIFT_SEASON_DAYS = 30;
export const POWER_LIFT_DIAMOND_SCORE = 1000;
export const POWER_LIFT_DEFENDING_MODALITY_MULTIPLIER = 0.97;
export const POWER_LIFT_DEFENDING_MASTER_MULTIPLIER = 0.95;

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

const COMPETITIVE_TIERS = POWER_LIFT_TIER_ORDER.slice(1) as Exclude<PowerLiftTier, 'UNRANKED'>[];

type TierThresholds = Record<Exclude<PowerLiftTier, 'UNRANKED'>, number>;

/**
 * Tabela inicial aprovada para o lançamento. Os valores são Power Volume (kg)
 * da melhor marca oficial do dia, não carga de 1RM. A progressão continua
 * limitada a no máximo uma categoria conquistada por modalidade/dia.
 */
export const POWER_LIFT_TIER_THRESHOLDS: Readonly<Record<PowerLiftSex, Record<PowerLiftExercise, TierThresholds>>> = {
  male: {
    supino: { FERRO: 500, BRONZE: 800, PRATA: 1100, OURO: 1400, PLATINA: 1750, DIAMANTE: 2100 },
    agachamento: { FERRO: 750, BRONZE: 1200, PRATA: 1650, OURO: 2100, PLATINA: 2600, DIAMANTE: 3100 },
    terra: { FERRO: 850, BRONZE: 1350, PRATA: 1850, OURO: 2300, PLATINA: 2850, DIAMANTE: 3400 },
  },
  female: {
    supino: { FERRO: 250, BRONZE: 400, PRATA: 550, OURO: 700, PLATINA: 850, DIAMANTE: 1000 },
    agachamento: { FERRO: 450, BRONZE: 700, PRATA: 950, OURO: 1200, PLATINA: 1500, DIAMANTE: 1800 },
    terra: { FERRO: 550, BRONZE: 800, PRATA: 1100, OURO: 1400, PLATINA: 1700, DIAMANTE: 2000 },
  },
};

type RepBand = { minWeight: number; maxReps: number };

/**
 * Teto dinâmico aprovado: cargas comuns continuam limitadas a 5 reps, mas
 * séries realmente excepcionais podem contabilizar 6, 8 ou até 10 reps.
 * As faixas são avaliadas série a série.
 */
const POWER_LIFT_REP_BANDS: Readonly<Record<PowerLiftSex, Record<PowerLiftExercise, readonly RepBand[]>>> = {
  male: {
    supino: [
      { minWeight: 200, maxReps: 10 },
      { minWeight: 150, maxReps: 8 },
      { minWeight: 120, maxReps: 6 },
      { minWeight: 0, maxReps: 5 },
    ],
    agachamento: [
      { minWeight: 250, maxReps: 10 },
      { minWeight: 200, maxReps: 8 },
      { minWeight: 160, maxReps: 6 },
      { minWeight: 0, maxReps: 5 },
    ],
    terra: [
      { minWeight: 280, maxReps: 10 },
      { minWeight: 220, maxReps: 8 },
      { minWeight: 180, maxReps: 6 },
      { minWeight: 0, maxReps: 5 },
    ],
  },
  female: {
    supino: [
      { minWeight: 100, maxReps: 10 },
      { minWeight: 80, maxReps: 8 },
      { minWeight: 60, maxReps: 6 },
      { minWeight: 0, maxReps: 5 },
    ],
    agachamento: [
      { minWeight: 150, maxReps: 10 },
      { minWeight: 120, maxReps: 8 },
      { minWeight: 90, maxReps: 6 },
      { minWeight: 0, maxReps: 5 },
    ],
    terra: [
      { minWeight: 170, maxReps: 10 },
      { minWeight: 130, maxReps: 8 },
      { minWeight: 100, maxReps: 6 },
      { minWeight: 0, maxReps: 5 },
    ],
  },
};

function seasonWindowFromIndex(index: number, now = new Date()): PowerLiftSeasonWindow {
  const safeIndex = Math.max(0, Math.floor(index));
  const startsAtMs = POWER_LIFT_SEASON_EPOCH + safeIndex * SEASON_MS;
  const endsAtMs = startsAtMs + SEASON_MS;
  return {
    id: `powerlift_s${String(safeIndex + 1).padStart(3, '0')}`,
    number: safeIndex + 1,
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
    daysRemaining: Math.max(0, Math.ceil((endsAtMs - now.getTime()) / DAY_MS)),
  };
}

export function resolvePowerLiftSeason(now = new Date()): PowerLiftSeasonWindow {
  const elapsed = Math.max(0, now.getTime() - POWER_LIFT_SEASON_EPOCH);
  return seasonWindowFromIndex(Math.floor(elapsed / SEASON_MS), now);
}

export function resolvePowerLiftSeasonNumber(number: number, now = new Date()): PowerLiftSeasonWindow | null {
  if (!Number.isInteger(number) || number < 1) return null;
  return seasonWindowFromIndex(number - 1, now);
}

export function previousPowerLiftSeason(season: PowerLiftSeasonWindow, now = new Date()): PowerLiftSeasonWindow | null {
  return season.number > 1 ? resolvePowerLiftSeasonNumber(season.number - 1, now) : null;
}

export function maxCountedReps(exercise: PowerLiftExercise, sex: PowerLiftSex, weight: number): number {
  const safeWeight = Number(weight);
  if (!Number.isFinite(safeWeight) || safeWeight <= 0) return 0;
  return POWER_LIFT_REP_BANDS[sex][exercise].find((band) => safeWeight >= band.minWeight)?.maxReps || 5;
}

/**
 * Compatibilidade: sem modalidade/sexo/carga, preserva o teto legado de 5.
 * Todo fluxo novo deve informar os três argumentos para usar o teto dinâmico.
 */
export function countedReps(
  reps: number,
  weight?: number,
  exercise?: PowerLiftExercise,
  sex?: PowerLiftSex,
): number {
  if (!Number.isFinite(reps)) return 0;
  const cap = exercise && sex && Number.isFinite(Number(weight))
    ? maxCountedReps(exercise, sex, Number(weight))
    : 5;
  return Math.max(0, Math.min(cap, Math.floor(reps)));
}

export function heaviestSetWeight(sets: PowerLiftSetInput[]): number {
  return sets
    .slice(0, POWER_LIFT_MAX_SETS)
    .reduce((best, set) => Math.max(best, Number.isFinite(Number(set.weight)) ? Number(set.weight) : 0), 0);
}

export function minimumEligibleSetWeight(sets: PowerLiftSetInput[]): number {
  const heaviest = heaviestSetWeight(sets);
  return heaviest > 0 ? Math.round(heaviest * POWER_LIFT_MIN_SET_LOAD_RATIO * 100) / 100 : 0;
}

export function scoredPowerLiftSets(
  sets: PowerLiftSetInput[],
  exercise?: PowerLiftExercise,
  sex?: PowerLiftSex,
): PowerLiftScoredSet[] {
  const selected = sets.slice(0, POWER_LIFT_MAX_SETS);
  const minimumWeight = minimumEligibleSetWeight(selected);
  return selected.map((set) => {
    const weight = Number(set.weight);
    const reps = Number(set.reps);
    const eligible = Number.isFinite(weight) && weight > 0 && Number.isFinite(reps) && reps > 0 && weight >= minimumWeight;
    const repCount = eligible ? countedReps(reps, weight, exercise, sex) : 0;
    return {
      weight: Number.isFinite(weight) ? weight : 0,
      reps: Number.isFinite(reps) ? Math.floor(reps) : 0,
      countedReps: repCount,
      eligible,
      volume: eligible ? Math.round(weight * repCount * 100) / 100 : 0,
    };
  });
}

export function setPowerVolume(
  set: PowerLiftSetInput,
  exercise?: PowerLiftExercise,
  sex?: PowerLiftSex,
): number {
  const weight = Number(set.weight);
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  return Math.round(weight * countedReps(Number(set.reps), weight, exercise, sex) * 100) / 100;
}

export function calculatePowerVolume(
  sets: PowerLiftSetInput[],
  exercise?: PowerLiftExercise,
  sex?: PowerLiftSex,
): number {
  return Math.round(
    scoredPowerLiftSets(sets, exercise, sex)
      .reduce((sum, set) => sum + set.volume, 0) * 100,
  ) / 100;
}

export function tierThreshold(
  exercise: PowerLiftExercise,
  sex: PowerLiftSex,
  tier: PowerLiftTier,
): number {
  return tier === 'UNRANKED' ? 0 : POWER_LIFT_TIER_THRESHOLDS[sex][exercise][tier];
}

export function diamondThreshold(exercise: PowerLiftExercise, sex: PowerLiftSex): number {
  return tierThreshold(exercise, sex, 'DIAMANTE');
}

export function highestPerformanceTier(
  powerVolume: number,
  exercise: PowerLiftExercise,
  sex: PowerLiftSex,
): PowerLiftTier {
  const volume = Math.max(0, Number(powerVolume) || 0);
  let achieved: PowerLiftTier = 'UNRANKED';
  for (const tier of COMPETITIVE_TIERS) {
    if (volume >= tierThreshold(exercise, sex, tier)) achieved = tier;
  }
  return achieved;
}

export function nextPowerLiftTier(tier: PowerLiftTier): PowerLiftTier | null {
  const index = POWER_LIFT_TIER_ORDER.indexOf(tier);
  if (index < 0 || index >= POWER_LIFT_TIER_ORDER.length - 1) return null;
  return POWER_LIFT_TIER_ORDER[index + 1];
}

/** Uma marca homologada pode avançar no máximo um degrau, mesmo excedendo Diamante. */
export function advancePowerLiftTier(
  currentTier: PowerLiftTier,
  powerVolume: number,
  exercise: PowerLiftExercise,
  sex: PowerLiftSex,
): PowerLiftTier {
  const next = nextPowerLiftTier(currentTier);
  if (!next) return currentTier;
  return powerVolume >= tierThreshold(exercise, sex, next) ? next : currentTier;
}

/** Diamante sempre corresponde a 1.000 pontos. Acima dele não existe teto. */
export function rawPowerLiftScore(powerVolume: number, exercise: PowerLiftExercise, sex: PowerLiftSex): number {
  const volume = Math.max(0, Number(powerVolume) || 0);
  const reference = diamondThreshold(exercise, sex);
  if (!reference) return 0;
  return Math.round((volume / reference) * POWER_LIFT_DIAMOND_SCORE * 100) / 100;
}

export function modalityCompetitiveScore(rawScore: number, defendingChampion = false): number {
  const multiplier = defendingChampion ? POWER_LIFT_DEFENDING_MODALITY_MULTIPLIER : 1;
  return Math.round(Math.max(0, Number(rawScore) || 0) * multiplier * 100) / 100;
}

/** No Geral, o handicap Master substitui qualquer handicap de modalidade; não acumula. */
export function generalCompetitiveScore(rawGeneralScore: number, defendingMaster = false): number {
  const multiplier = defendingMaster ? POWER_LIFT_DEFENDING_MASTER_MULTIPLIER : 1;
  return Math.round(Math.max(0, Number(rawGeneralScore) || 0) * multiplier * 100) / 100;
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
