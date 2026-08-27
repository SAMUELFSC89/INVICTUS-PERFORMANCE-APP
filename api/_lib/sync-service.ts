import { db, FieldValue } from './common.js';
import { ScoreEngine } from './score-engine.js';
import { recalculateAllUserScores } from './igaService.js';
import { SecurityPipeline } from './security-pipeline.js';
import { buscarHistoricoRecente } from './user-activity-history.js';
import { encontrarAtividadeDuplicada } from './activity-dedup.js';

export class SyncService {
  static async processStravaActivity(userId: string, stravaActivity: any) {
    console.log(`[SyncService] Processing activity ${stravaActivity?.id} for user ${userId}`);

    let earnedPoints = 0;
    try {
      earnedPoints = await ScoreEngine.processStrava(userId, stravaActivity);
      console.log(`[SyncService] Activity ${stravaActivity?.id} processed by ScoreEngine. Points earned: ${earnedPoints}`);
    } catch (error: any) {
      console.warn(`[SyncService] Activity ${stravaActivity?.id} skipped during sync: ${error?.message}`);
      if (stravaActivity?.id) {
        try {
          await this.logStravaActivity(userId, stravaActivity, 'skipped', error?.message || 'Validation failed');
        } catch (logErr) {
          console.error('[SyncService] Failed to log skipped activity:', logErr);
        }
      }
      return false;
    }

    // Alem de pontuar via ScoreEngine (XP/score gerais), atividades de CORRIDA
    // sincronizadas do Strava tambem precisam alimentar running_stats e
    // run_sessions -- senao o usuario ganha XP mas nunca aparece no ranking
    // de corrida nem no historico de corridas. Isso era feito por
    // updateUserPerformance neste arquivo, mas essa funcao ficou orfa
    // (nunca chamada) apos a consolidacao do ScoreEngine
    // (ver auditoria de anti-fraude/score, tasks #106-116).
    // Reativamos aqui SOMENTE a parte de stats/sessions -- NAO
    // re-concedemos XP aqui, pois isso ja foi feito acima pelo ScoreEngine,
    // para nao causar dupla pontuacao.
    if (earnedPoints > 0) {
      const activityType = (stravaActivity?.type || stravaActivity?.sport_type || '').toString().toLowerCase();
      const isRunType = activityType.includes('run');

      if (isRunType) {
        try {
          const rawDistance = stravaActivity?.distance || 0;
          const km = rawDistance > 100 ? rawDistance / 1000 : rawDistance;
          const rawDurationSeconds = stravaActivity?.moving_time || stravaActivity?.elapsed_time || 0;
          const timeSeconds = rawDurationSeconds > 0 ? rawDurationSeconds : 0;
          const elevationGain = stravaActivity?.total_elevation_gain || 0;
          const rawDate = stravaActivity?.start_date || stravaActivity?.start_date_local || stravaActivity?.created_at;
          const activityDate = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();

          if (km > 0) {
            await this.updateRunningStatsAndSession(userId, {
              km,
              timeSeconds,
              elevationGain,
              date: activityDate,
              stravaActivityId: stravaActivity?.id?.toString()
            });
          }
        } catch (statsErr: any) {
          // Nao derruba o sync inteiro -- o XP ja foi concedido pelo
          // ScoreEngine acima, entao so registramos o erro para investigar.
          console.error(`[SyncService] Failed to update running_stats for Strava activity ${stravaActivity?.id}:`, statsErr);
        }
      }

      // #229: alem de running_stats/run_sessions (ranking especifico de corrida)
      // e do XP legado (ScoreEngine -> users.totalScore -- campo que NENHUMA tela
      // de ranking real le, ver AUDITORIA-CORE-INVICTUS.md), atividades do Strava
      // precisavam ser gravadas em `workouts` para se tornarem elegiveis ao IGA
      // (fonte unica de weeklyScore/monthlyScore/score). Ate 2026-08 o Strava
      // nunca escrevia em `workouts` -- ou seja, treinos sincronizados do Strava
      // eram INVISIVEIS para o ranking competitivo real, mesmo apos "pontuar"
      // via ScoreEngine. NOTA: isto ainda nao inclui deduplicacao entre Strava e
      // HealthKit/Health Connect (essa parte fica para a Fase 3 do antifraude,
      // ja registrada nas tasks pendentes) -- por ora Strava e a unica fonte
      // wearable que chega ate aqui.
      try {
        // #238: BLOQUEIO DE BYPASS DO ANTIFRAUDE.
        //
        // O Strava era o unico caminho que chegava ao `workouts` (e portanto ao
        // IGA e ao ranking) SEM passar pelo SecurityPipeline -- passava apenas
        // pela validacao leve do ScoreEngine (entrada manual + velocidade
        // media). Os outros tres caminhos (treino manual, check-in de presenca,
        // corrida GPS) ja rodavam o pipeline completo. Aqui a atividade passa
        // pelos mesmos 10 sub-motores antes de poder alimentar a competicao.
        // #240: a mesma corrida pode ter sido gravada pelo proprio Invictus e
        // depois chegar de novo pelo Strava. UMA atividade fisica so pode gerar
        // UMA contribuicao competitiva.
        const duplicata = await encontrarAtividadeDuplicada(userId, {
          inicio: new Date(stravaActivity?.start_date || stravaActivity?.start_date_local || Date.now()),
          duracaoMin: Math.ceil((stravaActivity?.moving_time || stravaActivity?.elapsed_time || 0) / 60),
          distanciaKm: (stravaActivity?.distance || 0) > 100 ? stravaActivity.distance / 1000 : (stravaActivity?.distance || 0),
          tipo: activityType,
          fonte: 'strava',
          sourceActivityId: stravaActivity?.id?.toString()
        });
        if (duplicata) {
          console.warn(`[SyncService] Atividade Strava ${stravaActivity?.id} e duplicata de ${duplicata.id} (${duplicata.motivo}) -- nao vai pontuar.`);
        }
        const aprovado = duplicata ? false : await this.avaliarSegurancaStrava(userId, stravaActivity, activityType, duplicata);
        await this.persistStravaWorkoutToHistory(userId, stravaActivity, activityType, aprovado, duplicata?.detalhe);
        // Recalcular sempre: uma atividade reprovada tambem precisa que o
        // ranking reflita o historico atual (ela entra como nao elegivel).
        await recalculateAllUserScores(userId);
      } catch (rankingErr: any) {
        console.error(`[SyncService] Failed to persist Strava activity to workouts / recalculate IGA for user ${userId}:`, rankingErr);
      }
    }

    return earnedPoints > 0;
  }

