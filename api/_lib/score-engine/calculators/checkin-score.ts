import { SCORE_CONFIG } from '../../score-config.js';

export function calculateCheckinScorePure(hasPhoto: boolean) {
  const base = SCORE_CONFIG.CHECKIN_BASE_POINTS + (hasPhoto ? SCORE_CONFIG.CHECKIN_PHOTO_BONUS : 0);
  return { basePoints: base };
}
