import { db } from './common.js';
import { resolverPerfilValidacao } from './modality-config.js';

/**
 * DEDUPLICACAO ENTRE FONTES.
 *
 * #240: uma mesma atividade fisica pode chegar por mais de um caminho. O caso
 * real hoje: o atleta corre com o Invictus rastreando E com o Strava aberto --
 * a corrida e gravada pelo app e, depois, sincronizada de novo pelo Strava.
 * Sem deduplicacao, UMA corrida vira DUAS contribuicoes competitivas.
 *
 * O que ja existia e continua valendo (nao foi refeito aqui):
 *  - `strava_<id>` como ID do documento: re-sync do MESMO id sobrescreve, nao
 *    duplica (idempotencia por fonte);
 *  - guarda de idempotencia por eventId no ScoreEngine;
 *  - janela de 10s contra duplo-clique no envio manual.
 * Nenhum deles resolve a duplicidade ENTRE fontes diferentes, que e o objetivo
 * deste modulo.
 *
 * O FraudEngine ja tinha a evidencia `REPLAY_DUPLICATE_ACTIVITY` implementada,
 * mas nenhum chamador setava `isDuplicateActivity` -- ou seja, o sinal nunca
 * disparava. Este modulo alimenta exatamente esse campo, reaproveitando o
 * motor existente em vez de criar um antifraude paralelo.
 */

export interface AtividadeCandidata {
  /** Inicio da atividade. */
  inicio: Date;
  duracaoMin: number;
  distanciaKm?: number;
  /** Tipo bruto (usado para resolver o perfil de modalidade). */
  tipo: string;
  /** Fonte desta atividade: 'strava' | 'invictus' | 'apple_health' | ... */
  fonte: string;
  /** ID da atividade no sistema de origem, quando existir. */
  sourceActivityId?: string;
}

export interface DuplicataEncontrada {
  id: string;
  fonte: string;
  motivo: 'MESMO_ID_DE_ORIGEM' | 'MESMA_JANELA_E_METRICAS';
  detalhe: string;
}

/** Tolerancia de inicio entre duas gravacoes da MESMA atividade fisica. */
const TOLERANCIA_INICIO_MIN = 20;
/** Diferenca relativa aceita em duracao/distancia para considerar a mesma sessao. */
const TOLERANCIA_RELATIVA = 0.25;

function paraData(valor: any): Date | null {
  if (!valor) return null;
  if (valor instanceof Date) return valor;
  if (typeof valor?.toDate === 'function') return valor.toDate();
  const d = new Date(valor);
  return isNaN(d.getTime()) ? null : d;
}

function proximo(a: number, b: number, tolerancia = TOLERANCIA_RELATIVA): boolean {
  if (a <= 0 || b <= 0) return false;
  const maior = Math.max(a, b);
  return Math.abs(a - b) / maior <= tolerancia;
}

/**
 * Procura uma atividade ja registrada que seja, na pratica, a MESMA sessao.
 *
 * Deliberadamente conservador: so acusa duplicata quando ha coincidencia forte
 * (mesmo id de origem, ou mesma janela de tempo COM metricas compativeis).
 * Um falso positivo aqui apaga um treino real do ranking de alguem, o que e
 * pior do que deixar passar um caso raro -- por isso a exigencia dupla.
 *
 * Falha de leitura devolve `null` (sem duplicata) para nunca bloquear um treino
 * legitimo por indisponibilidade do banco.
 */
export async function encontrarAtividadeDuplicada(
  userId: string,
  candidata: AtividadeCandidata
): Promise<DuplicataEncontrada | null> {
  if (!db || !userId || !candidata?.inicio) return null;

  const perfilCandidata = resolverPerfilValidacao({ type: candidata.tipo });
  const inicioMs = candidata.inicio.getTime();
  const janelaMs = TOLERANCIA_INICIO_MIN * 60 * 1000;

  try {
    const snapshot = await db.collection('workouts').where('userId', '==', userId).get();

    for (const doc of snapshot.docs) {
      const dados = doc.data() || {};

      // Mesma fonte + mesmo id de origem: duplicata exata.
      if (candidata.sourceActivityId && dados.source === candidata.fonte
        && String(dados.sourceActivityId || '') === String(candidata.sourceActivityId)) {
        return { id: doc.id, fonte: String(dados.source || 'desconhecida'), motivo: 'MESMO_ID_DE_ORIGEM', detalhe: `Mesma atividade ${candidata.fonte} (${candidata.sourceActivityId}).` };
      }

      // Duplicata entre fontes: so interessa comparar registros de origens
      // DIFERENTES -- dois registros da mesma fonte ja sao tratados acima.
      if (String(dados.source || 'invictus') === candidata.fonte) continue;

      const inicioExistente = paraData(dados.timestamp || dados.startTime || dados.createdAt);
      if (!inicioExistente) continue;
      if (Math.abs(inicioExistente.getTime() - inicioMs) > janelaMs) continue;

      // Modalidades diferentes na mesma janela sao possiveis de verdade
      // (musculacao e depois uma corrida), entao nao acusamos duplicata.
      const perfilExistente = resolverPerfilValidacao({ type: dados.type, cardioType: dados.cardioType });
      if (perfilExistente.id !== perfilCandidata.id) continue;

      const duracaoExistente = Number(dados.duration) || Number(dados.durationMins) || 0;
      const distanciaExistente = Number(dados.distance) || Number(dados.distanceKm) || 0;

      const duracaoBate = proximo(duracaoExistente, candidata.duracaoMin);
      // Distancia so entra na conta quando AMBOS os registros a possuem. Numa
      // musculacao nenhum dos dois tem distancia, e a duracao decide sozinha.
      const temAmbasDistancias = distanciaExistente > 0 && (candidata.distanciaKm || 0) > 0;
      const distanciaBate = temAmbasDistancias ? proximo(distanciaExistente, candidata.distanciaKm || 0) : true;

      if (duracaoBate && distanciaBate) {
        return {
          id: doc.id,
          fonte: String(dados.source || 'invictus'),
          motivo: 'MESMA_JANELA_E_METRICAS',
          detalhe: `Já existe uma atividade equivalente registrada por "${dados.source || 'invictus'}" no mesmo horário (${Math.round(duracaoExistente)} min${temAmbasDistancias ? `, ${distanciaExistente.toFixed(2)} km` : ''}).`
        };
      }
    }

    return null;
  } catch (erro) {
    console.warn(`[Dedup] Nao foi possivel checar duplicidade para ${userId} (seguindo sem bloquear):`, erro);
    return null;
  }
}
