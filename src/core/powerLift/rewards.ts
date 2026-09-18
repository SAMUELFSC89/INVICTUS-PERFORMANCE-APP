import type { PowerLiftExercise, PowerLiftSex, PowerLiftTier } from './season';

export type PowerLiftPodiumRank = 1 | 2 | 3;

export const POWER_LIFT_REWARD_VERSION = 1;

/**
 * Recompensas sazonais do Power Lift em Invictus Coins.
 *
 * Princípios:
 * - cada categoria paga uma única vez por modalidade e temporada;
 * - masculino e feminino usam os mesmos valores de Coins;
 * - pódio de cada modalidade é liquidado somente após o fechamento da temporada;
 * - prêmio Master é exclusivo do #1 do Ranking Geral de cada categoria sexual;
 * - Triplo Diamante não cria bônus separado: ele desbloqueia o Ranking Geral.
 *
 * Estes valores foram calibrados contra a economia atual: missões semanais giram
 * em torno de 40–100 Coins, missões mensais em 100–400 Coins e o campeonato da
 * academia usa 2.500 / 1.500 / 1.000 Coins no pódio.
 */
export const POWER_LIFT_TIER_REWARDS: Readonly<Record<Exclude<PowerLiftTier, 'UNRANKED'>, number>> = {
  FERRO: 20,
  BRONZE: 40,
  PRATA: 60,
  OURO: 100,
  PLATINA: 150,
  DIAMANTE: 300,
};

export const POWER_LIFT_MODALITY_PODIUM_REWARDS: Readonly<Record<PowerLiftPodiumRank, number>> = {
  1: 1000,
  2: 600,
  3: 400,
};

export const POWER_LIFT_MASTER_REWARD = 4000;

export const POWER_LIFT_REWARD_SEXES: readonly PowerLiftSex[] = ['male', 'female'];
export const POWER_LIFT_REWARD_EXERCISES: readonly PowerLiftExercise[] = ['supino', 'agachamento', 'terra'];

export function tierRewardCoins(tier: PowerLiftTier): number {
  return tier === 'UNRANKED' ? 0 : POWER_LIFT_TIER_REWARDS[tier];
}

export function modalityPodiumRewardCoins(rank: number): number {
  return rank === 1 || rank === 2 || rank === 3
    ? POWER_LIFT_MODALITY_PODIUM_REWARDS[rank]
    : 0;
}

export function totalTierRewardPerModality(): number {
  return Object.values(POWER_LIFT_TIER_REWARDS).reduce((sum, amount) => sum + amount, 0);
}

export function totalTierRewardForTripleDiamond(): number {
  return totalTierRewardPerModality() * POWER_LIFT_REWARD_EXERCISES.length;
}

/** Valor fixo distribuído aos pódios + Master de uma categoria sexual por temporada. */
export function fixedCompetitiveRewardPerSex(): number {
  const oneModalityPodium = Object.values(POWER_LIFT_MODALITY_PODIUM_REWARDS)
    .reduce((sum, amount) => sum + amount, 0);
  return oneModalityPodium * POWER_LIFT_REWARD_EXERCISES.length + POWER_LIFT_MASTER_REWARD;
}

export function powerLiftTierRewardKey(params: {
  seasonId: string;
  userId: string;
  exercise: PowerLiftExercise;
  tier: Exclude<PowerLiftTier, 'UNRANKED'>;
}): string {
  return `powerlift:tier:v${POWER_LIFT_REWARD_VERSION}:${params.seasonId}:${params.userId}:${params.exercise}:${params.tier}`;
}

export function powerLiftPodiumRewardKey(params: {
  seasonId: string;
  sex: PowerLiftSex;
  userId: string;
  exercise: PowerLiftExercise;
  rank: PowerLiftPodiumRank;
}): string {
  return `powerlift:podium:v${POWER_LIFT_REWARD_VERSION}:${params.seasonId}:${params.sex}:${params.exercise}:${params.rank}:${params.userId}`;
}

export function powerLiftMasterRewardKey(params: {
  seasonId: string;
  sex: PowerLiftSex;
  userId: string;
}): string {
  return `powerlift:master:v${POWER_LIFT_REWARD_VERSION}:${params.seasonId}:${params.sex}:${params.userId}`;
}
