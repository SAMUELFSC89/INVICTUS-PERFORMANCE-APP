import { Capacitor } from '@capacitor/core';
import {
  COMPETITION_RULES_VERSIONS,
  COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION,
  COMPETITIVE_HR_CONSENT_TYPE,
  PRIVACY_POLICY_VERSION,
  TERMS_VERSION,
  type CompetitiveHrAcknowledgementInput,
} from '../../shared/competitiveHeartRatePolicy';

export * from '../../shared/competitiveHeartRatePolicy';

export function buildCompetitiveHrAcknowledgement(
  competitionId: string,
  competitionRulesVersion: string = COMPETITION_RULES_VERSIONS[competitionId as keyof typeof COMPETITION_RULES_VERSIONS],
): CompetitiveHrAcknowledgementInput {
  const rawPlatform = Capacitor.getPlatform();
  const platform = rawPlatform === 'ios' || rawPlatform === 'android' ? rawPlatform : 'web';
  return {
    accepted: true,
    consentType: COMPETITIVE_HR_CONSENT_TYPE,
    competitionId,
    competitionRulesVersion: competitionRulesVersion || '',
    hrAcknowledgementVersion: COMPETITIVE_HR_ACKNOWLEDGEMENT_VERSION,
    privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    termsVersion: TERMS_VERSION,
    platform,
    appVersion: String(import.meta.env.VITE_APP_VERSION || 'unknown'),
    locale: navigator.language || 'pt-BR',
  };
}
