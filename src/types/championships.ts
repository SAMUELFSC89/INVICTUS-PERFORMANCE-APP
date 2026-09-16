export type ChampionshipType = 'arena_musculacao' | 'run_elite_corrida';
export type ChampionshipStatus = 'upcoming' | 'active' | 'in_review' | 'finished';
export type RegistrationStatus = 'PENDING_PAYMENT' | 'ACTIVE' | 'CANCELLED' | 'REFUNDED' | 'REJECTED';
export type PaymentStatus =
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'REFUNDED'
  | 'RECONCILIATION_REQUIRED'
  | 'PAYMENT_PARTIALLY_REFUNDED'
  | 'PAYMENT_REFUND_IN_PROGRESS'
  | 'PAYMENT_CHARGEBACK_REQUESTED'
  | 'PAYMENT_CHARGEBACK_DISPUTE'
  | 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL';
export type ChampionshipSettlementStatus = 'NOT_DUE' | 'PENDING_REVIEW' | 'LOCKED' | 'FINALIZED';

export interface PrizeRank {
  rank: number;
  percentage: number;
  amount: number;
  label: string;
}

export interface Championship {
  /** ID estável da modalidade/produto (ex.: invictus_cardio_v1). */
  id: string;
  /**
   * ID imutável da edição publicada. Muda automaticamente quando calendário,
   * prêmio, modalidade ou outra configuração material muda.
   */
  editionId: string;
  type: ChampionshipType;
  title: string;
  edition: string;
  subtitle: string;
  description: string;
  categoryLabel: string;
  accentColor: 'gold' | 'teal';
  durationDays: number;
  startAt: string;
  endAt: string;
  /** Data/hora publicada a partir da qual o resultado pode ser homologado. */
  settlementAt?: string;
  /**
   * Hash do calendário + premiação + modalidade publicados para a edição.
   * Também compõe o regulationHash efetivo, invalidando aceite antigo se uma
   * dessas regras materiais for alterada antes da abertura.
   */
  publishedConfigDigest?: string;
  registrationPrice: number;
  registrationOpensAt?: string;
  registrationClosesAt?: string;
  registrationOpen?: boolean;
  registrationReadinessReason?: string;
  participantCount: number;
  grossRevenue: number;
  netEligibleRevenue: number;
  prizePool: number;
  prizeDistribution: PrizeRank[];
  status: ChampionshipStatus;
  regulationVersion: string;
  regulationHash: string;
  imageUrl?: string;
  badgeUrl?: string;
  antiFraudProfile: {
    minDurationMinutes?: number;
    maxDurationMinutes?: number;
    requireGeofence?: boolean;
    requireContinuousGPS?: boolean;
    maxRiskScore?: number;
    /**
     * Modalidades de cardio aceitas pela edição, congeladas no regulamento.
     * Ex.: um Camp de corrida pode aceitar apenas `running`; bike legítima
     * continua sendo um cardio válido no app, mas não entra nessa competição.
     */
    allowedCardioTypes?: string[];
  };
}

export interface ChampionshipRegistration {
  id: string;
  championshipId: string;
  editionId: string;
  championshipTitle?: string;
  userId: string;
  userName?: string;
  userPhoto?: string;
  status: RegistrationStatus;
  paymentStatus: PaymentStatus;
  amount: number;
  regulationVersion: string;
  regulationHash: string;
  regulationAcceptedAt: string;
  externalPaymentReference: string;
  asaasPaymentId?: string;
  asaasCheckoutId?: string;
  asaasCheckoutUrl?: string;
  checkoutSurface?: 'ios_native' | 'web';
  paymentMethod?: 'PIX' | 'CREDIT_CARD';
  createdAt: string;
  paidAt?: string;
}

export interface ChampionshipScoreEntry {
  id: string;
  championshipId: string;
  editionId: string;
  userId: string;
  userName: string;
  userPhoto?: string;
  userGymName?: string;
  activityId: string;
  activityType: string;
  score: number;
  validationStatus: 'VALIDATED' | 'REJECTED' | 'PENDING';
  validationMotives?: string[];
  championshipValidation: {
    eligible: boolean;
    riskScore: number;
    evaluatedAt: string;
  };
  metrics: {
    durationMinutes?: number;
    distanceKm?: number;
    avgPace?: string;
    exercisesCount?: number;
  };
  createdAt: string;
}

export interface ChampionshipResult {
  championshipId: string;
  editionId: string;
  championshipTitle: string;
  edition: string;
  finalRank: number;
  totalParticipants: number;
  prizeWon?: number;
  status: 'finalized';
  homologatedAt: string;
  certificateUrl?: string;
}

export interface UserChampionshipProgress {
  championshipId: string;
  editionId: string;
  userId: string;
  currentRank: number;
  totalScore: number;
  validSessionsCount: number;
  totalTimeMinutes: number;
  progressPercentage: number;
  daysRemaining: number;
  settlementStatus: ChampionshipSettlementStatus;
  settlementAt?: string;
  finalResult?: ChampionshipResult | null;
  lastUpdated: string;
}
