import { SCORE_CONFIG } from '../../score-config.js';

export function calculateDietScorePure() {
  return { basePoints: SCORE_CONFIG.MEAL_POINTS };
}
