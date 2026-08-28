export type League = 'Liga Alpha' | 'Liga Beta' | 'Liga Delta';
export type BodySelfAssessment = 'acima_do_peso' | 'normal' | 'definido' | 'maromba';
export type TrainingObjective = 'emagrecer' | 'ganhar_massa' | 'definir';
export type WorkoutFrequency = '0-2' | '3-4' | '5+';
export type Sex = 'male' | 'female';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlockedAt?: string;
  criteria: string;
  category: 'frequency' | 'ranking' | 'performance' | 'evolution' | 'referral' | 'social';
  points: number;
}

export interface RedemptionRequest {
  id: string;
  userId: string;
  amount: number;
  pixKey: string;
  pixKeyType: 'cpf' | 'email' | 'phone' | 'random';
  status: 'pending' | 'completed' | 'rejected';
  createdAt: string;
  processedAt?: string;
  reason?: string;
}

export interface PaymentTransaction {
  id: string;
  userId: string;
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  method: 'pix' | 'card';
  type: 'subscription' | 'one_time';
  createdAt: string;
}

export interface MealPlanEntry {
  id: string;
  name: string;
  time: string; // HH:mm
  toleranceMins: number;
  type: 'principal' | 'normal' | 'lanche';
}

export interface MealPlan {
  meals: MealPlanEntry[];
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  name?: string;
  email: string;
  photoURL?: string;
  city: string;
  state: string;
  score: number;
  xp: number;
  level: number;
  totalXp?: number;
  weeklyScore: number;
  monthlyScore: number;
  lastWeeklyResetAt?: string;
  lastMonthlyResetAt?: string;
  streak: number;
  lastCheckIn?: string;
  league: League;
  maxHeartRate?: number;
  igaAudit?: any;
  
  // New classification fields
  height: number; // in cm
  weight: number; // in kg
  age: number;
  birthDate: string; // ISO date string
  cpf: string;
  phone: string;
  sex: Sex;
  weeklyFrequency: WorkoutFrequency;
  objective: TrainingObjective;
  bodySelfAssessment: BodySelfAssessment;
  dietaryRestrictions?: string[];
  dietaryPreference?: string;
  imc: number;
  
  // AI Assistant Customization
  aiName?: string;
  aiPersonality?: 'motivadora' | 'tecnica' | 'direta' | 'zen';

  // Diet generation fields
  dailyCalories?: number;
  macros?: {
    protein: number;
    carbs: number;
    fats: number;
  };
  generatedDiet?: Diet;
  mealPlan?: MealPlan;

  positions: {
    gym: number;
    city: number;
    national: number;
    league: number;
    global: number;
    region: number;
  };
  country: string;
  appCredits: number;
  ivCoins?: number;
  coins?: number;
  temporaryPremiumUntil?: string;
  badges: string[];
  whatsappEnabled: boolean;
  phoneNumber?: string;
  termsAccepted: boolean;
  termsAcceptedAt?: string;
  termsVersionAccepted?: number;
  seenTreinoInfo?: boolean;
  seenCardioInfo?: boolean;
  seenDietaInfo?: boolean;
  seenCorridaInfo?: boolean;
  isSubscribed: boolean;
  status?: string;
  subscriptionTier?: 'open' | 'performance' | 'Nenhum';
  currentPlan?: 'open' | 'performance' | 'Nenhum';
  subscriptionStatus?: 'pending_payment' | 'active_basic' | 'active_premium' | 'inactive';
  plano?: string;
  assinatura?: string;
  statusPagamento?: string;
  premium?: boolean;
  performance?: boolean;
  paymentStatus?: string;
  customerId?: string;
  subscriptionId?: string;
  orderId?: string;
  chargeId?: string;
  activatedAt?: string;
  nextBillingDate?: string;
  expiresAt?: string;
  researchConsent?: boolean;
  // Vem da INSCRICAO da temporada (season_inscriptions), nunca da assinatura.
  // Assinar o Pro nao coloca ninguem na disputa, e cancelar o Pro nao tira
  // quem ja pagou a inscricao daquela temporada.
  seasonStatus?: 'ACTIVE' | 'WAITING_NEXT_SEASON' | 'NOT_ENROLLED';
  seasonInscritaId?: string;
  nextSeasonStart?: string;
  subscriptionExpiresAt?: string;
  walletBalance: number;
  isBlocked: boolean;
  isBanned?: boolean;
  isBot?: boolean;
  infractions: number;
  profileLikes: string[]; // Array of UIDs who liked this athlete
  totalActiveDays: number;
  totalWorkouts: number;
  totalTimeSpent?: number; // Total minutes for tie-breaking
  achievements: string[]; // IDs of unlocked achievements
  gymId?: string;
  gymName?: string;
  gymLocation?: { lat: number; lng: number };
  firstScoreAt?: string;
  referralCode: string;
  referredBy?: string;
  referralStats: {
    totalReferrals: number;
    validReferrals: number;
    bonusBalance: number;
    referralPoints: number;
    monthlyValidReferrals?: { [monthKey: string]: number };
  };
  referralMilestones: string[];
  deviceFingerprint?: string;
  fcmTokens?: string[]; // Push notification device tokens (FCM)
  
