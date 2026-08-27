import { db } from './common.js';
import { SecurityPipeline } from './security-pipeline.js';
import { buscarHistoricoRecente } from './user-activity-history.js';
import { encontrarAtividadeDuplicada } from './activity-dedup.js';
import { recalculateAllUserScores } from './igaService.js';
import { registrarAmostrasDeAtividade } from './health-data-layer.js';

/**
 * INGESTAO DE HEALTHKIT / HEALTH CONNECT (#248).
 *
 * Ate aqui, conectar o Apple Health ou o Health Connect só gravava uma
 * preferência (`wearable_configs`) -- nenhuma atividade lida do aparelho
 * virava treino, pontuação ou entrava no ranking. `WearableManager.syncAll()`
 * lançava de propósito, exatamente para não deixar o cliente homologar dados
 * sozinho.
 *
 * Este módulo é o espelho do que já existe pra Strava (`sync-service.ts`):
 * o cliente só LÊ do HealthKit/Health Connect e manda os dados normalizados
 * (`WearableActivity`, já no formato de `src/services/wearables/types.ts`);
 * quem decide se aquilo vira pontuação é o servidor, rodando os mesmos 10
 * sub-motores do SecurityPipeline que treino manual, check-in de presença,
 * corrida GPS e Strava já passam. Nenhum antifraude novo foi criado -- é o
 * mesmo pipeline central, com o mesmo detector de duplicidade entre fontes
 * (#240) que já existia antes deste módulo.
 */

export interface WearableActivityPayload {
  source: 'apple_health' | 'health_connect';
  sourceActivityId: string;
  activityType: string; // 'Corrida' | 'Caminhada' | 'Bike' | 'Musculação' | 'Cardio'
  startTime: string; // ISO
  durationSeconds: number;
  distanceMeters?: number;
  calories?: number;
  averageHeartRate?: number;
  maxHeartRate?: number;
  checkpoints?: { latitude: number; longitude: number }[];
}

export interface ResultadoIngestaoAtividade {
  sourceActivityId: string;
  status: 'approved' | 'duplicate' | 'blocked' | 'error';
  detalhe?: string;
}

function classificarTipo(activityType: string): { tipo: string; isCardio: boolean; isRun: boolean } {
  const raw = (activityType || '').toLowerCase();
  const isRun = raw.includes('corrida') || raw.includes('run');
  const isWalk = raw.includes('caminhada') || raw.includes('walk');
  const isBike = raw.includes('bike') || raw.includes('cycl') || raw.includes('pedalada');
  const isCardio = isRun || isWalk || isBike || raw.includes('cardio');
  return { tipo: activityType, isCardio, isRun };
}

/**
 * Processa UMA atividade normalizada vinda do cliente (Apple Health ou
 * Health Connect). Fail-closed: qualquer falha técnica do pipeline bloqueia
 * a pontuação em vez de aprovar por omissão -- mesma regra dos outros
 * quatro caminhos (treino manual, check-in, corrida GPS, Strava).
 *
 * NÃO chama recalculateAllUserScores sozinho -- quando várias atividades
 * chegam juntas (uma sincronização normal traz várias de uma vez), quem
 * chama este método em lote decide recalcular uma única vez no final, para
 * não rodar o recálculo completo do IGA N vezes seguidas.
 */
