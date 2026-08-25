import { UserProfile } from '../types';

/**
 * REWARD SERVICE (ISOLAMENTO DE ARQUITETURA)
 * 
 * REGRA OFICIAL INVICTUS:
 * - Plano PRO = Assinatura exclusiva de recursos digitais (Saúde PRO, IA, relatórios avançados).
 * - Campeonatos = Inscrição esportiva autônoma com premiação Top 5 originada 100% da Receita Líquida Elegível.
 * - Assinatura PRO NÃO gera, financia, altera ou multiplica nenhum pote de premiação.
 */

export const rewardService = {
  /**
   * Status de compatibilidade com carteira
   */
  getWalletStatus() {
    return {
      active: true,
      currency: 'BRL',
      minimumRedeemAmount: 50.00
    };
  }
};