  // Strava integration
  strava_connected?: boolean;
  strava_athlete_id?: string;
  strava_access_token?: string;
  strava_refresh_token?: string;
  strava_token_expires_at?: number; // timestamp
  last_strava_sync?: string;
  
  // Social fields
  username?: string;
  displayNameLower?: string;
  searchKeywords?: string[];
  bio?: string;
  followersCount: number;
  seasonStartedAt?: string;
  lastSeasonResetAt?: string;
  followingCount: number;
  postsCount: number;
  
  // Season & Competition fields
  seasonBoost: number; // Multiplier or flat bonus for late entries
  seasonEntryStatus: 'early' | 'late' | 'next_season';
  seasonEntryDay: number;
  activeSeason?: string; // Identifier for the official season launch and reset
  pixKey?: string;
  pixKeyType?: 'cpf' | 'email' | 'phone' | 'random';
  wonLastSeason?: boolean;
  notifications?: {
    id: string;
    title: string;
    message: string;
    type: 'ranking' | 'payment' | 'system' | 'achievement' | 'social';
    read: boolean;
    createdAt: string;
    actionUrl?: string;
  }[];
  
  role: 'user' | 'admin';
  createdAt: string;
}

export interface Post {
  id: string;
  userId: string;
  userDisplayName: string;
  userPhotoURL?: string;
  imageUrl: string;
  caption: string;
  likesCount: number;
  likedBy: string[]; // Array of UIDs
  commentsCount?: number;
  sharesCount?: number;
  createdAt: string;
  points?: number;
  streak?: number;
}

export interface Story {
  id: string;
  userId: string;
  userDisplayName: string;
  userPhotoURL?: string;
  imageUrl: string;
  createdAt: string;
  expiresAt: string;
  viewedBy: string[];
}

export interface Follow {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: string;
}

export interface SocialNotification {
  id: string;
  recipientId: string;
  senderId: string;
  senderName: string;
  senderPhotoURL?: string;
  type: 'like' | 'follow' | 'achievement' | 'comment';
  postId?: string;
  commentId?: string;
  achievementId?: string;
  message?: string;
  read: boolean;
  createdAt: string;
}

export interface ValidationResult {
  status: 'valid' | 'invalid' | 'suspicious';
  reason?: string;
  score: number; // 0 to 100
  details?: {
    locationMatch?: boolean;
    nearbyGyms?: string[];
    aiAnalysis?: string;
    movementPattern?: 'walking' | 'running' | 'stationary' | 'vehicle' | 'unknown';
    distanceKm?: number;
    durationMins?: number;
  };
}

export interface ActivitySession {
  id: string;
  userId: string;
  type: 'workout' | 'cardio' | 'diet';
  cardioType?: string;
  cardioTypeLabel?: string;
  muscleGroup?: string;
  isIndoorCardio?: boolean;
  requiresGpsDistance?: boolean;
  smartwatchData?: any;
  healthTelemetry?: {
    avgHeartRate?: number;
    maxHeartRate?: number;
    steps?: number;
    calories?: number;
    source?: 'apple_health' | 'health_connect' | 'wearable' | 'none';
  };
  metricSources?: {
    heartRate?: string;
    steps?: string;
    distance?: string;
    calories?: string;
    motion?: string;
  };
  startTime: string;
  startLocation?: { lat: number; lng: number; accuracy?: number };
  nearbyGymsAtStart?: string[];
  status: 'active' | 'completed' | 'cancelled';
  hasExercises?: boolean;
  checkInId?: string;
  checkpoints: {
    timestamp: string;
    location: { lat: number; lng: number; accuracy?: number };
  }[];
  // #324: pausa real da sessao ativa (semaforo, cadarco, banheiro). O fluxo em
  // producao (Challenges.tsx/ChallengeActivityFlow.tsx) nao tinha pausa --
  // so o componente RunTracker.tsx, que ficou orfao, tinha essa logica. Sem
  // isso o cronometro/GPS de duracao corriam mesmo parado, prejudicando o
  // pace/pontuacao de quem precisava interromper por um instante.
  isPaused?: boolean;
  /** Soma de todos os intervalos de pausa ja fechados, em milissegundos. */
  pausedMs?: number;
  /** Timestamp ISO de quando a pausa atual comecou; null quando nao pausado. */
  pauseStartedAt?: string | null;
  // #98: velocidade instantanea real do chip de GPS (position.coords.speed,
  // derivada do desvio Doppler do sinal -- o mesmo dado que Strava/Garmin usam
  // para o pace ao vivo), amostrada em TODO fix de GPS recebido durante a
  // sessao, nao so nos que viram checkpoint gravado (throttlados a ~1 a cada
  // poucos segundos). Corrige a diluicao de velocidade: um pico real de
  // 60-70km/h (ex: dentro de um onibus) podia ficar mascarado ao calcular
  // velocidade so pela distancia/tempo entre dois checkpoints espaçados,
  // que suaviza picos curtos para uma media bem mais baixa.
  maxObservedSpeedKmH?: number;
  /** Quantas amostras de velocidade instantanea validas alimentaram maxObservedSpeedKmH (0 = sem GPS com campo speed disponivel neste dispositivo/navegador). */
  gpsSpeedSampleCount?: number;
}

