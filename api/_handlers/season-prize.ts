import { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, verifyAuth, db } from '../_lib/common.js';
import {
  getOrInitCurrentSeasonWindow,
  computeSeasonRevenueByGym,
  getSeasonParticipantsByGym,
  getWinnerCountPorAcademia,
} from '../_lib/season-prize-engine.js';
import { lerConfiguracaoInscricao } from '../_lib/season-settings.js';
import {
  SEASON_MIN_PARTICIPANTS_PER_GYM,
  SEASON_TOP5_THRESHOLD_PER_GYM,
  TOP_10_PERCENTAGES,
} from '../../src/constants.js';

/**
 * Estado da premiacao da temporada para a academia do atleta.
 *
 * A disputa e interna a cada unidade: o pote de uma academia vem das
 * INSCRICOES dos alunos dela, e sao os alunos dela que concorrem.
 *
 * O plano Pro nao entra nesta conta -- ele vende recursos, nao entrada.
 * Os valores aqui sao os reais, com a mesma base que o motor usa para pagar.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;

  const autenticado = await verifyAuth(req);
  if (!autenticado) {
    return res.status(401).json({ error: 'Nao autenticado' });
  }

  try {
    const temporada = await getOrInitCurrentSeasonWindow();

    const inscricao = await db
      .collection('season_inscriptions')
      .doc(`${autenticado.uid}_${temporada.seasonId}`)
      .get();

    const dadosInscricao: any = inscricao.exists ? inscricao.data() : null;
    const inscrito = dadosInscricao?.status === 'paga';
    const gymId: string | null = inscrito ? dadosInscricao.gymId : null;

    // Sem inscricao paga nesta temporada, o atleta nao concorre. A tela deve
    // dizer isso e oferecer a inscricao, em vez de mostrar uma disputa da qual
    // ele nao faz parte.
    if (!gymId) {
      return res.status(200).json({
        seasonId: temporada.seasonId,
        fimDaTemporada: temporada.endDate.toISOString(),
        inscrito: false,
        totalParticipantes: 0,
        pote: 0,
        premiados: 0,
        porPosicao: [],
        faixaAtual: 0,
        faixas: faixas(),
      });
    }

    const [receitaPorAcademia, participantesPorAcademia, config] = await Promise.all([
      computeSeasonRevenueByGym(temporada.seasonId),
      getSeasonParticipantsByGym(temporada.seasonId),
      lerConfiguracaoInscricao(),
    ]);

    const arrecadado = receitaPorAcademia.get(gymId) || 0;
    const participantes = participantesPorAcademia.get(gymId) || [];
    const totalParticipantes = participantes.length;

    const pote = Math.round(arrecadado * config.percentualPote * 100) / 100;
    const premiados = getWinnerCountPorAcademia(totalParticipantes);

    let porPosicao: Array<{ posicao: number; valor: number }> = [];
    if (premiados > 0 && pote > 0) {
      const brutos = TOP_10_PERCENTAGES.slice(0, premiados);
      const soma = brutos.reduce((a: number, b: number) => a + b, 0);
      porPosicao = brutos.map((p: number, i: number) => ({
        posicao: i + 1,
        valor: Math.round(pote * (p / soma) * 100) / 100,
      }));
    }

    const faixaAtual =
      totalParticipantes >= SEASON_TOP5_THRESHOLD_PER_GYM
        ? 2
        : totalParticipantes >= SEASON_MIN_PARTICIPANTS_PER_GYM
          ? 1
          : 0;

    return res.status(200).json({
      seasonId: temporada.seasonId,
      fimDaTemporada: temporada.endDate.toISOString(),
      inscrito: true,
      totalParticipantes,
      pote,
      premiados,
      porPosicao,
      faixaAtual,
      faixas: faixas(),
    });
  } catch (erro: any) {
    console.error('[season-prize] falha ao calcular premiacao da temporada:', erro?.message, erro);
    return res.status(500).json({ error: 'Falha ao calcular a premiacao da temporada' });
  }
}

function faixas() {
  return [
    { numero: 1, minimoAtletas: SEASON_MIN_PARTICIPANTS_PER_GYM, premiados: 3 },
    { numero: 2, minimoAtletas: SEASON_TOP5_THRESHOLD_PER_GYM, premiados: 5 },
  ];
}
