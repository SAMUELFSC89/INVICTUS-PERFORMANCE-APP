// Regras compartilhadas pelos endpoints e pelo motor de premiação.
export const SEASON_MIN_PARTICIPANTS_FOR_PRIZE = 50;
export const SEASON_TOP5_PARTICIPANTS_THRESHOLD = 150;
export const SEASON_MIN_PARTICIPANTS_PER_GYM = 1;
export const SEASON_TOP5_THRESHOLD_PER_GYM = 150;

export const TOP_10_PERCENTAGES = [
  0.2286,
  0.1857,
  0.1429,
  0.1143,
  0.0857,
  0.0714,
  0.0571,
  0.0429,
  0.0429,
  0.0286,
] as const;
