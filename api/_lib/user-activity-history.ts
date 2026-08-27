import { db } from './common.js';

/**
 * HISTORICO DO ATLETA PARA O MOTOR ANTIFRAUDE.
 *
 * #237: ate 2026-08 os quatro pontos que chamam SecurityPipeline.runPipeline()
 * passavam `userHistory` como array vazio, fixo. Consequencia (ver
 * AUDITORIA-ANTIFRAUDE-CORE.md, secao 2): o BehaviorEngine exige pelo menos 3
 * atividades para sair do ramo neutro e o ReputationEngine exige 20 para
 * considerar taxa de aprovacao -- com a lista sempre vazia, os dois NUNCA
 * comparavam o atleta com ele mesmo, apesar de estarem corretamente
 * implementados. Metade do antifraude comportamental era decorativa.
 *
 * Este modulo e a fonte unica desse historico. Ele tambem NORMALIZA o
 * vocabulario: cada caminho de escrita usa nomes diferentes de status
 * ('completed' | 'valid' | 'validated' | 'suspicious' | 'rejected'...), e os
 * engines esperam o vocabulario do proprio pipeline
 * (APPROVED | PARTIALLY_APPROVED | UNDER_REVIEW | BLOCKED). Sem essa traducao
 * o filtro `validHistory` nao reconheceria nenhuma atividade real e o efeito
 * pratico continuaria sendo o de uma lista vazia.
 */

export interface HistoricoAtividade {
  id: string;
  securityDecision: 'APPROVED' | 'PARTIALLY_APPROVED' | 'UNDER_REVIEW' | 'BLOCKED' | 'UNKNOWN';
  status?: string;
  type?: string;
  durationMins: number;
  distanceKm: number;
  calories: number;
  avgHeartRate: number;
  timestamp: string;
  gymId?: string;
  deviceFingerprint?: string;
  fraudEvidences?: any[];
}

/** Traduz o status gravado no documento para a decisao equivalente do pipeline. */
function traduzirDecisao(dados: any): HistoricoAtividade['securityDecision'] {
  // Uma decisao explicita do proprio pipeline, quando existir, sempre vence.
  const explicita = dados.securityDecision || dados.decision;
  if (explicita === 'APPROVED' || explicita === 'PARTIALLY_APPROVED' || explicita === 'UNDER_REVIEW' || explicita === 'BLOCKED') {
    return explicita;
  }

  if (dados.securityBlocked === true) return 'BLOCKED';

  const status = String(dados.status || '').toLowerCase();
  const validacao = String(dados.validationStatus || '').toLowerCase();

  if (status === 'rejected' || status === 'invalid' || validacao === 'rejected' || validacao === 'invalid' || validacao === 'not_eligible') return 'BLOCKED';
  if (status === 'suspicious') return 'UNDER_REVIEW';
  if (status === 'pending_review') return 'UNDER_REVIEW';
  if (status === 'completed' || status === 'valid' || validacao === 'validated') return 'APPROVED';

  // Ausencia de dado nao e dado valido: sem status reconhecido, o registro
  // entra como UNKNOWN e simplesmente nao conta como aprovado no baseline.
  return 'UNKNOWN';
}

function paraData(valor: any): string {
  if (!valor) return new Date().toISOString();
  if (typeof valor === 'string') return valor;
  if (typeof valor?.toDate === 'function') return valor.toDate().toISOString();
  try { return new Date(valor).toISOString(); } catch { return new Date().toISOString(); }
}

/**
 * Ultimas atividades do usuario, mais recentes primeiro.
 *
 * Custo: UMA leitura de colecao por chamada do pipeline. Mantemos o limite
 * baixo de proposito -- o BehaviorEngine trabalha com media e desvio padrao,
 * onde poucas dezenas de amostras ja dao um baseline estavel, e o
 * ReputationEngine so precisa de 20 para avaliar taxa de aprovacao.
 *
 * Falha aqui NUNCA pode derrubar a validacao da atividade atual: se a leitura
 * do historico falhar, devolvemos lista vazia e o pipeline segue com o mesmo
 * comportamento neutro que tinha antes -- nunca com uma aprovacao mais facil.
 */
export async function buscarHistoricoRecente(userId: string, limite = 40): Promise<HistoricoAtividade[]> {
  if (!db || !userId) return [];

  try {
    const snapshot = await db.collection('workouts')
      .where('userId', '==', userId)
      .get();

    const itens: HistoricoAtividade[] = [];
    snapshot.forEach((doc: any) => {
      const dados = doc.data() || {};
      itens.push({
        id: doc.id,
        securityDecision: traduzirDecisao(dados),
        status: dados.status,
        type: dados.type,
        durationMins: Number(dados.duration) || Number(dados.durationMins) || 0,
        distanceKm: Number(dados.distance) || Number(dados.distanceKm) || 0,
        calories: Number(dados.calories) || Number(dados.caloriesKcal) || 0,
        avgHeartRate: Number(dados.avgHeartRate) || Number(dados.heartRate) || 0,
        timestamp: paraData(dados.timestamp || dados.createdAt),
        gymId: dados.gymId,
        deviceFingerprint: dados.deviceFingerprint || dados.deviceInfo?.model,
        fraudEvidences: Array.isArray(dados.fraudEvidences) ? dados.fraudEvidences : undefined
      });
    });

    // Ordenacao em memoria: `timestamp` nem sempre existe nos documentos
    // (ver AUDITORIA-CORE-INVICTUS.md secao 5), entao um orderBy no Firestore
    // excluiria silenciosamente os documentos sem o campo.
    itens.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return itens.slice(0, limite);
  } catch (erro) {
    console.warn(`[HistoricoAtleta] Nao foi possivel carregar o historico de ${userId} (pipeline segue com baseline neutro):`, erro);
    return [];
  }
}