export interface Workout {
  id: string;
  userId: string;
  photoUrl?: string;
  timestamp: string;
  muscleGroup?: string;
  cardioType?: string;
  cardioTypeLabel?: string;
  isIndoorCardio?: boolean;
  requiresGpsDistance?: boolean;
  smartwatchData?: any;
  healthTelemetry?: {
    avgHeartRate?: number;
    maxHeartRate?: number;
    steps?: number;
    calories?: number;
    source?: 'apple_health' | 'health_connect' | 'wearable' | 'none';
  };
  metricSources?: {
    heartRate?: string;
    steps?: string;
    distance?: string;
    calories?: string;
    motion?: string;
  };
  location?: {
    lat: number;
    lng: number;
    accuracy?: number;
  };
  status: 'valid' | 'invalid' | 'pending' | 'suspicious';
  type: 'workout' | 'cardio' | 'diet' | 'recovery';
  imageHash?: string;
  duration?: number; // in minutes
  distance?: number; // in km
  calories?: number;
  points?: number;
  rankingPointsEarned?: number;
  gymId?: string;
  
  // Anti-fraud and Validation fields
  validation?: ValidationResult;
  integrityScore?: number;
  riskScore?: number;
  validationStatus?: string;
  sessionId?: string;
  isMockLocation?: boolean;
  deviceInfo?: string;
  verificationPhotoUrl?: string;
}

export interface Meal {
  name: string;
  description: string;
  time?: string;
}