export async function processarAtividadeWearable(
  userId: string,
  activity: WearableActivityPayload,
  perfilUsuario: Record<string, any>
): Promise<ResultadoIngestaoAtividade> {
  const docId = `${activity.source}_${activity.sourceActivityId}`;

  try {
    const { tipo, isCardio, isRun } = classificarTipo(activity.activityType);
    const durationMins = activity.durationSeconds > 0 ? activity.durationSeconds / 60 : 0;
    const distanceKm = (activity.distanceMeters || 0) / 1000;
    const inicio = activity.startTime ? new Date(activity.startTime) : new Date();
    const dataSourceUpper = activity.source === 'apple_health' ? 'APPLE_HEALTH' : 'HEALTH_CONNECT';

    // #240: mesma checagem de deduplicação entre fontes que o Strava já usa --
    // uma corrida gravada pelo relógio E sincronizada depois pelo app (ou
    // vice-versa) não pode virar duas contribuições competitivas.
    const duplicata = await encontrarAtividadeDuplicada(userId, {
      inicio,
      duracaoMin: durationMins,
      distanciaKm: distanceKm > 0 ? distanceKm : undefined,
      tipo,
      fonte: activity.source,
      sourceActivityId: activity.sourceActivityId
    });

    let aprovado = false;
    if (duplicata) {
      console.warn(`[WearableSync] Atividade ${docId} é duplicata de ${duplicata.id} (${duplicata.motivo}) -- não vai pontuar.`);
    } else {
      try {
        const resultado = await SecurityPipeline.runPipeline(
          {
            id: docId,
            activityType: tipo,
            type: tipo,
            durationMins,
            distanceKm: distanceKm > 0 ? distanceKm : undefined,
            timestamp: activity.startTime || new Date().toISOString(),
            source: dataSourceUpper,
            dataSource: dataSourceUpper,
            // #248: rota real do HealthKit/Health Connect (quando existir),
            // no mesmo formato {latitude,longitude} que o ValidationEngine e
            // o IntegrityEngine já leem para checar GPS/deslocamento.
            checkpoints: activity.checkpoints,
            latitude: activity.checkpoints?.[0]?.latitude,
            longitude: activity.checkpoints?.[0]?.longitude,
            avgHeartRate: activity.averageHeartRate,
            maxHeartRate: activity.maxHeartRate,
            calories: activity.calories,
            // Nunca é entrada manual: veio direto do sensor do relógio/telefone.
            manual: false,
            isDuplicateActivity: false
          },
          userId,
          perfilUsuario,
          await buscarHistoricoRecente(userId)
        );
        aprovado = resultado.shouldScore;
        if (!aprovado) {
          console.warn(`[WearableSync] SecurityPipeline recusou ${docId}: ${resultado.decision}`);
        }
      } catch (pipelineErr) {
        console.error(`[WearableSync] SecurityPipeline falhou em ${docId}, bloqueando por segurança (fail-closed):`, pipelineErr);
        aprovado = false;
      }
    }

    await db.collection('workouts').doc(docId).set({
      id: docId,
      userId,
      type: isCardio ? 'cardio' : 'workout',
      cardioType: isRun ? 'corrida' : undefined,
      source: activity.source,
      sourceActivityId: activity.sourceActivityId,
      timestamp: activity.startTime || new Date().toISOString(),
      duration: Math.ceil(durationMins),
      distance: distanceKm > 0 ? distanceKm : undefined,
      calories: activity.calories,
      avgHeartRate: activity.averageHeartRate,
      maxHeartRate: activity.maxHeartRate,
      hasGpsRoute: Array.isArray(activity.checkpoints) && activity.checkpoints.length > 0,
      // Mesma whitelist que api/_lib/igaService.ts usa para decidir o que
      // conta pro IGA -- reprovado/duplicata fica visível no histórico
      // (a atividade aconteceu), só não alimenta a competição.
      status: aprovado ? 'completed' : 'suspicious',
      validationStatus: aprovado ? 'validated' : 'invalid',
      securityBlocked: aprovado ? undefined : true,
      nonScoringReason: aprovado ? undefined : (duplicata ? 'DUPLICATE_ACTIVITY' : 'SECURITY_PIPELINE_BLOCKED'),
      userMessage: duplicata?.detalhe,
      points: 0,
      pointsEarned: 0,
      createdAt: new Date().toISOString()
    }, { merge: true });

    // Health Data Layer (Fase 1, #251): registro ADITIVO -- alem de decidir se
    // isto pontua no IGA (acima), tambem alimenta a serie temporal de saude
    // independente da competicao. Nao influencia `aprovado`/pontuacao e uma
    // falha aqui nunca derruba a ingestao principal (ver comentario no
    // proprio modulo sobre separacao IGA/saude).
    try {
      await registrarAmostrasDeAtividade({
        userId,
        source: activity.source,
        sourceActivityId: docId,
        timestamp: activity.startTime || new Date().toISOString(),
        aprovadoPeloAntifraude: aprovado,
        pularDuplicata: Boolean(duplicata),
        avgHeartRate: activity.averageHeartRate,
        maxHeartRate: activity.maxHeartRate,
        calories: activity.calories,
        distanceKm: distanceKm > 0 ? distanceKm : undefined,
        durationMin: durationMins > 0 ? durationMins : undefined
      });
    } catch (healthLayerErr) {
      console.error(`[WearableSync] Health Data Layer falhou para ${docId} (nao-fatal, nao afeta pontuacao):`, healthLayerErr);
    }

    return {
      sourceActivityId: activity.sourceActivityId,
      status: duplicata ? 'duplicate' : aprovado ? 'approved' : 'blocked',
      detalhe: duplicata?.detalhe
    };
  } catch (err: any) {
    console.error(`[WearableSync] Falha inesperada processando ${docId}:`, err);
    return { sourceActivityId: activity.sourceActivityId, status: 'error', detalhe: err?.message };
  }
}

/**
 * Processa um lote de atividades (uma sincronização normal) SEQUENCIALMENTE
 * -- não em paralelo. Isso importa de verdade: se a atividade 2 do lote for
 * duplicata da atividade 1 do MESMO lote, a checagem de duplicidade só
 * encontra isso se a atividade 1 já estiver persistida no Firestore quando a
 * atividade 2 for avaliada. Em paralelo, as duas se veriam como "sem
 * duplicata" e pontuariam duas vezes.
 */
export async function processarLoteWearable(
  userId: string,
  activities: WearableActivityPayload[]
): Promise<{ resultados: ResultadoIngestaoAtividade[]; syncedCount: number; duplicatesSkipped: number; blockedCount: number }> {
  let perfilUsuario: Record<string, any> = {};
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (snap.exists) perfilUsuario = snap.data() || {};
  } catch (err) {
    console.warn('[WearableSync] Falha ao carregar perfil do usuário para o SecurityPipeline:', err);
  }

  const resultados: ResultadoIngestaoAtividade[] = [];
  for (const activity of activities) {
    resultados.push(await processarAtividadeWearable(userId, activity, perfilUsuario));
  }

  const syncedCount = resultados.filter((r) => r.status === 'approved').length;
  const duplicatesSkipped = resultados.filter((r) => r.status === 'duplicate').length;
  const blockedCount = resultados.filter((r) => r.status === 'blocked' || r.status === 'error').length;

  // Recalcula uma única vez para o lote inteiro -- ver comentário em
  // processarAtividadeWearable sobre por que isso não acontece por atividade.
  if (activities.length > 0) {
    try {
      await recalculateAllUserScores(userId);
    } catch (err) {
      console.error(`[WearableSync] Falha ao recalcular IGA após sincronizar ${userId}:`, err);
    }
  }

  return { resultados, syncedCount, duplicatesSkipped, blockedCount };
}
