import type { ActivitySession } from '../types';
import { activityService } from './activityService';

/**
 * Fail-closed guard used only before opening a NEW activity flow.
 *
 * restoreActiveSession() is intentionally best-effort because passive screens
 * must remain usable offline. A start CTA has a different safety requirement:
 * a Firestore failure cannot be interpreted as "there is no active session",
 * otherwise a second workout may be created while the first one still exists.
 */
export async function verifyActiveSessionBeforeStart(): Promise<ActivitySession | null> {
  return activityService.verifyActiveSessionBeforeStart();
}
