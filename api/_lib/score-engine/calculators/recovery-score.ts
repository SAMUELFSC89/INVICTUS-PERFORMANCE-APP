import { SCORE_CONFIG } from '../../score-config.js';

export function calculateRecoveryScorePure() {
  return { basePoints: SCORE_CONFIG.RECOVERY_POINTS };
}