  // Grava uma atividade do Strava ja aprovada pelo ScoreEngine em `workouts`,
  // no mesmo formato que api/_lib/igaService.ts espera (status/type/duration/
  // calories/avgHeartRate/createdAt) -- ver comentario acima em
  // processStravaActivity. Idempotencia: usa o id da atividade do Strava como
  // ID do documento, entao um re-sync/webhook duplicado sobrescreve o mesmo
  // documento em vez de criar um segundo (nao duplica contribuicao ao IGA).
  /**
   * Roda o SecurityPipeline completo sobre uma atividade do Strava.
   *
   * Normaliza o payload do Strava para o formato que os motores esperam. Um
   * ponto importante: o Strava nao envia a lista de checkpoints, mas envia
   * `start_latlng`. Sem mapear isso, o ValidationEngine trataria toda corrida
   * como "sem GPS" e reprovaria atletas legitimos em massa -- por isso a
   * coordenada inicial e repassada como latitude/longitude.
   *
   * Fail-closed, igual aos outros tres caminhos: se o pipeline falhar
   * tecnicamente, a atividade NAO e aprovada para a competicao (ela continua
   * salva no historico, apenas sem alimentar o IGA).
   */
  private static async avaliarSegurancaStrava(userId: string, stravaActivity: any, normalizedActivityType: string, duplicata?: { detalhe: string } | null): Promise<boolean> {
    const rawDistance = stravaActivity?.distance || 0;
    const distanceKm = rawDistance > 100 ? rawDistance / 1000 : rawDistance;
    const rawDurationSeconds = stravaActivity?.moving_time || stravaActivity?.elapsed_time || 0;
    const inicio = Array.isArray(stravaActivity?.start_latlng) ? stravaActivity.start_latlng : null;

    const tipo = normalizedActivityType.includes('run') ? 'RUNNING'
      : normalizedActivityType.includes('walk') ? 'WALKING'
      : normalizedActivityType.includes('ride') || normalizedActivityType.includes('cycl') ? 'CYCLING'
      : 'CARDIO';

    let perfil: any = {};
    try {
      if (db) {
        const snap = await db.collection('users').doc(userId).get();
        if (snap.exists) perfil = snap.data() || {};
      }
    } catch (err) {
      console.warn('[SyncService] Falha ao carregar perfil para o SecurityPipeline:', err);
    }

    try {
      const resultado = await SecurityPipeline.runPipeline(
        {
          id: `strava_${stravaActivity?.id}`,
          activityType: tipo,
          type: tipo,
          durationMins: rawDurationSeconds > 0 ? rawDurationSeconds / 60 : 0,
          distanceKm,
          timestamp: stravaActivity?.start_date || stravaActivity?.start_date_local || new Date().toISOString(),
          source: 'STRAVA',
          dataSource: 'STRAVA',
          latitude: inicio ? inicio[0] : undefined,
          longitude: inicio ? inicio[1] : undefined,
          avgHeartRate: stravaActivity?.average_heartrate,
          maxHeartRate: stravaActivity?.max_heartrate,
          calories: stravaActivity?.calories,
          // O Strava e uma fonte de terceiros ja consolidada: nao ha telemetria
          // de sensor/dispositivo do nosso app para enviar. Nao inventamos esses
          // campos -- ausencia de dado nao pode virar dado valido.
          manual: stravaActivity?.manual === true,
          // Alimenta a evidencia REPLAY_DUPLICATE_ACTIVITY que ja existia no
          // FraudEngine mas que nenhum chamador setava -- o sinal nunca chegava
          // a disparar. Aproveitamos o motor existente em vez de criar outro.
          isDuplicateActivity: Boolean(duplicata)
        },
        userId,
        perfil,
        await buscarHistoricoRecente(userId)
      );

      if (!resultado.shouldScore) {
        console.warn(`[SyncService] SecurityPipeline recusou a atividade Strava ${stravaActivity?.id} de ${userId}: ${resultado.decision}`);
      }
      return resultado.shouldScore;
    } catch (err) {
      console.error(`[SyncService] SecurityPipeline falhou na atividade Strava ${stravaActivity?.id}, bloqueando por seguranca (fail-closed):`, err);
      return false;
    }
  }

