import { db } from './common.js';
import { RewardCoinEngine } from './reward-coin-engine.js';
import {
  POWER_LIFT_TIER_ORDER,
  advancePowerLiftTier,
  canEnterEliteRanking,
  canEnterGeneralRanking,
  generalCompetitiveScore,
  modalityCompetitiveScore,
  previousPowerLiftSeason,
  rawPowerLiftScore,
  resolvePowerLiftSeason,
  resolvePowerLiftSeasonNumber,
  tierThreshold,
  type PowerLiftExercise,
  type PowerLiftSeasonWindow,
  type PowerLiftSex,
  type PowerLiftTier,
} from '../../src/core/powerLift/season.js';
import {
  POWER_LIFT_MASTER_REWARD,
  POWER_LIFT_MODALITY_PODIUM_REWARDS,
  POWER_LIFT_REWARD_EXERCISES,
  POWER_LIFT_REWARD_SEXES,
  POWER_LIFT_REWARD_VERSION,
  modalityPodiumRewardCoins,
  powerLiftMasterRewardKey,
  powerLiftPodiumRewardKey,
  powerLiftTierRewardKey,
  tierRewardCoins,
} from '../../src/core/powerLift/rewards.js';

const ENTRY_COLLECTION = 'powerlift_season_entries';
const USER_COLLECTION = 'powerlift_season_users';
const RESULT_COLLECTION = 'powerlift_season_results';
const TIER_REWARD_COLLECTION = 'powerlift_tier_rewards';
const COMPETITIVE_REWARD_COLLECTION = 'powerlift_competitive_rewards';
const MAX_SEASON_SCAN = 5000;
const MAX_PENDING_REWARD_SWEEP = 250;

export type PowerLiftSeasonEntry = {
  id: string;
  seasonId: string;
  seasonNumber: number;
  userId: string;
  userName: string;
  userPhoto: string;
  competitionSex: PowerLiftSex;
  exercise: PowerLiftExercise;
  tier: PowerLiftTier;
  bestVolume: number;
  bestWeight: number;
  bestRecordId: string | null;
  bestAchievedAt: string | null;
  rawScore: number;
  competitiveScore: number;
  defendingChampion: boolean;
  defenseMultiplier: number;
  eliteOptIn: boolean;
  validMarks: number;
  lastApprovedRecordId: string | null;
  lastApprovedAt: string | null;
  updatedAt: string;
};

export type PowerLiftSeasonUser = {
  id: string;
  seasonId: string;
  seasonNumber: number;
  userId: string;
  competitionSex: PowerLiftSex;
  generalOptIn: boolean;
  defendingMaster: boolean;
  generalDefenseMultiplier: number;
  createdAt: string;
  updatedAt: string;
};

type RankingEntry = PowerLiftSeasonEntry & {
  rank: number;
};

type GeneralRankingEntry = {
  rank: number;
  userId: string;
  userName: string;
  userPhoto: string;
  competitionSex: PowerLiftSex;
  rawScore: number;
  competitiveScore: number;
  defendingMaster: boolean;
  defenseMultiplier: number;
  scores: Record<PowerLiftExercise, number>;
  competitiveModalityScores: Record<PowerLiftExercise, number>;
  bestVolumes: Record<PowerLiftExercise, number>;
};

function entryId(seasonId: string, userId: string, exercise: PowerLiftExercise): string {
  return `${seasonId}_${userId}_${exercise}`;
}

function seasonUserId(seasonId: string, userId: string): string {
  return `${seasonId}_${userId}`;
}

function resultId(seasonId: string, sex: PowerLiftSex): string {
  return `${seasonId}_${sex}`;
}

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function tierIndex(tier: PowerLiftTier): number {
  return Math.max(0, POWER_LIFT_TIER_ORDER.indexOf(tier));
}

function normalizeTier(value: unknown): PowerLiftTier {
  return POWER_LIFT_TIER_ORDER.includes(value as PowerLiftTier) ? value as PowerLiftTier : 'UNRANKED';
}

function normalizeSex(value: unknown): PowerLiftSex | null {
  return value === 'male' || value === 'female' ? value : null;
}

async function previousResults(season: PowerLiftSeasonWindow, sex: PowerLiftSex): Promise<Record<string, any> | null> {
  const previous = previousPowerLiftSeason(season);
  if (!previous) return null;
  const snap = await db.collection(RESULT_COLLECTION).doc(resultId(previous.id, sex)).get();
  if (!snap.exists || snap.data()?.status !== 'FINALIZED') return null;
  return snap.data() || null;
}

