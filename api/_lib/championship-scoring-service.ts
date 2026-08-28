import { db } from './common.js';
import { matchActiveChampionshipsForActivity } from './championship-catalog.js';
import { getUserRegistration } from './championship-inscription-service.js';

/**
 * Pontuacao e leaderboard de campeonato.
 *
 * Ate 2026-08 isso era 100% decorativo: getUserProgress() e getLeaderboard()
 * em championshipService.ts devolviam numeros fixos hardcoded (ex: "182º
 * lugar, 7650 pontos", "Lucas Titan Silva, 14850 pontos") sem nenhuma
 * atividade real por tras. Agora cada atividade homologada (SecurityPipeline
 * + IGA ja aprovaram, ver validate-activity-service.ts) que cair dentro da
 * janela e do tipo de um campeonato em que o usuario tem inscricao PAGA vira
 * um documento em `championship_scores`, e progresso/leaderboard sao somas
 * reais sobre essa colecao.
 *
 * O "score" por atividade reaproveita o scoreAwarded (XP) ja calculado pelo
 * ValidateActivityService -- de proposito NAO inventamos uma 6ª formula de
 * pontuacao: o app ja tinha 5 formulas independentes de ranking coexistindo
 * (ver AUDITORIA-CORE-INVICTUS.md) e o IGA foi criado exatamente para acabar
 * com isso. O placar do campeonato e a soma do esforco real ja auditado.
 *
 * Consultas usam filtro de igualdade UNICO (championshipId) e filtram o
 * resto (userId, validationStatus) em memoria -- mesmo padrao ja usado em
 * api/_lib/igaService.ts (fetchAllSessionsSince) para nao depender de indice
 * composto do Firestore, que precisaria ser criado manualmente no console e
 * quebraria a producao silenciosamente (failed-precondition) se alguem
 * esquecesse.
 */

export interface ChampionshipActivityInput {
  userId: string;
  userName?: string;
  userGymName?: string;
  activityId: string;
  activityType: string;
  isIndoorCardio?: boolean;
  durationMinutes: number;
  distanceKm?: number;
  score: number;
  when: Date;
}

/**
 * Submissao automatica pos-validacao. Roda depois do recalculo do IGA em
 * validate-activity-service.ts; e um no-op (sem nenhuma leitura extra
 * relevante) para qualquer usuario sem inscricao paga em nenhum campeonato
 * ativo -- ou seja, hoje, para todo mundo, ate a primeira inscricao real
 * acontecer. Nunca lanca: falha aqui nao pode derrubar a resposta da
 * atividade principal.
 */
export async function submitActivityToActiveChampionships(input: ChampionshipActivityInput): Promise<void> {
  const candidatos = matchActiveChampionshipsForActivity({
    activityType: input.activityType,
    isIndoorCardio: input.isIndoorCardio,
    when: input.when,
  });
  if (candidatos.length === 0) return;

  for (const champ of candidatos) {
    try {
      const registration = await getUserRegistration(input.userId, champ.id);
      const ativo = !!registration && registration.status === 'paga' && registration.paymentStatus === 'PAID';
      if (!ativo) continue;

      const profile = champ.antiFraudProfile || {};
      const dentroDaDuracao =
        (profile.minDurationMinutes == null || input.durationMinutes >= profile.minDurationMinutes) &&
        (profile.maxDurationMinutes == null || input.durationMinutes <= profile.maxDurationMinutes);

      const scoreId = `${input.activityId}_${champ.id}`;
      const scoreRef = db.collection('championship_scores').doc(scoreId);
      const jaExiste = await scoreRef.get();
      if (jaExiste.exists) continue; // idempotencia: nunca soma a mesma atividade duas vezes

      await scoreRef.set({
        id: scoreId,
        championshipId: champ.id,
        userId: input.userId,
        userName: input.userName || 'Atleta Invictus',
        userGymName: input.userGymName || null,
        activityId: input.activityId,
        activityType: input.activityType,
        score: dentroDaDuracao ? input.score : 0,
        validationStatus: dentroDaDuracao ? 'VALIDATED' : 'REJECTED',
        validationMotives: dentroDaDuracao ? [] : ['DURATION_OUTSIDE_CHAMPIONSHIP_PROFILE'],
        championshipValidation: {
          eligible: dentroDaDuracao,
          riskScore: 0,
          evaluatedAt: new Date().toISOString(),
        },
        metrics: {
          durationMinutes: input.durationMinutes,
          distanceKm: input.distanceKm || 0,
        },
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[Championship Scoring] falha ao submeter atividade ${input.activityId} ao campeonato ${champ.id}:`, err);
    }
  }
}

export async function getChampionshipProgress(championshipId: string, userId: string) {
  const snap = await db.collection('championship_scores')
    .where('championshipId', '==', championshipId)
    .get();

  let totalScore = 0;
  let totalTimeMinutes = 0;
  let validSessionsCount = 0;
  snap.forEach((doc) => {
    const d: any = doc.data();
    if (d.userId !== userId || d.validationStatus !== 'VALIDATED') return;
    totalScore += d.score || 0;
    totalTimeMinutes += d.metrics?.durationMinutes || 0;
    validSessionsCount += 1;
  });

  // Rank: posicao do usuario entre todos os participantes, ordenado por
  // pontuacao total (mesma soma acima, aplicada a cada usuario).
  const leaderboard = await getChampionshipLeaderboard(championshipId, Number.MAX_SAFE_INTEGER);
  const posicao = leaderboard.findIndex((e) => e.userId === userId);

  return {
    totalScore,
    totalTimeMinutes,
    validSessionsCount,
    currentRank: posicao >= 0 ? posicao + 1 : leaderboard.length + 1,
    totalParticipants: leaderboard.length,
  };
}

export interface ChampionshipActivityEntry {
  activityId: string;
  activityType: string;
  score: number;
  validationStatus: string;
  durationMinutes: number;
  distanceKm: number;
  createdAt: string;
}

/** Atividades homologadas do proprio usuario neste campeonato, mais recentes primeiro. */
export async function getUserChampionshipActivities(championshipId: string, userId: string, limit = 20): Promise<ChampionshipActivityEntry[]> {
  const snap = await db.collection('championship_scores')
    .where('championshipId', '==', championshipId)
    .get();

  const entradas: ChampionshipActivityEntry[] = [];
  snap.forEach((doc) => {
    const d: any = doc.data();
    if (d.userId !== userId) return;
    entradas.push({
      activityId: d.activityId,
      activityType: d.activityType,
      score: d.score || 0,
      validationStatus: d.validationStatus,
      durationMinutes: d.metrics?.durationMinutes || 0,
      distanceKm: d.metrics?.distanceKm || 0,
      createdAt: d.createdAt,
    });
  });

  return entradas
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export interface ChampionshipLeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  gym: string;
  score: number;
}

export async function getChampionshipLeaderboard(championshipId: string, limit = 50): Promise<ChampionshipLeaderboardEntry[]> {
  const snap = await db.collection('championship_scores')
    .where('championshipId', '==', championshipId)
    .get();

  const porUsuario = new Map<string, { userId: string; name: string; gym: string; score: number }>();
  snap.forEach((doc) => {
    const d: any = doc.data();
    if (d.validationStatus !== 'VALIDATED') return;
    const atual = porUsuario.get(d.userId) || { userId: d.userId, name: d.userName || 'Atleta Invictus', gym: d.userGymName || '-', score: 0 };
    atual.score += d.score || 0;
    porUsuario.set(d.userId, atual);
  });

  return Array.from(porUsuario.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}
