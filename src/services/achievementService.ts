/**
 * Conquistas e créditos de score são decididos no servidor a partir de
 * atividades validadas. Esta fachada preserva os chamadores legados sem
 * permitir que o navegador altere achievements, XP ou ranking.
 */
export const achievementService = {
  async checkAndAwardAchievements(
    _userId: string,
    _stats: { streak?: number; totalWorkouts?: number; totalActiveDays?: number }
  ): Promise<string[]> {
    console.warn('[Achievements] A concessão de conquistas é processada apenas pelo servidor.');
    return [];
  }
};
