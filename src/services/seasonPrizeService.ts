import { auth } from '../firebase';
import { API_CONFIG } from '../config';

/**
 * Premiacao da temporada, com os valores REAIS derivados da receita
 * arrecadada. Nao ha tabela fixa nem estimativa: o que vem daqui e a mesma
 * base que o motor de pagamento usa.
 *
 * O pote e unico e nacional -- a receita e os participantes nao sao separados
 * por academia ou cidade.
 */
export interface FaixaPremiacao {
  numero: number;
  minimoAtletas: number;
  premiados: number;
}

export interface PremioPorPosicao {
  posicao: number;
  valor: number;
}

export interface PremiacaoTemporada {
  seasonId: string;
  fimDaTemporada: string;
  /** true quando o usuario ainda nao tem academia definida e por isso nao concorre. */
  semAcademia: boolean;
  /**
   * true quando o atleta assinou depois do inicio desta temporada. Ele so
   * entra na proxima -- a tela deve dizer isso em vez de mostrar a disputa.
   */
  aguardandoProximaTemporada: boolean;
  totalParticipantes: number;
  pote: number;
  premiados: number;
  porPosicao: PremioPorPosicao[];
  faixaAtual: number;
  faixas: FaixaPremiacao[];
}

export const seasonPrizeService = {
  /**
   * Busca o estado atual da premiacao. Devolve null se nao for possivel
   * obter o dado -- a tela deve entao NAO exibir valor nenhum, em vez de
   * mostrar zero ou um numero inventado.
   */
  async buscarPremiacao(): Promise<PremiacaoTemporada | null> {
    try {
      const usuario = auth.currentUser;
      if (!usuario) return null;

      const idToken = await usuario.getIdToken();
      const resposta = await fetch(`${API_CONFIG.baseUrl}/api/season-prize`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!resposta.ok) {
        console.warn('[seasonPrize] resposta nao ok:', resposta.status);
        return null;
      }

      return (await resposta.json()) as PremiacaoTemporada;
    } catch (erro) {
      console.warn('[seasonPrize] falha ao buscar premiacao da temporada:', erro);
      return null;
    }
  },
};
