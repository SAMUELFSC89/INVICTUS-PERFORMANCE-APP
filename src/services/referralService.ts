/*
 * Sistema de indicação descontinuado.
 *
 * Este shim temporário existe apenas para manter compatibilidade com o fluxo
 * de cadastro legado enquanto o restante do AuthGuard é simplificado. Ele não
 * faz chamadas de rede, não cria indicações e não concede qualquer benefício.
 */
export const referralService = {
  generateReferralCode(_uid: string): string {
    return '';
  },

  async getReferrerByCode(_code: string): Promise<null> {
    return null;
  },

  async createReferral(_referralCode: string): Promise<null> {
    return null;
  },

  async validateReferral(_referralId: string): Promise<never> {
    throw new Error('Sistema de indicação descontinuado.');
  },

  async checkMinWorkouts(_userId: string, _min: number): Promise<boolean> {
    return false;
  },

  async getMyReferrals(): Promise<[]> {
    return [];
  },
};
