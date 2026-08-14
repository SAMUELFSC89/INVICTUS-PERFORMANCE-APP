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

// Premiacao da Liga Invictus: pote da temporada calculado como % da receita
// bruta arrecadada no periodo (assinaturas Plano Performance aprovadas),
// em vez de um valor fixo por participante. Ver api/_lib/season-prize-engine.ts.
export const SEASON_PRIZE_POOL_PERCENT = 0.20; // 20% da receita bruta vai pro pote distribuido aos vencedores
export const SEASON_FUTURE_RESERVE_PERCENT = 0.05; // 5% da receita bruta fica reservado (pagamentos semanais/outras ideias futuras, ainda nao distribuido)
export const SEASON_MIN_PARTICIPANTS_FOR_PRIZE = 50; // abaixo disso, nenhuma premiacao e distribuida na temporada
export const SEASON_TOP5_PARTICIPANTS_THRESHOLD = 150; // >= 150 participantes: top 5 vencedores; 50-149: top 3 vencedores

export interface RewardTier {
  participants: number;
  prizePool: number;
}

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