function isPreviousModalityChampion(results: Record<string, any> | null, exercise: PowerLiftExercise, userId: string): boolean {
  return String(results?.modalityWinners?.[exercise]?.userId || '') === userId;
}

function isPreviousMaster(results: Record<string, any> | null, userId: string): boolean {
  return String(results?.masterWinner?.userId || '') === userId;
}

function defaultEntry(params: {
  season: PowerLiftSeasonWindow;
  userId: string;
  userName: string;
  userPhoto: string;
  sex: PowerLiftSex;
  exercise: PowerLiftExercise;
  defendingChampion: boolean;
  now: string;
}): PowerLiftSeasonEntry {
  return {
    id: entryId(params.season.id, params.userId, params.exercise),
    seasonId: params.season.id,
    seasonNumber: params.season.number,
    userId: params.userId,
    userName: params.userName || 'Atleta',
    userPhoto: params.userPhoto || '',
    competitionSex: params.sex,
    exercise: params.exercise,
    tier: 'UNRANKED',
    bestVolume: 0,
    bestWeight: 0,
    bestRecordId: null,
    bestAchievedAt: null,
    rawScore: 0,
    competitiveScore: 0,
    defendingChampion: params.defendingChampion,
    defenseMultiplier: params.defendingChampion ? 0.97 : 1,
    eliteOptIn: false,
    validMarks: 0,
    lastApprovedRecordId: null,
    lastApprovedAt: null,
    updatedAt: params.now,
  };
}

function compareElite(a: PowerLiftSeasonEntry, b: PowerLiftSeasonEntry): number {
  return b.competitiveScore - a.competitiveScore
    || b.rawScore - a.rawScore
    || b.bestVolume - a.bestVolume
    || String(a.bestAchievedAt || '').localeCompare(String(b.bestAchievedAt || ''))
    || a.userId.localeCompare(b.userId);
}

function compareGeneral(a: GeneralRankingEntry, b: GeneralRankingEntry): number {
  return b.competitiveScore - a.competitiveScore
    || b.rawScore - a.rawScore
    || a.userId.localeCompare(b.userId);
}