export interface Diet {
  id: string;
  userId: string;
  name: string;
  meals: Meal[];
  observations?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RankingEntry {
  uid: string;
  displayName: string;
  photoURL?: string;
  score: number;
  streak: number;
  rank: number;
  referralCount?: number;
  isSubscribed: boolean;
  isBot?: boolean;
  seasonBoost?: number;
  entryStatus?: 'early' | 'late';
  city?: string;
  gymId?: string;
  positions?: {
    gym?: number;
    city?: number;
    national?: number;
    league?: number;
  };
}

export interface Referral {
  id: string;
  referrerUid: string;
  refereeUid: string;
  refereeName: string;
  status: 'pending' | 'valid' | 'invalid' | 'fraud';
  createdAt: string;
  validatedAt?: string;
  reason?: string;
}

export interface RankingSnapshot {
  id: string;
  level: 'league' | 'referral';
  levelId: string;
  topUsers: RankingEntry[];
  updatedAt: string;
}

export interface Gym {
  id: string;
  name: string;
  place_id: string; // Google Place ID
  latitude: number;
  longitude: number;
  photo_url?: string;
  address?: string;
  rating?: number;
  createdAt: string;
}

export interface GymRankingEntry {
  userId: string;
  displayName: string;
  photoURL?: string;
  score: number;
  streak: number;
  lastUpdate: string;
}

export interface RunningStats {
  userId: string;
  best_run_km_month: number;
  best_run_km_week: number;
  last_run_date: string;
  is_paid_running: boolean;
  totalPool?: number;
}

export interface RunningRankingEntry {
  userId: string;
  displayName: string;
  photoURL: string | null;
  km: number;
  is_paid_running: boolean;
}

export interface Activity {
  id: string; // Internal ID or hash
  activity_id: string; // Source ID (e.g., Strava ID)
  user_id: string;
  source: 'strava' | 'manual' | 'gps';
  activity_type: string; // 'Run'
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number;
  average_speed: number;
  max_speed: number;
  elevation_gain: number;
  gps_polyline?: string;
  start_date: string;
  timezone: string;
  validated: boolean;
  fraud_score: number; // 0-100
  challenge_id?: string;
  created_at: string;
}

export interface UserEntitlement {
  userId: string;
  planId: string;
  status: 'active' | 'suspended' | 'expired';
  sourceOrderId: string;
  startsAt: string;
  endsAt: string;
  expiresAt?: string;
  purchasedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SeasonRegistration {
  id?: string;
  userId: string;
  seasonId: string;
  seasonStart: string;
  seasonEnd: string;
  registrationDate: string;
  status: 'WAITING' | 'ACTIVE' | 'FINISHED' | 'CANCELLED';
}

export interface SeasonSettings {
  seasonAStartDay: number;
  seasonBStartDay: number;
}

// ==========================================
// INVICTUS FINANCIAL & REWARDS ARCHITECTURE
// ==========================================

export type IVCoinCategory = 'redeemable' | 'ecosystem' | 'promotional';

export type IVCoinTransactionOrigin = 
  | 'workout' 
  | 'cardio' 
  | 'streak' 
  | 'mission' 
  | 'league' 
  | 'championship' 
  | 'sponsor' 
  | 'referral' 
  | 'achievement' 
  | 'badge' 
  | 'store_purchase' 
  | 'conversion' 
  | 'campaign' 
  | 'admin_adjustment'
  | 'withdrawal_hold'
  | 'withdrawal_refund';

export interface IVCoinTransaction {
  id: string;
  userId: string;
  amount: number;
  category: IVCoinCategory;
  type: 'credit' | 'debit';
  origin: IVCoinTransactionOrigin;
  destination: string;
  description: string;
  createdAt: string;
}

export interface UserWallet {
  userId: string;
  totalBalance: number; // redeemableBalance + ecosystemBalance + promotionalBalance
  redeemableBalance: number; // Saldo em R$ disponível para saque via PIX
  ecosystemBalance: number; // Saldo em R$ de prêmios (loja, benefícios) - não sacável
  promotionalBalance: number; // Saldo em R$ de bônus promocionais
  blockedBalance: number; // Saldo em R$ retido durante análise de saque
  updatedAt: string;
}

export interface WithdrawalConfig {
  minWithdrawalAmount: number; // Valor mínimo de saque em R$ (Reais). Default: 20
  maxDailyWithdrawalAmount: number; // Valor máximo de saque por dia em R$ (Reais). Default: 1000
  enabled: boolean;
  updatedAt: string;
}

export type WithdrawalStatus = 'pending' | 'under_review' | 'approved' | 'processing' | 'paid' | 'cancelled' | 'rejected';

export interface PIXWithdrawal {
  id: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  amount: number; // Valor do saque em R$ (Reais)
  pixKey: string;
  pixKeyType: 'cpf' | 'email' | 'phone' | 'random';
  status: WithdrawalStatus;
  antiFraudScore: number;
  antiFraudPassed: boolean;
  antiFraudFlags: string[];
  antiFraudDetails?: any;
  createdAt: string;
  updatedAt: string;
  processedAt?: string;
  adminNote?: string;
}

export type LeagueTier = 'bronze' | 'prata' | 'ouro' | 'diamante' | 'mestre' | 'lendario';

export interface LeaguePool {
  leagueId: LeagueTier;
  name: string;
  monthlyPrizeCoins: number;
  weeklyPrizeCoins: number;
  sponsors: string[];
  active: boolean;
}

export interface Mission {
  id: string;
  title: string;
  description: string;
  category: 'daily' | 'weekly' | 'monthly' | 'special';
  type: 'workout_count' | 'cardio_minutes' | 'streak_days' | 'total_days' | 'gym_checkins';
  target: number;
  rewardCoins: number;
  rewardCategory: IVCoinCategory;
  rewardXP: number;
  rewardBadge?: string;
  isFreeAccess: boolean; // Available to Free plan users
  active: boolean;
}

export interface UserMissionProgress {
  id: string;
  userId: string;
  missionId: string;
  currentProgress: number;
  target: number;
  completed: boolean;
  claimed: boolean;
  updatedAt: string;
}

export interface SponsorChallenge {
  id: string;
  sponsorName: string;
  sponsorLogoUrl: string;
  title: string;
  description: string;
  bannerUrl: string;
  startDate: string;
  endDate: string;
  totalPrizeCoins: number;
  winnersCount: number;
  criteria: string;
  active: boolean;
  participantsCount?: number;
}

export interface StoreItem {
  id: string;
  name: string;
  description: string;
  category: 'avatar' | 'frame' | 'theme' | 'benefit' | 'event' | 'ai_premium' | 'ticket' | 'digital';
  iconUrl?: string;
  priceCoins: number;
  priceCategory: IVCoinCategory | 'any';
  stock?: number;
  active: boolean;
}

export interface UserInventoryItem {
  id: string;
  userId: string;
  itemId: string;
  itemName: string;
  itemCategory: string;
  purchasedAt: string;
}

