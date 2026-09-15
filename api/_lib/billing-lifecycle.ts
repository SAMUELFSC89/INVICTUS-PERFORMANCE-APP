import { isActiveAccountState } from './account-state.js';

/**
 * Billing owns subscription/payment projection, not disciplinary account lifecycle.
 *
 * RevenueCat callbacks may continue reconciling orders and entitlements while an
 * account is blocked/suspended/disabled, but they must never overwrite the
 * top-level account `status` that made the profile inactive.
 */
export function billingAccountStatusPatch(
  userData: unknown,
  billingStatus: string,
): { status?: string } {
  return isActiveAccountState(userData) ? { status: billingStatus } : {};
}