async function creditRewardDocument(collection: string, documentId: string): Promise<boolean> {
  const ref = db.collection(collection).doc(documentId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const reward = snap.data() || {};
  if (reward.status === 'CREDITED') return true;
  const amount = Math.floor(Number(reward.amount) || 0);
  if (!reward.userId || amount <= 0 || !reward.idempotencyKey) return false;

  try {
    const result = await RewardCoinEngine.credit({
      userId: String(reward.userId),
      amount,
      origin: reward.origin === 'championship' ? 'championship' : 'campaign',
      ledgerType: reward.origin === 'championship' ? 'GYM_CHAMPIONSHIP_PODIUM' : 'PROMOTIONAL_REWARD',
      description: String(reward.description || 'Recompensa Power Lift'),
      idempotencyKey: String(reward.idempotencyKey),
    });
    await ref.set({
      status: 'CREDITED',
      transactionId: result.transaction.id,
      creditedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return true;
  } catch (error: any) {
    await ref.set({
      status: 'PENDING',
      lastError: String(error?.message || 'Falha ao creditar Invictus Coins').slice(0, 500),
      lastAttemptAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true }).catch(() => undefined);
    console.warn('[PowerLift][Reward] Crédito pendente:', documentId, error?.message || error);
    return false;
  }
}

export async function settlePendingPowerLiftRewards(): Promise<{ credited: number; pending: number }> {
  let credited = 0;
  let pending = 0;
  for (const collection of [TIER_REWARD_COLLECTION, COMPETITIVE_REWARD_COLLECTION]) {
    const snap = await db.collection(collection).where('status', '==', 'PENDING').limit(MAX_PENDING_REWARD_SWEEP).get();
    for (const doc of snap.docs) {
      if (await creditRewardDocument(collection, doc.id)) credited += 1;
      else pending += 1;
    }
  }
  return { credited, pending };
}

/**
 * Aplica uma marca já homologada ao estado sazonal. É idempotente por recordId:
 * reprocessar a mesma aprovação não soma marcas, não avança categoria e não
 * duplica Coins.
 */
export async function applyApprovedPowerLiftRecord(recordId: string): Promise<{
  entry: PowerLiftSeasonEntry;
  tierAdvanced: PowerLiftTier | null;
  rewardCoins: number;
}> {
  const recordRef = db.collection('power_records').doc(recordId);
  const initialSnap = await recordRef.get();
  if (!initialSnap.exists) throw new Error('Registro Power Lift não encontrado.');
  const initial = initialSnap.data() || {};
  if (initial.videoStatus !== 'approved') throw new Error('Somente marca homologada pode atualizar a temporada.');

  const exercise = initial.exercise as PowerLiftExercise;
  const sex = normalizeSex(initial.competitionSex);
  if (!POWER_LIFT_REWARD_EXERCISES.includes(exercise) || !sex) throw new Error('Categoria competitiva inválida.');
  const seasonNumber = Number(initial.seasonNumber) || Number(String(initial.seasonId || '').match(/(\d+)$/)?.[1]) || 0;
  const season = resolvePowerLiftSeasonNumber(seasonNumber);
  if (!season || initial.seasonId !== season.id) throw new Error('Temporada do registro inválida.');

  const userId = String(initial.userId || '');
  if (!userId) throw new Error('Atleta do registro inválido.');
  const previous = await previousResults(season, sex);
  const defendingChampion = isPreviousModalityChampion(previous, exercise, userId);
  const defendingMaster = isPreviousMaster(previous, userId);
  const entryRef = db.collection(ENTRY_COLLECTION).doc(entryId(season.id, userId, exercise));
  const seasonUserRef = db.collection(USER_COLLECTION).doc(seasonUserId(season.id, userId));
  const now = new Date().toISOString();

  const outcome = await db.runTransaction(async (transaction: any) => {
    const [recordSnap, entrySnap, userSeasonSnap] = await Promise.all([
      transaction.get(recordRef),
      transaction.get(entryRef),
      transaction.get(seasonUserRef),
    ]);
    if (!recordSnap.exists) throw new Error('Registro Power Lift não encontrado durante conciliação.');
    const record = recordSnap.data() || {};
    if (record.videoStatus !== 'approved') throw new Error('Marca deixou de estar homologada.');

    const existing = entrySnap.exists
      ? entrySnap.data() as PowerLiftSeasonEntry
      : defaultEntry({
          season,
          userId,
          userName: String(record.userName || 'Atleta'),
          userPhoto: String(record.userPhoto || ''),
          sex,
          exercise,
          defendingChampion,
          now,
        });

    if (record.progressionAppliedAt) {
      return { entry: existing, tierAdvanced: null as PowerLiftTier | null, rewardDocId: null as string | null, rewardCoins: 0 };
    }

    if (existing.competitionSex !== sex || existing.exercise !== exercise) {
      throw new Error('Conflito de categoria competitiva na temporada.');
    }

    const volume = safeNumber(record.powerVolume || record.weight);
    const weight = safeNumber(record.weight);
    const previousTier = normalizeTier(existing.tier);
    const nextTier = advancePowerLiftTier(previousTier, volume, exercise, sex);
    const tierAdvanced = tierIndex(nextTier) > tierIndex(previousTier) ? nextTier : null;
    const improved = volume > safeNumber(existing.bestVolume);
    const bestVolume = Math.max(safeNumber(existing.bestVolume), volume);
    const bestWeight = Math.max(safeNumber(existing.bestWeight), weight);
    const rawScore = rawPowerLiftScore(bestVolume, exercise, sex);
    const competitiveScore = modalityCompetitiveScore(rawScore, existing.defendingChampion || defendingChampion);
    const updated: PowerLiftSeasonEntry = {
      ...existing,
      userName: String(record.userName || existing.userName || 'Atleta'),
      userPhoto: String(record.userPhoto || existing.userPhoto || ''),
      tier: nextTier,
      bestVolume,
      bestWeight,
      bestRecordId: improved ? recordId : existing.bestRecordId,
      bestAchievedAt: improved ? String(record.approvedAt || record.createdAt || now) : existing.bestAchievedAt,
      rawScore,
      competitiveScore,
      defendingChampion: existing.defendingChampion || defendingChampion,
      defenseMultiplier: (existing.defendingChampion || defendingChampion) ? 0.97 : 1,
      validMarks: Math.max(0, Number(existing.validMarks) || 0) + 1,
      lastApprovedRecordId: recordId,
      lastApprovedAt: String(record.approvedAt || now),
      updatedAt: now,
    };

    let rewardDocId: string | null = null;
    let rewardCoins = 0;
    if (tierAdvanced && tierAdvanced !== 'UNRANKED') {
      rewardCoins = tierRewardCoins(tierAdvanced);
      const idempotencyKey = powerLiftTierRewardKey({ seasonId: season.id, userId, exercise, tier: tierAdvanced });
      rewardDocId = idempotencyKey;
      transaction.set(db.collection(TIER_REWARD_COLLECTION).doc(rewardDocId), {
        id: rewardDocId,
        seasonId: season.id,
        seasonNumber: season.number,
        userId,
        competitionSex: sex,
        exercise,
        tier: tierAdvanced,
        amount: rewardCoins,
        origin: 'campaign',
        status: 'PENDING',
        idempotencyKey,
        description: `Power Lift ${tierAdvanced} — ${exercise} — Temporada ${season.number}`,
        rewardVersion: POWER_LIFT_REWARD_VERSION,
        createdAt: now,
        updatedAt: now,
      }, { merge: true });
    }

    transaction.set(entryRef, updated, { merge: true });
    transaction.set(seasonUserRef, {
      id: seasonUserId(season.id, userId),
      seasonId: season.id,
      seasonNumber: season.number,
      userId,
      competitionSex: sex,
      generalOptIn: userSeasonSnap.exists ? userSeasonSnap.data()?.generalOptIn === true : false,
      defendingMaster: userSeasonSnap.exists ? userSeasonSnap.data()?.defendingMaster === true : defendingMaster,
      generalDefenseMultiplier: (userSeasonSnap.exists ? userSeasonSnap.data()?.defendingMaster === true : defendingMaster) ? 0.95 : 1,
      createdAt: userSeasonSnap.exists ? userSeasonSnap.data()?.createdAt || now : now,
      updatedAt: now,
    }, { merge: true });
    transaction.update(recordRef, {
      seasonScore: rawScore,
      competitiveScore,
      seasonTier: nextTier,
      tierAdvancedTo: tierAdvanced,
      progressionAppliedAt: now,
      updatedAt: now,
    });

    return { entry: updated, tierAdvanced, rewardDocId, rewardCoins };
  });

  if (outcome.rewardDocId) await creditRewardDocument(TIER_REWARD_COLLECTION, outcome.rewardDocId);
  return { entry: outcome.entry, tierAdvanced: outcome.tierAdvanced, rewardCoins: outcome.rewardCoins };
}

async function reconcileApprovedUserSeasonRecords(userId: string, season: PowerLiftSeasonWindow): Promise<void> {
  const snap = await db.collection('power_records').where('userId', '==', userId).limit(250).get();
  const candidates = snap.docs
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .filter((record: any) => record.videoStatus === 'approved' && record.seasonId === season.id && !record.progressionAppliedAt)
    .sort((a: any, b: any) => String(a.approvedAt || a.createdAt || '').localeCompare(String(b.approvedAt || b.createdAt || '')));
  for (const record of candidates) {
    try {
      await applyApprovedPowerLiftRecord(record.id);
    } catch (error) {
      console.warn('[PowerLift] Falha ao reconciliar progressão aprovada:', record.id, error);
    }
  }
}

export async function getPowerLiftSeasonStatus(userId: string) {
  const season = resolvePowerLiftSeason(new Date());
  await reconcileApprovedUserSeasonRecords(userId, season);
  const userSnap = await db.collection('users').doc(userId).get();
  const sex = normalizeSex(userSnap.data()?.sex);
  if (!sex) throw new Error('Complete o campo Sexo Biológico no perfil para competir no Power Lift.');

  const refs = POWER_LIFT_REWARD_EXERCISES.map((exercise) => db.collection(ENTRY_COLLECTION).doc(entryId(season.id, userId, exercise)));
  const entrySnaps = await db.getAll(...refs);
  const seasonUserSnap = await db.collection(USER_COLLECTION).doc(seasonUserId(season.id, userId)).get();
  const previous = await previousResults(season, sex);
  const entries = {} as Record<PowerLiftExercise, PowerLiftSeasonEntry>;
  const now = new Date().toISOString();

  POWER_LIFT_REWARD_EXERCISES.forEach((exercise, index) => {
    const snap = entrySnaps[index];
    entries[exercise] = snap.exists
      ? snap.data() as PowerLiftSeasonEntry
      : defaultEntry({
          season,
          userId,
          userName: String(userSnap.data()?.displayName || userSnap.data()?.name || 'Atleta'),
          userPhoto: String(userSnap.data()?.photoURL || ''),
          sex,
          exercise,
          defendingChampion: isPreviousModalityChampion(previous, exercise, userId),
          now,
        });
  });

  const tiers = {
    supino: entries.supino.tier,
    agachamento: entries.agachamento.tier,
    terra: entries.terra.tier,
  } as Record<PowerLiftExercise, PowerLiftTier>;
  const rawGeneralScore = entries.supino.rawScore + entries.agachamento.rawScore + entries.terra.rawScore;
  const defendingMaster = seasonUserSnap.exists
    ? seasonUserSnap.data()?.defendingMaster === true
    : isPreviousMaster(previous, userId);
  const generalEligible = canEnterGeneralRanking(tiers);
  const generalOptIn = seasonUserSnap.exists && seasonUserSnap.data()?.generalOptIn === true;

  return {
    season,
    competitionSex: sex,
    entries,
    general: {
      eligible: generalEligible,
      optedIn: generalOptIn,
      rawScore: rawGeneralScore,
      competitiveScore: generalCompetitiveScore(rawGeneralScore, defendingMaster),
      defendingMaster,
      defenseMultiplier: defendingMaster ? 0.95 : 1,
    },
    rewards: {
      tier: {
        FERRO: tierRewardCoins('FERRO'),
        BRONZE: tierRewardCoins('BRONZE'),
        PRATA: tierRewardCoins('PRATA'),
        OURO: tierRewardCoins('OURO'),
        PLATINA: tierRewardCoins('PLATINA'),
        DIAMANTE: tierRewardCoins('DIAMANTE'),
      },
      podium: POWER_LIFT_MODALITY_PODIUM_REWARDS,
      master: POWER_LIFT_MASTER_REWARD,
    },
  };
}

export async function setPowerLiftRankingOptIn(params: {
  userId: string;
  scope: 'elite' | 'general';
  exercise?: PowerLiftExercise;
  optedIn: boolean;
}) {
  const status = await getPowerLiftSeasonStatus(params.userId);
  const now = new Date().toISOString();
  if (params.scope === 'elite') {
    if (!params.exercise || !POWER_LIFT_REWARD_EXERCISES.includes(params.exercise)) throw new Error('Modalidade inválida.');
    const entry = status.entries[params.exercise];
    if (params.optedIn && !canEnterEliteRanking(entry.tier)) throw new Error('Alcance Diamante nesta modalidade antes de entrar no Ranking Elite.');
    await db.collection(ENTRY_COLLECTION).doc(entry.id).set({ eliteOptIn: params.optedIn, updatedAt: now }, { merge: true });
    return { scope: 'elite', exercise: params.exercise, optedIn: params.optedIn };
  }

  if (params.optedIn && !status.general.eligible) throw new Error('Conquiste Triplo Diamante antes de entrar no Ranking Geral.');
  await db.collection(USER_COLLECTION).doc(seasonUserId(status.season.id, params.userId)).set({
    id: seasonUserId(status.season.id, params.userId),
    seasonId: status.season.id,
    seasonNumber: status.season.number,
    userId: params.userId,
    competitionSex: status.competitionSex,
    generalOptIn: params.optedIn,
    defendingMaster: status.general.defendingMaster,
    generalDefenseMultiplier: status.general.defenseMultiplier,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
  return { scope: 'general', optedIn: params.optedIn };
}

async function readSeasonEntries(seasonId: string, sex?: PowerLiftSex): Promise<PowerLiftSeasonEntry[]> {
  const snap = await db.collection(ENTRY_COLLECTION).where('seasonId', '==', seasonId).limit(MAX_SEASON_SCAN).get();
  return snap.docs
    .map((doc: any) => ({ id: doc.id, ...doc.data() } as PowerLiftSeasonEntry))
    .filter((entry) => !sex || entry.competitionSex === sex);
}

export async function getPowerLiftEliteRanking(userId: string, exercise: PowerLiftExercise, limit = 100) {
  const status = await getPowerLiftSeasonStatus(userId);
  const entries = (await readSeasonEntries(status.season.id, status.competitionSex))
    .filter((entry) => entry.exercise === exercise && entry.tier === 'DIAMANTE' && entry.eliteOptIn === true)
    .sort(compareElite)
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map((entry, index) => ({ ...entry, rank: index + 1 } as RankingEntry));
  return { season: status.season, competitionSex: status.competitionSex, exercise, entries };
}

export async function getPowerLiftGeneralRanking(userId: string, limit = 100) {
  const status = await getPowerLiftSeasonStatus(userId);
  const entries = await readSeasonEntries(status.season.id, status.competitionSex);
  const byUser = new Map<string, Partial<Record<PowerLiftExercise, PowerLiftSeasonEntry>>>();
  for (const entry of entries) {
    const current = byUser.get(entry.userId) || {};
    current[entry.exercise] = entry;
    byUser.set(entry.userId, current);
  }

  const candidateUserIds = [...byUser.entries()]
    .filter(([, value]) => POWER_LIFT_REWARD_EXERCISES.every((exercise) => value[exercise]?.tier === 'DIAMANTE'))
    .map(([candidateUserId]) => candidateUserId);
  const userRefs = candidateUserIds.map((candidateUserId) => db.collection(USER_COLLECTION).doc(seasonUserId(status.season.id, candidateUserId)));
  const userSnaps = userRefs.length ? await db.getAll(...userRefs) : [];
  const users = new Map<string, PowerLiftSeasonUser>();
  userSnaps.forEach((snap: any) => { if (snap.exists) users.set(snap.data().userId, snap.data() as PowerLiftSeasonUser); });

  const ranking: GeneralRankingEntry[] = [];
  for (const candidateUserId of candidateUserIds) {
    const userState = users.get(candidateUserId);
    if (!userState?.generalOptIn) continue;
    const modalities = byUser.get(candidateUserId)! as Record<PowerLiftExercise, PowerLiftSeasonEntry>;
    const rawScore = POWER_LIFT_REWARD_EXERCISES.reduce((sum, exercise) => sum + safeNumber(modalities[exercise].rawScore), 0);
    const defendingMaster = userState.defendingMaster === true;
    ranking.push({
      rank: 0,
      userId: candidateUserId,
      userName: modalities.supino.userName || modalities.agachamento.userName || modalities.terra.userName || 'Atleta',
      userPhoto: modalities.supino.userPhoto || modalities.agachamento.userPhoto || modalities.terra.userPhoto || '',
      competitionSex: status.competitionSex,
      rawScore,
      competitiveScore: generalCompetitiveScore(rawScore, defendingMaster),
      defendingMaster,
      defenseMultiplier: defendingMaster ? 0.95 : 1,
      scores: {
        supino: modalities.supino.rawScore,
        agachamento: modalities.agachamento.rawScore,
        terra: modalities.terra.rawScore,
      },
      competitiveModalityScores: {
        supino: modalities.supino.competitiveScore,
        agachamento: modalities.agachamento.competitiveScore,
        terra: modalities.terra.competitiveScore,
      },
      bestVolumes: {
        supino: modalities.supino.bestVolume,
        agachamento: modalities.agachamento.bestVolume,
        terra: modalities.terra.bestVolume,
      },
    });
  }
  ranking.sort(compareGeneral).forEach((entry, index) => { entry.rank = index + 1; });
  return {
    season: status.season,
    competitionSex: status.competitionSex,
    entries: ranking.slice(0, Math.max(1, Math.min(100, limit))),
  };
}

async function pendingReviewCount(seasonId: string): Promise<number> {
  const snap = await db.collection('power_records').where('seasonId', '==', seasonId).limit(MAX_SEASON_SCAN).get();
  return snap.docs.filter((doc: any) => doc.data()?.videoStatus === 'manual_review').length;
}

async function createCompetitiveReward(params: {
  season: PowerLiftSeasonWindow;
  sex: PowerLiftSex;
  userId: string;
  type: 'podium' | 'master';
  exercise?: PowerLiftExercise;
  rank?: 1 | 2 | 3;
  amount: number;
  description: string;
}): Promise<string> {
  const idempotencyKey = params.type === 'master'
    ? powerLiftMasterRewardKey({ seasonId: params.season.id, sex: params.sex, userId: params.userId })
    : powerLiftPodiumRewardKey({
        seasonId: params.season.id,
        sex: params.sex,
        userId: params.userId,
        exercise: params.exercise!,
        rank: params.rank!,
      });
  const ref = db.collection(COMPETITIVE_REWARD_COLLECTION).doc(idempotencyKey);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.create({
      id: idempotencyKey,
      seasonId: params.season.id,
      seasonNumber: params.season.number,
      competitionSex: params.sex,
      userId: params.userId,
      type: params.type,
      exercise: params.exercise || null,
      rank: params.rank || 1,
      amount: params.amount,
      origin: 'championship',
      status: 'PENDING',
      idempotencyKey,
      description: params.description,
      rewardVersion: POWER_LIFT_REWARD_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return idempotencyKey;
}

async function buildGeneralRankingForSeason(
  season: PowerLiftSeasonWindow,
  sex: PowerLiftSex,
  entries: PowerLiftSeasonEntry[],
): Promise<GeneralRankingEntry[]> {
  const byUser = new Map<string, Partial<Record<PowerLiftExercise, PowerLiftSeasonEntry>>>();
  for (const entry of entries.filter((item) => item.competitionSex === sex)) {
    const current = byUser.get(entry.userId) || {};
    current[entry.exercise] = entry;
    byUser.set(entry.userId, current);
  }
  const candidates = [...byUser.entries()].filter(([, modalities]) => POWER_LIFT_REWARD_EXERCISES.every((exercise) => modalities[exercise]?.tier === 'DIAMANTE'));
  const refs = candidates.map(([candidateUserId]) => db.collection(USER_COLLECTION).doc(seasonUserId(season.id, candidateUserId)));
  const userSnaps = refs.length ? await db.getAll(...refs) : [];
  const userStates = new Map<string, PowerLiftSeasonUser>();
  userSnaps.forEach((snap: any) => { if (snap.exists) userStates.set(snap.data().userId, snap.data() as PowerLiftSeasonUser); });

  const ranking: GeneralRankingEntry[] = [];
  for (const [candidateUserId, partial] of candidates) {
    const state = userStates.get(candidateUserId);
    if (!state?.generalOptIn) continue;
    const modalities = partial as Record<PowerLiftExercise, PowerLiftSeasonEntry>;
    const rawScore = POWER_LIFT_REWARD_EXERCISES.reduce((sum, exercise) => sum + safeNumber(modalities[exercise].rawScore), 0);
    ranking.push({
      rank: 0,
      userId: candidateUserId,
      userName: modalities.supino.userName || modalities.agachamento.userName || modalities.terra.userName || 'Atleta',
      userPhoto: modalities.supino.userPhoto || modalities.agachamento.userPhoto || modalities.terra.userPhoto || '',
      competitionSex: sex,
      rawScore,
      competitiveScore: generalCompetitiveScore(rawScore, state.defendingMaster === true),
      defendingMaster: state.defendingMaster === true,
      defenseMultiplier: state.defendingMaster === true ? 0.95 : 1,
      scores: { supino: modalities.supino.rawScore, agachamento: modalities.agachamento.rawScore, terra: modalities.terra.rawScore },
      competitiveModalityScores: { supino: modalities.supino.competitiveScore, agachamento: modalities.agachamento.competitiveScore, terra: modalities.terra.competitiveScore },
      bestVolumes: { supino: modalities.supino.bestVolume, agachamento: modalities.agachamento.bestVolume, terra: modalities.terra.bestVolume },
    });
  }
  ranking.sort(compareGeneral).forEach((entry, index) => { entry.rank = index + 1; });
  return ranking;
}

export async function finalizePowerLiftSeason(season: PowerLiftSeasonWindow, sex: PowerLiftSex) {
  if (Date.now() < new Date(season.endsAt).getTime()) return { status: 'NOT_ENDED', seasonId: season.id, sex };
  const resultRef = db.collection(RESULT_COLLECTION).doc(resultId(season.id, sex));
  const existing = await resultRef.get();
  if (existing.exists && existing.data()?.status === 'FINALIZED') return { status: 'ALREADY_FINALIZED', seasonId: season.id, sex };

  const reviews = await pendingReviewCount(season.id);
  if (reviews > 0) return { status: 'BLOCKED_REVIEW', seasonId: season.id, sex, pendingReviews: reviews };

  const allEntries = await readSeasonEntries(season.id, sex);
  const modalityRankings = {} as Record<PowerLiftExercise, PowerLiftSeasonEntry[]>;
  const modalityWinners = {} as Record<PowerLiftExercise, Record<string, any> | null>;
  for (const exercise of POWER_LIFT_REWARD_EXERCISES) {
    const ranking = allEntries
      .filter((entry) => entry.exercise === exercise && entry.tier === 'DIAMANTE' && entry.eliteOptIn === true)
      .sort(compareElite);
    modalityRankings[exercise] = ranking;
    const winner = ranking[0];
    modalityWinners[exercise] = winner ? {
      userId: winner.userId,
      userName: winner.userName,
      rawScore: winner.rawScore,
      competitiveScore: winner.competitiveScore,
      bestVolume: winner.bestVolume,
    } : null;
  }
  const generalRanking = await buildGeneralRankingForSeason(season, sex, allEntries);
  const masterWinner = generalRanking[0] ? {
    userId: generalRanking[0].userId,
    userName: generalRanking[0].userName,
    rawScore: generalRanking[0].rawScore,
    competitiveScore: generalRanking[0].competitiveScore,
  } : null;
  const now = new Date().toISOString();

  const lockResult = await db.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(resultRef);
    if (snap.exists && ['LOCKED', 'FINALIZED'].includes(String(snap.data()?.status || ''))) return false;
    transaction.set(resultRef, {
      id: resultId(season.id, sex),
      seasonId: season.id,
      seasonNumber: season.number,
      competitionSex: sex,
      status: 'LOCKED',
      rewardVersion: POWER_LIFT_REWARD_VERSION,
      modalityWinners,
      masterWinner,
      modalityRankings: Object.fromEntries(POWER_LIFT_REWARD_EXERCISES.map((exercise) => [exercise, modalityRankings[exercise].slice(0, 100)])),
      generalRanking: generalRanking.slice(0, 100),
      lockedAt: now,
      updatedAt: now,
    }, { merge: true });
    return true;
  });
  if (!lockResult) return { status: 'IN_PROGRESS', seasonId: season.id, sex };

  const rewardIds: string[] = [];
  for (const exercise of POWER_LIFT_REWARD_EXERCISES) {
    for (const [index, athlete] of modalityRankings[exercise].slice(0, 3).entries()) {
      const rank = (index + 1) as 1 | 2 | 3;
      rewardIds.push(await createCompetitiveReward({
        season,
        sex,
        userId: athlete.userId,
        type: 'podium',
        exercise,
        rank,
        amount: modalityPodiumRewardCoins(rank),
        description: `${rank}º lugar no Ranking Elite ${exercise} — Power Lift Temporada ${season.number}`,
      }));
    }
  }
  if (masterWinner) {
    rewardIds.push(await createCompetitiveReward({
      season,
      sex,
      userId: masterWinner.userId,
      type: 'master',
      amount: POWER_LIFT_MASTER_REWARD,
      description: `Campeão Master do Ranking Geral Power Lift — Temporada ${season.number}`,
    }));
  }

  let credited = 0;
  for (const rewardId of rewardIds) {
    if (await creditRewardDocument(COMPETITIVE_REWARD_COLLECTION, rewardId)) credited += 1;
  }
  await resultRef.set({
    status: 'FINALIZED',
    finalizedAt: new Date().toISOString(),
    rewardsCreated: rewardIds.length,
    rewardsCreditedAtFinalization: credited,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return { status: 'FINALIZED', seasonId: season.id, sex, rewardsCreated: rewardIds.length, rewardsCredited: credited };
}

export async function runPowerLiftSettlementSweep(now = new Date()) {
  const current = resolvePowerLiftSeason(now);
  const finalized: any[] = [];
  const blocked: any[] = [];
  const firstSeason = Math.max(1, current.number - 12);
  for (let number = firstSeason; number < current.number; number += 1) {
    const season = resolvePowerLiftSeasonNumber(number, now);
    if (!season) continue;
    for (const sex of POWER_LIFT_REWARD_SEXES) {
      try {
        const result = await finalizePowerLiftSeason(season, sex);
        if (['BLOCKED_REVIEW', 'IN_PROGRESS'].includes(result.status)) blocked.push(result);
        else finalized.push(result);
      } catch (error: any) {
        blocked.push({ seasonId: season.id, sex, status: 'ERROR', reason: String(error?.message || error) });
      }
    }
  }
  const rewards = await settlePendingPowerLiftRewards();
  return { finalized, blocked, rewards };
}

export function publicPowerLiftEntry(entry: PowerLiftSeasonEntry) {
  return {
    id: entry.id,
    userId: entry.userId,
    userName: entry.userName,
    userPhoto: entry.userPhoto,
    exercise: entry.exercise,
    competitionSex: entry.competitionSex,
    seasonId: entry.seasonId,
    seasonNumber: entry.seasonNumber,
    seasonTier: entry.tier,
    powerVolume: entry.bestVolume,
    weight: entry.bestWeight,
    seasonScore: entry.rawScore,
    competitiveScore: entry.competitiveScore,
    defendingChampion: entry.defendingChampion,
    defenseMultiplier: entry.defenseMultiplier,
    eliteOptIn: entry.eliteOptIn,
    bestAchievedAt: entry.bestAchievedAt,
  };
}

export function powerLiftNextTierTarget(entry: PowerLiftSeasonEntry): { tier: PowerLiftTier | null; threshold: number | null } {
  const index = POWER_LIFT_TIER_ORDER.indexOf(entry.tier);
  const next = index >= 0 && index < POWER_LIFT_TIER_ORDER.length - 1 ? POWER_LIFT_TIER_ORDER[index + 1] : null;
  return {
    tier: next,
    threshold: next ? tierThreshold(entry.exercise, entry.competitionSex, next) : null,
  };
}