  private static async persistStravaWorkoutToHistory(userId: string, stravaActivity: any, normalizedActivityType: string, aprovadoPeloAntifraude: boolean, motivoDuplicata?: string) {
    const isRunType = normalizedActivityType.includes('run');
    const isCardioType = isRunType
      || normalizedActivityType.includes('walk')
      || normalizedActivityType.includes('ride')
      || normalizedActivityType.includes('swim')
      || normalizedActivityType.includes('hike');

    const rawDurationSeconds = stravaActivity?.moving_time || stravaActivity?.elapsed_time || 0;
    const durationMins = rawDurationSeconds > 0 ? Math.ceil(rawDurationSeconds / 60) : 0;
    const rawDistance = stravaActivity?.distance || 0;
    const distanceKm = rawDistance > 100 ? rawDistance / 1000 : rawDistance;
    const rawDate = stravaActivity?.start_date || stravaActivity?.start_date_local || stravaActivity?.created_at;
    const activityDate = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();
    const docId = `strava_${stravaActivity?.id}`;

    await db.collection('workouts').doc(docId).set({
      id: docId,
      userId,
      type: isCardioType ? 'cardio' : 'workout',
      cardioType: isRunType ? 'corrida' : undefined,
      source: 'strava',
      stravaActivityId: stravaActivity?.id?.toString(),
      timestamp: activityDate,
      duration: durationMins,
      distance: distanceKm,
      calories: stravaActivity?.calories ?? undefined,
      avgHeartRate: stravaActivity?.average_heartrate ?? undefined,
      // O status decide se a atividade alimenta o IGA (ver a lista branca em
      // api/_lib/igaService.ts). Reprovada pelo antifraude fica registrada no
      // historico -- a corrida aconteceu e o atleta deve poder ve-la -- mas
      // como 'suspicious', que a lista branca nao aceita.
      status: aprovadoPeloAntifraude ? 'completed' : 'suspicious',
      validationStatus: aprovadoPeloAntifraude ? 'validated' : 'invalid',
      securityBlocked: aprovadoPeloAntifraude ? undefined : true,
      nonScoringReason: aprovadoPeloAntifraude ? undefined : (motivoDuplicata ? 'DUPLICATE_ACTIVITY' : 'SECURITY_PIPELINE_BLOCKED'),
      // A atividade duplicada continua visivel no historico (a corrida
      // aconteceu de verdade), so nao alimenta a competicao uma segunda vez.
      userMessage: motivoDuplicata,
      points: 0,
      pointsEarned: 0,
      createdAt: activityDate
    }, { merge: true });
  }

