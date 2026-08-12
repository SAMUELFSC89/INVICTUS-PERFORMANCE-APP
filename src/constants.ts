export const CITIES = [
  'São Paulo',
  'Rio de Janeiro',
  'Belo Horizonte',
  'Curitiba',
  'Porto Alegre',
  'Brasília',
  'Salvador',
  'Fortaleza',
  'Manaus',
  'Recife',
];

export const STATES = [
  'SP', 'RJ', 'MG', 'PR', 'RS', 'DF', 'BA', 'CE', 'AM', 'PE',
];

export interface RewardTier {
  participants: number;
  prizePool: number;
}

export const REWARD_TIERS: RewardTier[] = [
  { participants: 50, prizePool: 2500 },
  { participants: 75, prizePool: 3750 },
  { participants: 100, prizePool: 5000 },
  { participants: 125, prizePool: 6250 },
  { participants: 150, prizePool: 7500 },
  { participants: 175, prizePool: 8750 },
  { participants: 200, prizePool: 10000 },
  { participants: 225, prizePool: 11250 },
  { participants: 250, prizePool: 12500 },
];

export const TOP_10_PERCENTAGES = [
  0.2286, // 1st: 22.86%
  0.1857, // 2nd: 18.57%
  0.1429, // 3rd: 14.29%
  0.1143, // 4th: 11.43%
  0.0857, // 5th: 8.57%
  0.0714, // 6th: 7.14%
  0.0571, // 7th: 5.71%
  0.0429, // 8th: 4.29%
  0.0429, // 9th: 4.29%
  0.0286, // 10th: 2.86%
];

export const REWARD_RULES = {
  SUBSCRIPTION_PRICE: 49.90,
};

