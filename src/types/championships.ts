export type ChampionshipType = 'arena_musculacao' | 'run_elite_corrida';
export type ChampionshipStatus = 'upcoming' | 'active' | 'in_review' | 'finished';
export type RegistrationStatus = 'PENDING_PAYMENT' | 'ACTIVE' | 'CANCELLED' | 'REFUNDED' | 'REJECTED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';

export interface PrizeRank {
  rank: number;
  percentage: number;
  amount: number;
  label: string;
}

export interface Championship {
  id: string;
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
  registrationPrice: number;
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
  };
}

export interface ChampionshipRegistration {
  id: string;
  championshipId: string;
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
  paymentMethod?: 'PIX' | 'CREDIT_CARD';
  createdAt: string;
  paidAt?: string;
}

export interface ChampionshipScoreEntry {
  id: string;
  championshipId: string;
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

export interface UserChampionshipProgress {
  championshipId: string;
  userId: string;
  currentRank: number;
  totalScore: number;
  validSessionsCount: number;
  totalTimeMinutes: number;
  progressPercentage: number;
  daysRemaining: number;
  lastUpdated: string;
}

export interface ChampionshipResult {
  championshipId: string;
  championshipTitle: string;
  edition: string;
  finalRank: number;
  totalParticipants: number;
  prizeWon?: number;
  status: 'finalized';
  homologatedAt: string;
  certificateUrl?: string;
}
