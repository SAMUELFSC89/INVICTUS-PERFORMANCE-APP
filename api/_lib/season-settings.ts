import { db } from './common.js';

/**
 * Configuracao da temporada, editavel em system_config/season_settings sem
 * precisar de deploy.
 *
 * Fica num modulo proprio porque tanto o motor de premiacao quanto o servico
 * de inscricao precisam dela -- se vivesse em qualquer um dos dois, criaria
 * importacao circular entre eles.
 */
export interface ConfiguracaoInscricao {
  /** Valor da inscricao em reais. Sem valor definido, as inscricoes ficam fechadas. */
  valor: number | null;
  /** Fatia das inscricoes que vai para o pote, de 0 a 1. */
  percentualPote: number;
  abertas: boolean;
}

/** Usado apenas se nao houver nada configurado no Firestore. */
const PERCENTUAL_POTE_PADRAO = 0.55;

export async function lerConfiguracaoInscricao(): Promise<ConfiguracaoInscricao> {
  const snap = await db.collection('system_config').doc('season_settings').get();
  const dados: any = snap.exists ? snap.data() : {};

  // O valor NAO tem padrao de proposito: sem alguem definir quanto custa, as
  // inscricoes ficam fechadas. Melhor a competicao nao abrir do que cobrar um
  // numero que ninguem decidiu.
  const valor = typeof dados?.valorInscricao === 'number' && dados.valorInscricao > 0
    ? dados.valorInscricao
    : null;

  const percentualPote =
    typeof dados?.percentualPote === 'number' && dados.percentualPote > 0 && dados.percentualPote <= 1
      ? dados.percentualPote
      : PERCENTUAL_POTE_PADRAO;

  return {
    valor,
    percentualPote,
    abertas: valor !== null && dados?.inscricoesAbertas !== false,
  };
}