  private static async logStravaActivity(userId: string, stravaActivity: any, status: string, reason: string) {
    console.log("Firestore Operation:", {
      collection: "strava_activities",
      document: stravaActivity.id.toString(),
      operation: "set"
    });
    await db.collection('strava_activities').doc(stravaActivity.id.toString()).set({
      userId,
      stravaActivityId: stravaActivity.id,
      status,
      fraudReason: reason,
      createdAt: FieldValue.serverTimestamp()
    });
    console.log("Firestore Success");
  }

  // Atualiza running_stats (melhor km da semana/mes, ultima corrida) e cria um
  // registro em run_sessions para uma corrida sincronizada do Strava. Espelha
  // o que RunningService.addRun() faz para corridas nativas, para que
  // corridas do Strava tambem contem para o ranking de corrida
  // (running-repository.ts getRanking) e para o historico (getRunHistory).
  private static async updateRunningStatsAndSession(userId: string, activity: { km: number, timeSeconds: number, elevationGain: number, date: string, stravaActivityId?: string }) {
    const km = activity.km;
    const normalizedActivityDate = activity.date;
    const statsRef = db.collection('running_stats').doc(userId);

    console.log("Firestore Operation:", { collection: "running_stats", document: userId, operation: "get" });
    const statsSnap = await statsRef.get();
    console.log("Firestore Success");

    const statsData = statsSnap.exists ? statsSnap.data() : {
      userId, best_run_km_month: 0, best_run_km_week: 0, last_run_date: normalizedActivityDate
    };

    const updates: any = {
      userId,
      last_run_date: normalizedActivityDate,
      last_run_stats: {
        km,
        timeSeconds: activity.timeSeconds,
        elevationGain: activity.elevationGain,
        date: normalizedActivityDate,
        source: 'strava',
        stravaActivityId: activity.stravaActivityId
      },
      updatedAt: FieldValue.serverTimestamp()
    };

    if (km > (statsData?.best_run_km_month || 0)) updates.best_run_km_month = km;
    if (km > (statsData?.best_run_km_week || 0)) updates.best_run_km_week = km;

    console.log("Firestore Operation:", { collection: "running_stats", document: userId, operation: "set" });
    await statsRef.set(updates, { merge: true });
    console.log("Firestore Success");

    console.log("Firestore Operation:", { collection: "run_sessions", document: "auto-generated", operation: "add" });
    await db.collection('run_sessions').add({
      userId,
      km,
      duration: activity.timeSeconds,
      source: 'strava',
      stravaActivityId: activity.stravaActivityId,
      createdAt: FieldValue.serverTimestamp(),
      date: normalizedActivityDate
    });
    console.log("Firestore Success");
  }
}
